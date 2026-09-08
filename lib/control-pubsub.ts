import "server-only";

import Redis from "ioredis";
import { broadcastControlState, CONTROL_STATE_CHANNEL } from "@/lib/control-events";
import type { PdfRemoteState } from "@/lib/pdf-control";

const globalForControlPubSub = globalThis as typeof globalThis & {
  controlRedisPublisher?: Redis;
  controlRedisSubscriber?: Redis;
  controlRedisWarned?: boolean;
};

const MISSING_REDIS_MESSAGE =
  "REDIS_URL is not set. Control commands are broadcast only to WebSocket clients " +
  "attached to this process, so preview screens served by any other instance will " +
  "silently never update.";

/**
 * Resolves REDIS_URL, or decides how to fail. In production a missing URL is a
 * broken deployment — fan-out across function instances is the whole point — so
 * the caller throws and the request surfaces it. This is deliberately lazy rather
 * than a module-level throw: a module-level throw would also fail `next build`,
 * which collects page data for every route handler.
 */
function resolveRedisUrl(): string | null {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) return redisUrl;

  if (process.env.NODE_ENV === "production") {
    throw new Error(MISSING_REDIS_MESSAGE);
  }

  if (!globalForControlPubSub.controlRedisWarned) {
    globalForControlPubSub.controlRedisWarned = true;
    console.warn(`${MISSING_REDIS_MESSAGE} This is fine for single-process local development.`);
  }

  return null;
}

function getPublisher(): Redis | null {
  const redisUrl = resolveRedisUrl();
  if (!redisUrl) return null;

  globalForControlPubSub.controlRedisPublisher ??= new Redis(redisUrl);
  return globalForControlPubSub.controlRedisPublisher;
}

function getSubscriber(): Redis | null {
  const redisUrl = resolveRedisUrl();
  if (!redisUrl) return null;
  if (globalForControlPubSub.controlRedisSubscriber) {
    return globalForControlPubSub.controlRedisSubscriber;
  }

  const subscriber = new Redis(redisUrl);
  globalForControlPubSub.controlRedisSubscriber = subscriber;

  subscriber.on("message", (channel, message) => {
    if (channel !== CONTROL_STATE_CHANNEL) return;

    try {
      broadcastControlState(JSON.parse(message) as PdfRemoteState);
    } catch {
      // Ignore malformed pub/sub messages from outside this app.
    }
  });

  // ioredis reconnects the socket on its own, but the subscription has to be
  // re-established every time it comes back. Driving this off "ready" — which
  // fires on the initial connect and after every reconnect — is what keeps a
  // Redis blip from permanently freezing screens that are still connected.
  subscriber.on("ready", () => {
    subscriber.subscribe(CONTROL_STATE_CHANNEL).catch((error) => {
      console.error("Failed to subscribe to control state channel", error);
    });
  });

  subscriber.on("error", (error) => {
    console.error("Control state Redis subscriber error", error);
  });

  return subscriber;
}

export async function publishControlState(state: PdfRemoteState) {
  broadcastControlState(state);

  const publisher = getPublisher();
  if (!publisher) return;

  try {
    await publisher.publish(CONTROL_STATE_CHANNEL, JSON.stringify(state));
  } catch (error) {
    console.error("Failed to publish control state", error);
  }
}

export async function ensureControlStateSubscription() {
  const subscriber = getSubscriber();
  if (!subscriber) return;

  // The "ready" handler covers connect and reconnect; this call covers the case
  // where the client was already ready before this connection asked for it.
  if (subscriber.status === "ready") {
    await subscriber.subscribe(CONTROL_STATE_CHANNEL);
  }
}
