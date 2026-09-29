import "server-only";

import pg from "pg";
import { broadcastControlState } from "@/lib/control-events";
import { loadControlState } from "@/lib/control-state";
import type { PdfRemoteState } from "@/lib/pdf-control";

/** Must be a valid Postgres identifier because it is interpolated into LISTEN. */
const CONTROL_STATE_CHANNEL = "zone03_control_state";

const RECONNECT_BASE_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

const globalForControlPubSub = globalThis as typeof globalThis & {
  controlNotifyPool?: pg.Pool;
  controlListenClient?: pg.Client;
  controlListenStarted?: boolean;
  controlListenAttempt?: number;
  controlLastBroadcastVersion?: number;
  controlPubSubWarned?: boolean;
};

const MISSING_DATABASE_URL_MESSAGE =
  "DATABASE_URL is not set. Cross-instance control-state updates are disabled.";

/**
 * LISTEN needs a direct Postgres connection. Transaction-mode poolers accept the
 * statement but cannot keep the session that receives notifications. A dedicated
 * DIRECT_DATABASE_URL is therefore preferred. Neon's conventional "-pooler"
 * hostname can be converted safely; other providers should set the direct URL.
 */
function resolveDirectDatabaseUrl(): string | null {
  const explicit = process.env.DIRECT_DATABASE_URL;
  if (explicit) return explicit;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    if (!globalForControlPubSub.controlPubSubWarned) {
      globalForControlPubSub.controlPubSubWarned = true;
      console.warn(MISSING_DATABASE_URL_MESSAGE);
    }
    return null;
  }

  if (!databaseUrl.includes("-pooler")) return databaseUrl;

  if (!globalForControlPubSub.controlPubSubWarned) {
    globalForControlPubSub.controlPubSubWarned = true;
    console.warn(
      "DATABASE_URL points at a Neon pooler, which cannot hold a LISTEN. " +
        "Using the derived direct endpoint. Set DIRECT_DATABASE_URL explicitly " +
        "for any other database provider or pooler.",
    );
  }

  return databaseUrl.replace("-pooler", "");
}

function getNotifyPool(): pg.Pool | null {
  const connectionString = resolveDirectDatabaseUrl();
  if (!connectionString) return null;

  globalForControlPubSub.controlNotifyPool ??= new pg.Pool({
    connectionString,
    max: 2,
  });
  return globalForControlPubSub.controlNotifyPool;
}

async function fanOutFromNotification(rawVersion: string) {
  const version = Number(rawVersion);

  // The publishing instance broadcasts locally before NOTIFY. Ignore the echo
  // that Postgres sends back to that same instance.
  if (
    Number.isFinite(version) &&
    version <= (globalForControlPubSub.controlLastBroadcastVersion ?? 0)
  ) {
    return;
  }

  try {
    const state = await loadControlState();
    globalForControlPubSub.controlLastBroadcastVersion = state.version;
    broadcastControlState(state);
  } catch (error) {
    console.error("Failed to load control state after notification", error);
  }
}

function scheduleReconnect(failed: pg.Client) {
  // A client can emit both error and end. Only the current client may start a
  // reconnect, otherwise one failure creates two independent retry loops.
  if (globalForControlPubSub.controlListenClient !== failed) return;

  globalForControlPubSub.controlListenClient = undefined;
  globalForControlPubSub.controlListenStarted = false;

  const attempt = globalForControlPubSub.controlListenAttempt ?? 0;
  globalForControlPubSub.controlListenAttempt = attempt + 1;
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, MAX_RECONNECT_DELAY_MS);

  void failed.end().catch(() => undefined);
  setTimeout(() => void ensureControlStateSubscription(), delay).unref?.();
}

async function startListener(connectionString: string) {
  const client = new pg.Client({ connectionString });
  globalForControlPubSub.controlListenClient = client;

  client.on("notification", (message) => {
    if (message.channel !== CONTROL_STATE_CHANNEL || !message.payload) return;
    void fanOutFromNotification(message.payload);
  });

  client.on("error", (error) => {
    console.error("Control state listener error", error);
    scheduleReconnect(client);
  });

  client.on("end", () => scheduleReconnect(client));

  await client.connect();
  await client.query(`LISTEN ${CONTROL_STATE_CHANNEL}`);
  globalForControlPubSub.controlListenAttempt = 0;
}

export async function publishControlState(state: PdfRemoteState) {
  globalForControlPubSub.controlLastBroadcastVersion = state.version;
  broadcastControlState(state);

  const pool = getNotifyPool();
  if (!pool) return;

  try {
    await pool.query("SELECT pg_notify($1, $2)", [
      CONTROL_STATE_CHANNEL,
      String(state.version),
    ]);
  } catch (error) {
    console.error("Failed to publish control state notification", error);
  }
}

export async function ensureControlStateSubscription() {
  if (globalForControlPubSub.controlListenStarted) return;

  const connectionString = resolveDirectDatabaseUrl();
  if (!connectionString) return;

  globalForControlPubSub.controlListenStarted = true;

  try {
    await startListener(connectionString);
  } catch (error) {
    // Pub/sub is an optimization over the durable database state. A listener
    // failure must never tear down /api/ws and trigger a browser request storm.
    console.error(
      "Failed to start the control-state listener. Cross-instance updates are " +
        "temporarily disabled; LISTEN/NOTIFY requires a direct Postgres URL.",
      error,
    );
    const client = globalForControlPubSub.controlListenClient;
    if (client) scheduleReconnect(client);
    else globalForControlPubSub.controlListenStarted = false;
  }
}
