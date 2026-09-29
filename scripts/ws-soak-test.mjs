#!/usr/bin/env node

import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import WebSocket, { WebSocketServer } from "ws";

const STATE_TYPES = new Set([
  "INITIAL_STATE",
  "STATE_SYNC",
  "CONTROL_STATE_CHANGED",
]);

function readNumber(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(args[index + 1]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
}

function readString(args, name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function projectedRetryAttempts(totalMs, maxDelayMs, jitterRatio) {
  let elapsed = 0;
  let attempt = 0;
  let connections = 1;

  while (true) {
    const baseDelay = Math.min(1_000 * 2 ** attempt, maxDelayMs);
    const expectedDelay = baseDelay * (1 + jitterRatio / 2);
    elapsed += expectedDelay;
    if (elapsed >= totalMs) return connections;
    connections += 1;
    attempt = Math.min(attempt + 1, 10);
  }
}

function buildProjection(options) {
  const totalMs = options.projectDays * 24 * 60 * 60 * 1_000;
  const expectedReconnectDelayMs = 1_000 * (1 + options.jitterRatio / 2);
  const healthyCycleMs = options.expectedSocketLifetimeMs + expectedReconnectDelayMs;
  const healthyConnectionsPerClient = 1 + Math.floor(totalMs / healthyCycleMs);
  const failureConnectionsPerClient = projectedRetryAttempts(
    totalMs,
    options.maxReconnectDelayMs,
    options.jitterRatio,
  );
  const heartbeatsPerClient = Math.floor(totalMs / options.heartbeatIntervalMs);

  return {
    days: options.projectDays,
    clients: options.clients,
    assumptions: {
      expectedSocketLifetimeSeconds: options.expectedSocketLifetimeMs / 1_000,
      heartbeatIntervalSeconds: options.heartbeatIntervalMs / 1_000,
      maximumFailureBackoffSeconds: options.maxReconnectDelayMs / 1_000,
      note: "Static assets, media range requests, user navigation, and controller commands are excluded.",
    },
    healthy: {
      websocketUpgradeRequests: healthyConnectionsPerClient * options.clients,
      bootstrapApiRequests: options.clients,
      initialPageRequests: options.clients,
      controlledEdgeRequestMinimum:
        healthyConnectionsPerClient * options.clients + options.clients * 2,
      databaseStateLoads: healthyConnectionsPerClient * options.clients * 2,
      heartbeatPings: heartbeatsPerClient * options.clients,
      heartbeatFramesBothDirections: heartbeatsPerClient * options.clients * 2,
    },
    persistentFailure: {
      websocketUpgradeRequestsWithBackoff: failureConnectionsPerClient * options.clients,
      websocketUpgradeRequestsWithOldOneSecondLoop:
        Math.floor(totalMs / 1_000) * options.clients,
      reductionVersusOldLoopPercent:
        100 - (failureConnectionsPerClient / Math.floor(totalMs / 1_000)) * 100,
    },
  };
}

async function startMockServer(closeAfterMs) {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));

  server.on("connection", (socket) => {
    socket.send(
      JSON.stringify({
        type: "INITIAL_STATE",
        state: { version: 1, activePdfId: null, videoPlaying: false, documents: {} },
      }),
    );

    socket.on("message", (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.type === "PING") {
          socket.send(JSON.stringify({ type: "PONG", id: message.id }));
        } else if (message.type === "SYNC") {
          socket.send(
            JSON.stringify({
              type: "STATE_SYNC",
              state: { version: 1, activePdfId: null, videoPlaying: false, documents: {} },
            }),
          );
        }
      } catch {
        socket.close(1003, "Invalid JSON");
      }
    });

    if (closeAfterMs > 0) {
      const timer = setTimeout(() => socket.close(1012, "Simulated restart"), closeAfterMs);
      timer.unref?.();
    }
  });

  const address = server.address();
  return {
    server,
    url: `ws://127.0.0.1:${address.port}/api/ws`,
  };
}

