# WebSocket performance and 30-day capacity testing

The soak test speaks the application's real `SYNC` and `PING`/`PONG` protocol,
tracks connection churn and latency, and projects the measured configuration over
a 30-day 24×7 period. Its Edge Request projection covers the routes controlled by
the realtime client; static assets, media ranges, human navigation, and controller
commands must still be read from Vercel Observability.

## Quick validation

```bash
npm run test:soak:self -- --clients 3 --duration 20
```

Exercise reconnection backoff by forcing the local server to restart connections:

```bash
npm run test:soak:self -- --clients 3 --duration 45 --mock-close-after 2
```

## Preview or production soak test

Start with a Vercel Preview deployment. One hour is a useful deployment check:

```bash
npm run test:soak -- \
  --url wss://YOUR-PREVIEW-DOMAIN/api/ws \
  --clients 3 \
  --duration 3600 \
  --project-days 30
```

For a 24-hour soak, run the same command with `--duration 86400`. Keep the shell
session alive and redirect the JSON/text report using ordinary shell output
redirection if a persistent artifact is required.

## What to compare in Vercel

During the same time range, filter Observability by `/api/ws` and confirm:

- one successful upgrade per client at startup;
- only the expected duration-driven reconnect around every 300 seconds;
- no one-second or ten-second request pattern;
- no repeated `1011`, `500`, or `504` errors;
- no `Failed to start the control-state listener` log entries;
- controller changes continue to reach separate preview devices.

The report's healthy projection assumes a 300-second Vercel function lifetime.
Change it with `--expected-lifetime` if the deployment uses a different duration.
Heartbeat frames are WebSocket messages rather than new Edge Requests, but they
are reported because they still exercise function CPU and network processing.
