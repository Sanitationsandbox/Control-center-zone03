# Prompt: port the realtime control architecture into this app

Hand this to a Claude Code session running **in the target application's directory**.
Fill in the two placeholders in "Your task" first.

---

## Context

You are replacing HTTP polling with a WebSocket push architecture in a Next.js 16
"control center" app: an operator page drives one or more full-screen preview
walls, and today the walls discover changes by polling an API on a timer.

A working reference implementation already exists at:

```
/Users/nikhil/Desktop/tes/Control-center-zone03
```

Read these files there before writing anything. They are the spec:

- `lib/pdf-control.ts` — shared state shape (`PdfRemoteState`, includes `version`)
- `lib/control-state.ts` — Prisma reads/writes, monotonic version, command validation
- `lib/control-events.ts` — message types, in-process client registry, broadcast
- `lib/control-pubsub.ts` — ioredis publish/subscribe fan-out across instances
- `app/api/ws/route.ts` — the WebSocket route
- `app/api/pdf-control/route.ts` — GET state / POST command
- `lib/use-control-socket.ts` — browser hook
- `prisma/migrations/*_add_control_state_version_sequence/migration.sql`

Do not blindly copy the files. The target app's state shape, route names, page
structure and Prisma schema will differ. Port the *architecture* and adapt.

## Repo rule you must follow

This project family pins **Next.js 16.2.9**, which has breaking changes relative to
your training data. Per `AGENTS.md`, read the relevant guide under
`node_modules/next/dist/docs/` before writing route handlers or config. If
`node_modules` is absent, run `npm install` first.

## Architecture to build

1. **Shared state service** (`lib/control-state.ts`). All Prisma reads and writes
   for control state live here, not in route handlers. Expose `loadControlState()`
   and `applyControlCommand(command)`. Every state value carries a `version`.
2. **Event types** (`lib/control-events.ts`). Stable message shapes:
   `INITIAL_STATE`, `STATE_SYNC`, `CONTROL_STATE_CHANGED`, `PONG`, `ERROR` from the
   server; `SYNC` and `PING` from the client. **Every state message carries the
   complete state object** — never a partial or a delta.
3. **Redis pub/sub** (`lib/control-pubsub.ts`). Use `ioredis`, not `@upstash/redis`:
   a subscription needs a long-lived connection, which the HTTP-based client cannot
   hold. Publish after a successful database write; subscribe inside the WS route.
4. **WebSocket route** (`app/api/ws/route.ts`). Use
   `experimental_upgradeWebSocket` from `@vercel/functions`. On connect send
   `INITIAL_STATE`; answer `SYNC` with `STATE_SYNC` and `PING` with `PONG`.
5. **Command route**. `GET` returns `loadControlState()`. `POST` validates, calls
   `applyControlCommand()`, publishes the returned state, and returns that same
   full state. Every command response must be the full state — watch for existing
   handlers that return a partial like `{ id, document }`.
6. **Browser hook** (`lib/use-control-socket.ts`). Returns
   `{ state, status, latency, sync }`. One-shot bootstrap fetch on mount, then the
   socket is the only channel. Applies incoming state only when
   `version >= latestApplied`.
7. **Delete the polling.** Every `setInterval` that refetches control state comes
   out. Each surface derives its content from pushed state.

## Bugs the reference implementation already hit — do not reintroduce them

These were all found in review after the first implementation. They are the
expensive part of this task; the plumbing is easy.

1. **Never derive `version` from a timestamp.** `Date.now()` or Prisma's
   `@updatedAt` is stamped per function instance, and skewed clocks across
   instances make version numbers go *backwards* — clients then discard newer
   state permanently and a wall stays wrong until reload. Use a Postgres sequence
   (`CREATE SEQUENCE`, then `nextval()`), or Redis `INCR`. Read the sequence with
   `SELECT last_value, is_called` and normalise the not-yet-called case to zero.
2. **Bump the version and snapshot the state in the same transaction**, so the
   version always describes exactly the state shipped alongside it.
