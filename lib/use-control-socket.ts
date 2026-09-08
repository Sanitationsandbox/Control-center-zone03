"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PdfRemoteState } from "@/lib/pdf-control";
import type { ControlServerMessage } from "@/lib/control-events";

type SocketStatus = "connecting" | "connected" | "disconnected";

const HEARTBEAT_INTERVAL_MS = 5_000;
const HEARTBEAT_TIMEOUT_MS = 15_000;
const DEV_FALLBACK_INTERVAL_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 10_000;
const ENABLE_DEV_HTTP_FALLBACK = process.env.NODE_ENV === "development";
const LOCAL_CONTROL_CHANNEL = "rubenius-control-state";

type LocalControlMessage = {
  type: "LOCAL_CONTROL_STATE";
  state: PdfRemoteState;
};

function getSocketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/ws`;
}

export function broadcastLocalControlState(state: PdfRemoteState) {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;

  const channel = new BroadcastChannel(LOCAL_CONTROL_CHANNEL);
  channel.postMessage({ type: "LOCAL_CONTROL_STATE", state } satisfies LocalControlMessage);
  channel.close();
}

export function useControlSocket() {
  const [state, setState] = useState<PdfRemoteState | null>(null);
  const [status, setStatus] = useState<SocketStatus>("connecting");
  const [latency, setLatency] = useState<number | null>(null);
  const latestVersion = useRef(0);
  const socketRef = useRef<WebSocket | null>(null);

  const applyState = useCallback((nextState: PdfRemoteState) => {
    if (nextState.version < latestVersion.current) return;
    latestVersion.current = nextState.version;
    setState(nextState);
  }, []);

  const sync = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "SYNC" }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let localChannel: BroadcastChannel | undefined;
    let reconnectTimer: number | undefined;
    let heartbeatTimer: number | undefined;
    let fallbackTimer: number | undefined;
    let attempt = 0;
    let pingId = 0;
    let initialStateInFlight = false;
    let lastPing: { id: number; at: number } | null = null;
    let lastPongAt = Date.now();

    /**
     * One-shot bootstrap so a wall paints correct content before the socket
     * finishes opening. This is not polling — it never repeats; every later
     * update arrives over the socket.
     */
    async function loadInitialState() {
      if (initialStateInFlight) return;

      initialStateInFlight = true;
      try {
        const response = await fetch("/api/pdf-control", { cache: "no-store" });
        if (!response.ok) throw new Error("State request failed");

        const data = (await response.json()) as PdfRemoteState;
        if (cancelled) return;

        applyState(data);
        if (ENABLE_DEV_HTTP_FALLBACK) {
          setStatus("connected");
        }
      } catch {
        // Only report offline if the socket hasn't already come up underneath us.
        if (cancelled) return;
        if (socketRef.current?.readyState === WebSocket.OPEN) return;
        setStatus("disconnected");
      } finally {
        initialStateInFlight = false;
      }
    }

    function stopHeartbeat() {
      if (heartbeatTimer) window.clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
      lastPing = null;
    }

    function stopFallback() {
      if (fallbackTimer) window.clearInterval(fallbackTimer);
      fallbackTimer = undefined;
    }

    function startHeartbeat(socket: WebSocket) {
      stopHeartbeat();
      lastPongAt = Date.now();

      heartbeatTimer = window.setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) return;

        // A socket can sit in OPEN long after it has stopped delivering anything.
        // Missing pongs are the only signal that this has happened, and with no
        // polling behind it, a silently dead socket means a frozen wall.
        if (Date.now() - lastPongAt > HEARTBEAT_TIMEOUT_MS) {
          socket.close();
          return;
        }

        pingId += 1;
        lastPing = { id: pingId, at: performance.now() };
        socket.send(JSON.stringify({ type: "PING", id: pingId }));
      }, HEARTBEAT_INTERVAL_MS);
    }

    function connect() {
      setStatus("connecting");

      const socket = new WebSocket(getSocketUrl());
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        attempt = 0;
        setStatus("connected");
        startHeartbeat(socket);
        socket.send(JSON.stringify({ type: "SYNC" }));
      });

      socket.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(event.data as string) as ControlServerMessage;

          if (message.type === "PONG") {
            lastPongAt = Date.now();
            if (lastPing?.id === message.id) {
              setLatency(Math.round(performance.now() - lastPing.at));
            }
            return;
          }

          if (
            message.type === "INITIAL_STATE" ||
            message.type === "STATE_SYNC" ||
            message.type === "CONTROL_STATE_CHANGED"
          ) {
            applyState(message.state);
          }
        } catch {
          // Ignore malformed WebSocket messages.
        }
      });

      socket.addEventListener("close", () => {
        stopHeartbeat();
        if (cancelled) return;

        setStatus("disconnected");
        setLatency(null);
        const delay = Math.min(1000 * 2 ** attempt, MAX_RECONNECT_DELAY_MS);
        attempt += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      });

      socket.addEventListener("error", () => {
        socket.close();
      });
    }

    if (ENABLE_DEV_HTTP_FALLBACK) {
      if ("BroadcastChannel" in window) {
        localChannel = new BroadcastChannel(LOCAL_CONTROL_CHANNEL);
        localChannel.addEventListener("message", (event: MessageEvent<LocalControlMessage>) => {
          if (event.data?.type === "LOCAL_CONTROL_STATE") {
            applyState(event.data.state);
            setStatus("connected");
          }
        });
      }

      void loadInitialState();
      fallbackTimer = window.setInterval(
        () => void loadInitialState(),
        DEV_FALLBACK_INTERVAL_MS,
      );

      return () => {
        cancelled = true;
        localChannel?.close();
        stopFallback();
      };
    }

    void loadInitialState();
    connect();

    return () => {
      cancelled = true;
      stopHeartbeat();
      stopFallback();
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socketRef.current?.close();
    };
  }, [applyState]);

  return { state, status, latency, sync };
}
