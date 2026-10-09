import "server-only";

import { Rest } from "ably";
import type { PdfRemoteState } from "@/lib/pdf-control";

export const CONTROL_STATE_CHANNEL =
  process.env.NEXT_PUBLIC_ABLY_CONTROL_CHANNEL || "rubenius-control-state";

export const CONTROL_STATE_EVENT = "control-state-changed";

export type ControlStateChangedMessage = {
  type: "CONTROL_STATE_CHANGED";
  state: PdfRemoteState;
};

const globalForAbly = globalThis as typeof globalThis & {
  ablyRest?: Rest;
  ablyMissingKeyWarned?: boolean;
};

function getAblyPublisher() {
  const key = process.env.ABLY_ROOT_KEY;

  if (!key) {
    if (!globalForAbly.ablyMissingKeyWarned) {
      globalForAbly.ablyMissingKeyWarned = true;
      console.warn(
        "ABLY_ROOT_KEY is not set. Control-state changes will be saved, but realtime Ably broadcasts are disabled.",
      );
    }
    return null;
  }

  globalForAbly.ablyRest ??= new Rest({
    key,
    clientId: "zone03-control-api",
  });

  return globalForAbly.ablyRest;
}

export async function publishControlState(state: PdfRemoteState) {
  const ably = getAblyPublisher();
  if (!ably) return;

  const channel = ably.channels.get(CONTROL_STATE_CHANNEL);
  await channel.publish(CONTROL_STATE_EVENT, {
    type: "CONTROL_STATE_CHANGED",
    state,
  } satisfies ControlStateChangedMessage);
}
