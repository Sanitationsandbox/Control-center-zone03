import "server-only";

import type { RawData, WebSocket } from "ws";
import type { PdfRemoteState } from "@/lib/pdf-control";

export const CONTROL_STATE_CHANNEL = "control-state";

export type ControlClientMessage = { type: "SYNC" } | { type: "PING"; id: number };

export type ControlServerMessage =
  | { type: "INITIAL_STATE"; state: PdfRemoteState }
  | { type: "STATE_SYNC"; state: PdfRemoteState }
  | { type: "CONTROL_STATE_CHANGED"; state: PdfRemoteState }
  | { type: "PONG"; id: number }
  | { type: "ERROR"; message: string };

type ClientSet = Set<WebSocket>;

const globalForControlEvents = globalThis as typeof globalThis & {
  controlClients?: ClientSet;
};

const clients = globalForControlEvents.controlClients ?? new Set<WebSocket>();

if (process.env.NODE_ENV !== "production") {
  globalForControlEvents.controlClients = clients;
}

export function registerControlClient(ws: WebSocket) {
  clients.add(ws);
}

export function unregisterControlClient(ws: WebSocket) {
  clients.delete(ws);
}

export function sendControlMessage(
  ws: WebSocket,
  message: ControlServerMessage,
) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(message));
}

export function broadcastControlState(state: PdfRemoteState) {
  for (const client of clients) {
    sendControlMessage(client, { type: "CONTROL_STATE_CHANGED", state });
  }
}

export function parseControlMessage(data: RawData): ControlClientMessage | null {
  try {
    const parsed = JSON.parse(data.toString()) as Partial<ControlClientMessage>;

    if (parsed.type === "SYNC") return { type: "SYNC" };
    if (parsed.type === "PING" && typeof parsed.id === "number") {
      return { type: "PING", id: parsed.id };
    }

    return null;
  } catch {
    return null;
  }
}
