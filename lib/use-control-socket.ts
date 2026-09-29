"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PdfRemoteState } from "@/lib/pdf-control";
import type { ControlServerMessage } from "@/lib/control-events";

type SocketStatus = "connecting" | "connected" | "disconnected";

const HEARTBEAT_INTERVAL_MS = 5_000;
const HEARTBEAT_TIMEOUT_MS = 15_000;
const DEV_FALLBACK_INTERVAL_MS = 1_000;
const HEALTHY_CONNECTION_MS = 20_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const RECONNECT_JITTER_RATIO = 0.25;
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
    let healthyConnectionTimer: number | undefined;
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

    function stopHealthyConnectionTimer() {
      if (healthyConnectionTimer) window.clearTimeout(healthyConnectionTimer);
      healthyConnectionTimer = undefined;
    }

    function markConnectionHealthy(socket: WebSocket) {
      if (healthyConnectionTimer) return;

      // A successful HTTP upgrade is not enough to reset retry pressure: a
      // broken server can open and immediately close forever. Require a valid
      // state message and sustained health before returning to a 1s retry.
      healthyConnectionTimer = window.setTimeout(() => {
        healthyConnectionTimer = undefined;
        if (socketRef.current === socket && socket.readyState === WebSocket.OPEN) {
          attempt = 0;
        }
      }, HEALTHY_CONNECTION_MS);
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
            markConnectionHealthy(socket);
          }
        } catch {
          // Ignore malformed WebSocket messages.
        }
      });

      socket.addEventListener("close", () => {
        stopHeartbeat();
        stopHealthyConnectionTimer();
        if (cancelled) return;

        setStatus("disconnected");
        setLatency(null);
        const baseDelay = Math.min(1000 * 2 ** attempt, MAX_RECONNECT_DELAY_MS);
        const jitter = Math.round(baseDelay * RECONNECT_JITTER_RATIO * Math.random());
        const delay = baseDelay + jitter;
        attempt = Math.min(attempt + 1, 10);
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
      stopHealthyConnectionTimer();
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socketRef.current?.close();
    };
  }, [applyState]);

  return { state, status, latency, sync };
}
