import {
  experimental_upgradeWebSocket,
  type WebSocketData,
} from "@vercel/functions";
import {
  parseControlMessage,
  registerControlClient,
  sendControlMessage,
  unregisterControlClient,
} from "@/lib/control-events";
import { ensureControlStateSubscription } from "@/lib/control-pubsub";
import { loadControlState } from "@/lib/control-state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A WebSocket lives exactly as long as its invocation, so this is the ceiling on
// how long a wall stays connected before it has to reconnect. 300s is the limit
// on every plan; raise it to 800 on Pro/Enterprise with Fluid Compute enabled.
export const maxDuration = 300;

export async function GET() {
  return experimental_upgradeWebSocket(async (ws) => {
    registerControlClient(ws);

    ws.on("message", async (data: WebSocketData) => {
      const message = parseControlMessage(data);
      if (!message) return;

      // PING is answered without touching the database: clients beat on it every
      // few seconds to measure latency and to notice a socket that reports OPEN
      // but has stopped delivering.
      if (message.type === "PING") {
        sendControlMessage(ws, { type: "PONG", id: message.id });
        return;
      }

      sendControlMessage(ws, {
        type: "STATE_SYNC",
        state: await loadControlState(),
      });
    });

    ws.on("close", () => unregisterControlClient(ws));
    ws.on("error", () => unregisterControlClient(ws));

    try {
      await ensureControlStateSubscription();

      sendControlMessage(ws, {
        type: "INITIAL_STATE",
        state: await loadControlState(),
      });
    } catch (error) {
      // Database failure is fatal to this connection, but the client retains
      // exponential backoff until a connection has remained healthy. A broken
      // deployment therefore cannot become an Edge Request storm.
      console.error("Failed to initialize control WebSocket", error);
      sendControlMessage(ws, {
        type: "ERROR",
        message: "Control state is temporarily unavailable",
      });
      unregisterControlClient(ws);
      ws.close(1011, "Control state unavailable");
    }
  });
}