async function runSoak(options) {
  const startedAt = Date.now();
  const startedPerformance = performance.now();
  const eventLoop = monitorEventLoopDelay({ resolution: 20 });
  eventLoop.enable();

  const metrics = {
    connectionAttempts: 0,
    connectionsOpened: 0,
    connectionsClosed: 0,
    connectionsFailedBeforeOpen: 0,
    peakConcurrentConnections: 0,
    currentConnections: 0,
    stateMessages: 0,
    pongMessages: 0,
    serverErrors: 0,
    parseErrors: 0,
    heartbeatTimeouts: 0,
    bytesSent: 0,
    bytesReceived: 0,
    closeCodes: {},
    latencyMs: [],
    reconnectDelayMs: [],
  };

  let stopping = false;
  const clients = [];

  function makeClient(id) {
    const client = {
      id,
      socket: null,
      attempt: 0,
      pingId: 0,
      lastPongAt: 0,
      lastPing: null,
      heartbeatTimer: null,
      healthyTimer: null,
      reconnectTimer: null,
    };

    function clearTimers() {
      if (client.heartbeatTimer) clearInterval(client.heartbeatTimer);
      if (client.healthyTimer) clearTimeout(client.healthyTimer);
      if (client.reconnectTimer) clearTimeout(client.reconnectTimer);
      client.heartbeatTimer = null;
      client.healthyTimer = null;
      client.reconnectTimer = null;
    }

    function send(message) {
      if (client.socket?.readyState !== WebSocket.OPEN) return;
      const payload = JSON.stringify(message);
      metrics.bytesSent += Buffer.byteLength(payload);
      client.socket.send(payload);
    }

    function scheduleHealthyReset(socket) {
      if (client.healthyTimer) return;
      client.healthyTimer = setTimeout(() => {
        client.healthyTimer = null;
        if (client.socket === socket && socket.readyState === WebSocket.OPEN) {
          client.attempt = 0;
        }
      }, options.healthyConnectionMs);
    }

    function connect() {
      if (stopping) return;
      metrics.connectionAttempts += 1;
      const socket = new WebSocket(options.url);
      client.socket = socket;
      let opened = false;

      socket.on("open", () => {
        opened = true;
        metrics.connectionsOpened += 1;
        metrics.currentConnections += 1;
        metrics.peakConcurrentConnections = Math.max(
          metrics.peakConcurrentConnections,
          metrics.currentConnections,
        );
        client.lastPongAt = Date.now();
        send({ type: "SYNC" });

        client.heartbeatTimer = setInterval(() => {
          if (socket.readyState !== WebSocket.OPEN) return;
          if (Date.now() - client.lastPongAt > options.heartbeatTimeoutMs) {
            metrics.heartbeatTimeouts += 1;
            socket.terminate();
            return;
          }
          client.pingId += 1;
          client.lastPing = { id: client.pingId, at: performance.now() };
          send({ type: "PING", id: client.pingId });
        }, options.heartbeatIntervalMs);
      });

      socket.on("message", (raw) => {
        metrics.bytesReceived += raw.length;
        try {
          const message = JSON.parse(raw.toString());
          if (message.type === "PONG") {
            metrics.pongMessages += 1;
            client.lastPongAt = Date.now();
            if (client.lastPing?.id === message.id) {
              metrics.latencyMs.push(performance.now() - client.lastPing.at);
            }
          } else if (STATE_TYPES.has(message.type)) {
            metrics.stateMessages += 1;
            scheduleHealthyReset(socket);
          } else if (message.type === "ERROR") {
            metrics.serverErrors += 1;
          }
        } catch {
          metrics.parseErrors += 1;
        }
      });

      socket.on("error", () => {
        // The close event owns retry scheduling and metrics.
      });

      socket.on("close", (code) => {
        if (client.heartbeatTimer) clearInterval(client.heartbeatTimer);
        if (client.healthyTimer) clearTimeout(client.healthyTimer);
        client.heartbeatTimer = null;
        client.healthyTimer = null;
        metrics.connectionsClosed += 1;
        metrics.closeCodes[code] = (metrics.closeCodes[code] ?? 0) + 1;
        if (opened) metrics.currentConnections = Math.max(0, metrics.currentConnections - 1);
        else metrics.connectionsFailedBeforeOpen += 1;
        if (stopping) return;

        const baseDelay = Math.min(
          1_000 * 2 ** client.attempt,
          options.maxReconnectDelayMs,
        );
        const jitter = Math.round(baseDelay * options.jitterRatio * Math.random());
        const delay = baseDelay + jitter;
        metrics.reconnectDelayMs.push(delay);
        client.attempt = Math.min(client.attempt + 1, 10);
        client.reconnectTimer = setTimeout(connect, delay);
      });
    }

    client.stop = () => {
      clearTimers();
      if (client.socket?.readyState === WebSocket.OPEN) client.socket.close(1000, "Test complete");
      else client.socket?.terminate();
    };
    client.connect = connect;
    return client;
  }

  for (let index = 0; index < options.clients; index += 1) {
    const client = makeClient(index + 1);
    clients.push(client);
    client.connect();
  }

  await new Promise((resolve) => setTimeout(resolve, options.durationMs));
  stopping = true;
  for (const client of clients) client.stop();
  await new Promise((resolve) => setTimeout(resolve, 100));
  eventLoop.disable();

  const memory = process.memoryUsage();
  const durationMs = performance.now() - startedPerformance;
  const report = {
    test: {
      url: options.url,
      clients: options.clients,
      startedAt: new Date(startedAt).toISOString(),
      durationSeconds: durationMs / 1_000,
      selfTest: options.selfTest,
      simulatedCloseAfterSeconds: options.mockCloseAfterMs / 1_000,
    },
    connections: {
      attempts: metrics.connectionAttempts,
      opened: metrics.connectionsOpened,
      closed: metrics.connectionsClosed,
      failedBeforeOpen: metrics.connectionsFailedBeforeOpen,
      peakConcurrent: metrics.peakConcurrentConnections,
      closeCodes: metrics.closeCodes,
      reconnectDelayMs: {
        min: metrics.reconnectDelayMs.length ? Math.min(...metrics.reconnectDelayMs) : null,
        max: metrics.reconnectDelayMs.length ? Math.max(...metrics.reconnectDelayMs) : null,
      },
    },
    messages: {
      state: metrics.stateMessages,
      pong: metrics.pongMessages,
      serverErrors: metrics.serverErrors,
      parseErrors: metrics.parseErrors,
      heartbeatTimeouts: metrics.heartbeatTimeouts,
      bytesSent: metrics.bytesSent,
      bytesReceived: metrics.bytesReceived,
    },
    latencyMs: {
      samples: metrics.latencyMs.length,
      average: metrics.latencyMs.length
        ? metrics.latencyMs.reduce((sum, value) => sum + value, 0) / metrics.latencyMs.length
        : null,
      p50: percentile(metrics.latencyMs, 0.5),
      p95: percentile(metrics.latencyMs, 0.95),
      maximum: metrics.latencyMs.length ? Math.max(...metrics.latencyMs) : null,
    },
    process: {
      rssMb: memory.rss / 1024 / 1024,
      heapUsedMb: memory.heapUsed / 1024 / 1024,
      eventLoopDelayMs: {
        average: Number.isNaN(eventLoop.mean) ? null : eventLoop.mean / 1e6,
        p95: eventLoop.percentile(95) / 1e6,
        maximum: eventLoop.max / 1e6,
      },
    },
    projection: buildProjection(options),
  };

  report.verdict = {
    passed:
      metrics.connectionsOpened > 0 &&
      metrics.serverErrors === 0 &&
      metrics.parseErrors === 0 &&
      metrics.heartbeatTimeouts === 0 &&
      (report.latencyMs.p95 === null || report.latencyMs.p95 <= options.maxP95LatencyMs),
    checks: {
      openedAtLeastOneConnection: metrics.connectionsOpened > 0,
      noServerErrorMessages: metrics.serverErrors === 0,
      noProtocolParseErrors: metrics.parseErrors === 0,
      noHeartbeatTimeouts: metrics.heartbeatTimeouts === 0,
      p95LatencyWithinLimit:
        report.latencyMs.p95 === null || report.latencyMs.p95 <= options.maxP95LatencyMs,
    },
  };

  return report;
}

