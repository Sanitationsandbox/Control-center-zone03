"use client";

import { Realtime, type ConnectionStateChange, type InboundMessage } from "ably";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ControlStateChangedMessage } from "@/lib/control-pubsub";
import type { PdfRemoteState } from "@/lib/pdf-control";

type SocketStatus = "connecting" | "connected" | "disconnected";

const ABLY_SUBSCRIBE_KEY = process.env.NEXT_PUBLIC_ABLY_SUBSCRIBE_KEY;
const CONTROL_STATE_CHANNEL =
  process.env.NEXT_PUBLIC_ABLY_CONTROL_CHANNEL || "rubenius-control-state";
const CONTROL_STATE_EVENT = "control-state-changed";
const LOCAL_CONTROL_CHANNEL = "rubenius-control-state";

type LocalControlMessage = {
  type: "LOCAL_CONTROL_STATE";
  state: PdfRemoteState;
};

function isControlStateChangedMessage(data: unknown): data is ControlStateChangedMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    data.type === "CONTROL_STATE_CHANGED" &&
    "state" in data
  );
}

export function broadcastLocalControlState(state: PdfRemoteState) {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;

  const channel = new BroadcastChannel(LOCAL_CONTROL_CHANNEL);
  channel.postMessage({ type: "LOCAL_CONTROL_STATE", state } satisfies LocalControlMessage);
  channel.close();
}

export function useControlSocket(initialState: PdfRemoteState | null = null) {
  const [state, setState] = useState<PdfRemoteState | null>(initialState);
  const [status, setStatus] = useState<SocketStatus>("connecting");
  const [latency, setLatency] = useState<number | null>(null);
  const latestVersion = useRef(initialState?.version ?? 0);
  const hasInitialState = useRef(initialState !== null);

  const applyState = useCallback((nextState: PdfRemoteState) => {
    if (nextState.version < latestVersion.current) return;
    latestVersion.current = nextState.version;
    setState(nextState);
  }, []);

  const sync = useCallback(async () => {
    try {
      const response = await fetch("/api/pdf-control", { cache: "no-store" });
      if (!response.ok) throw new Error("State request failed");
      applyState((await response.json()) as PdfRemoteState);
    } catch {
      setStatus("disconnected");
    }
  }, [applyState]);

  useEffect(() => {
    let cancelled = false;
    let localChannel: BroadcastChannel | undefined;
    let resyncInFlight = false;

    async function resyncCurrentState() {
      if (resyncInFlight) return;
      resyncInFlight = true;

      try {
        const response = await fetch("/api/pdf-control", { cache: "no-store" });
        if (!response.ok) throw new Error("State request failed");
        const data = (await response.json()) as PdfRemoteState;
        if (!cancelled) applyState(data);
      } catch {
        if (!cancelled) setStatus("disconnected");
      } finally {
        resyncInFlight = false;
      }
    }

    if ("BroadcastChannel" in window) {
      localChannel = new BroadcastChannel(LOCAL_CONTROL_CHANNEL);
      localChannel.addEventListener("message", (event: MessageEvent<LocalControlMessage>) => {
        if (event.data?.type === "LOCAL_CONTROL_STATE") {
          applyState(event.data.state);
        }
      });
    }

    if (!hasInitialState.current) {
      void resyncCurrentState();
    }

    if (!ABLY_SUBSCRIBE_KEY) {
      queueMicrotask(() => {
        if (!cancelled) setStatus("disconnected");
      });
      return () => {
        cancelled = true;
        localChannel?.close();
      };
    }

    const ably = new Realtime({
      key: ABLY_SUBSCRIBE_KEY,
      clientId: `zone03-display-${crypto.randomUUID()}`,
    });

    const channel = ably.channels.get(CONTROL_STATE_CHANNEL);

    const onMessage = (message: InboundMessage) => {
      if (!isControlStateChangedMessage(message.data)) return;
      applyState(message.data.state);
    };

    const onConnectionState = (change: ConnectionStateChange) => {
      if (cancelled) return;

      if (change.current === "connected") {
        setStatus("connected");
        void ably.connection.ping().then(setLatency).catch(() => setLatency(null));

        if (
          change.previous === "disconnected" ||
          change.previous === "suspended" ||
          change.previous === "failed"
        ) {
          void resyncCurrentState();
        }
        return;
      }

      if (change.current === "connecting" || change.current === "initialized") {
        setStatus("connecting");
        return;
      }

      setStatus("disconnected");
      setLatency(null);
    };

    ably.connection.on(onConnectionState);

    void channel.subscribe(CONTROL_STATE_EVENT, onMessage).catch(() => {
      if (!cancelled) setStatus("disconnected");
    });

    return () => {
      cancelled = true;
      localChannel?.close();
      channel.unsubscribe(CONTROL_STATE_EVENT, onMessage);
      ably.connection.off(onConnectionState);
      ably.close();
    };
  }, [applyState]);

  return { state, status, latency, sync };
}