3. **Resubscribe to Redis on `"ready"`**, which fires on the initial connect and
   after every reconnect. Do not gate subscription behind a module-level boolean
   that only a new client connection can reset — a Redis blip then freezes every
   already-connected wall permanently, with sockets still reporting `connected`.
4. **Fail loudly when `REDIS_URL` is missing in production.** A silent no-op
   fan-out means a command reaches only the walls on the instance that handled the
   POST, with no error anywhere. Throw **lazily at first use**, not at module
   scope: a module-scope throw also fails `next build`, which collects page data
   for every route handler.
5. **Set `maxDuration` on the WS route.** Connections are bound to invocation
   lifetime. 300 is valid on every Vercel plan; 800 needs Pro/Enterprise with
   Fluid Compute. Reconnect is a normal, continuous event, not an error path.
6. **Add a `PING`/`PONG` heartbeat, not a `SYNC` heartbeat.** A socket can sit in
   `readyState === OPEN` long after it stops delivering; missed pongs are the only
   signal. Beat every ~5s, force-close after ~15s of silence, reconnect with capped
   backoff, and re-`SYNC` on open. Use `PING`/`PONG` because a `SYNC` heartbeat
   costs a database transaction per beat per client.
7. **Don't write on a no-op command.** If a navigate clamps to the page already
   shown, skip the write, the version bump and the broadcast — otherwise
   end-of-deck button mashing wakes every wall for nothing.
8. **Don't let the bootstrap fetch's error handler set `disconnected`** when the
   socket has already opened underneath it.
9. **Read `totalPages` from state** rather than hardcoding a page count in the UI.
10. **Render an idle splash, not nothing**, while `state === null`. A blank
    full-screen wall during every connect is visible to the audience.

## Explicit non-goals

- **No polling fallback.** This was considered and rejected. The socket is the only
  channel. Do not add a timer that refetches state when the socket is down.
- Do not change the durable source of truth. Prisma stays authoritative; Redis
  only fans out change notifications.

## Known consequence, accept it

`experimental_upgradeWebSocket` reads `globalThis[Symbol.for("@vercel/request-context")]`,
and Next.js does not set that symbol. Verify this yourself with a grep over
`node_modules/next/dist/` rather than assuming. It means `/api/ws` **cannot
upgrade under `npm run dev` or `npm run start`** — only on a Vercel deployment.
So local runs are a compile/render check only, and functional verification happens
on a preview deploy. Do not treat the local failure as a regression, and do not
"fix" it by adding polling.

## Your task

Target application: `<ABSOLUTE PATH TO THE TARGET REPO>`
Starting point: `<one of: still polling on a timer | already has a WebSocket layer that needs fixing>`

1. Run `git status --short` and leave unrelated local changes untouched.
2. Survey the target: find every `setInterval` that refetches control state, the
   existing control API route(s), the preview and operator surfaces, and the Prisma
   schema. Report what you found and how it differs from the reference before you
   start editing.
3. Install what's missing: `npm install @vercel/functions ws ioredis` and
   `npm install -D @types/ws`. Add `serverExternalPackages: ["ioredis", "ws"]` to
   `next.config.ts`.
4. Implement the seven architecture points above, avoiding all ten listed bugs.
5. Add a `.env.example` documenting `DATABASE_URL`, `REDIS_URL` and any other
   required vars. If `.gitignore` has a blanket `.env*`, add `!.env.example` or the
   file is useless.
6. Delete any component left unreferenced by the migration rather than leaving it
   to rot.
7. Verify: `npm run lint`, `npx tsc --noEmit`, `npm run build`. Report pre-existing
   lint or build failures separately from anything you introduced — do not silently
   fix unrelated ones, and do not claim success while they're outstanding.
8. State clearly what you could **not** verify: the migration if you have no
   database, and all runtime behaviour, which needs a preview deploy. Do not deploy
   on the user's behalf.

Report at the end: what changed, any deviation from this prompt and why, what's
verified vs. unverified, and the exact commands the user must run themselves.