function printReport(report) {
  console.log("\nWebSocket soak-test result");
  console.log(`  Verdict: ${report.verdict.passed ? "PASS" : "FAIL"}`);
  console.log(`  Duration: ${formatNumber(report.test.durationSeconds)}s`);
  console.log(`  Clients: ${report.test.clients}`);
  console.log(`  Connection attempts/opened: ${report.connections.attempts}/${report.connections.opened}`);
  console.log(`  Peak open connections: ${report.connections.peakConcurrent}`);
  console.log(`  State messages / pongs: ${report.messages.state}/${report.messages.pong}`);
  console.log(`  Heartbeat timeouts: ${report.messages.heartbeatTimeouts}`);
  console.log(
    `  Latency avg/p95/max: ${formatNumber(report.latencyMs.average ?? 0)} / ` +
      `${formatNumber(report.latencyMs.p95 ?? 0)} / ${formatNumber(report.latencyMs.maximum ?? 0)} ms`,
  );
  console.log(
    `  Process RSS / heap: ${formatNumber(report.process.rssMb)} / ` +
      `${formatNumber(report.process.heapUsedMb)} MB`,
  );
  console.log(`\n${report.projection.days}-day projection (${report.projection.clients} clients)`);
  console.log(
    `  Healthy WebSocket Edge Requests: ` +
      formatNumber(report.projection.healthy.websocketUpgradeRequests),
  );
  console.log(
    `  Controlled-path Edge Request minimum: ` +
      formatNumber(report.projection.healthy.controlledEdgeRequestMinimum),
  );
  console.log(
    `  Database state loads: ${formatNumber(report.projection.healthy.databaseStateLoads)}`,
  );
  console.log(
    `  Heartbeat frames, both directions: ` +
      formatNumber(report.projection.healthy.heartbeatFramesBothDirections),
  );
  console.log(
    `  Persistent failure with new backoff: ` +
      formatNumber(report.projection.persistentFailure.websocketUpgradeRequestsWithBackoff),
  );
  console.log(
    `  Persistent failure with old 1s loop: ` +
      formatNumber(report.projection.persistentFailure.websocketUpgradeRequestsWithOldOneSecondLoop),
  );
  console.log(
    `  Failure-storm reduction: ` +
      `${formatNumber(report.projection.persistentFailure.reductionVersusOldLoopPercent)}%`,
  );
  console.log("\nJSON report");
  console.log(JSON.stringify(report, null, 2));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(`Usage:
  npm run test:soak -- --url wss://your-domain/api/ws --clients 3 --duration 3600
  npm run test:soak:self -- --clients 3 --duration 20

Options:
  --url <ws(s) URL>              Required unless --self-test is used
  --clients <count>              Concurrent display clients (default: 3)
  --duration <seconds>           Real soak-test duration (default: 60)
  --project-days <days>          Capacity projection period (default: 30)
  --expected-lifetime <seconds>  Vercel socket lifetime (default: 300)
  --max-p95-ms <milliseconds>    Latency pass threshold (default: 1000)
  --self-test                    Start a protocol-compatible local server
  --mock-close-after <seconds>   Force local sockets to close for retry testing
`);
    return;
  }

  const selfTest = args.includes("--self-test");
  const options = {
    selfTest,
    url: readString(args, "--url", null),
    clients: readNumber(args, "--clients", 3),
    durationMs: readNumber(args, "--duration", 60) * 1_000,
    projectDays: readNumber(args, "--project-days", 30),
    expectedSocketLifetimeMs: readNumber(args, "--expected-lifetime", 300) * 1_000,
    maxP95LatencyMs: readNumber(args, "--max-p95-ms", 1_000),
    heartbeatIntervalMs: 5_000,
    heartbeatTimeoutMs: 15_000,
    healthyConnectionMs: 20_000,
    maxReconnectDelayMs: 30_000,
    jitterRatio: 0.25,
    mockCloseAfterMs: readNumber(args, "--mock-close-after", 0.001) * 1_000,
  };

  if (!args.includes("--mock-close-after")) options.mockCloseAfterMs = 0;

  let mockServer;
  if (selfTest) {
    const mock = await startMockServer(options.mockCloseAfterMs);
    mockServer = mock.server;
    options.url = mock.url;
  }

  if (!options.url || !/^wss?:\/\//.test(options.url)) {
    throw new Error("Provide a valid --url ws:// or wss:// value, or use --self-test");
  }

  try {
    const report = await runSoak(options);
    printReport(report);
    process.exitCode = report.verdict.passed ? 0 : 1;
  } finally {
    if (mockServer) await new Promise((resolve) => mockServer.close(resolve));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
