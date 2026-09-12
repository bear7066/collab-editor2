# Vercel + Neon migration with GitHub login — design

Status: approved 2026-09-12. Owner: bear7066.

## Goal

Run Collab Editor with no self-managed server: static frontend and API on
Vercel, data in Neon Postgres, access restricted to whitelisted GitHub
accounts. Single-user use; realtime keystroke sync is not required.

## Decisions

- Everything on Vercel. The Bun/Express/WebSocket/SQLite backend, the
  standalone binary build, `install.sh` and the release workflow are removed.
- Boards and projects keep their Yjs document model but sync over HTTP
  (push/pull of Yjs updates) instead of WebSocket.
- Presence (remote cursors, online count) is dropped; connection status
  becomes save status.
- Fresh Neon database; SQLite data is not migrated.
- Login: GitHub OAuth, whitelist by numeric GitHub ID (`ALLOWED_GITHUB_IDS`,
  bear7066 = 86918643).

## Architecture

```
browser ──HTTPS (same origin)──▶ Vercel
                                  ├─ static Vite build (packages/frontend/dist)
                                  └─ /api/*.ts  (Node.js runtime, Web fetch handlers)
                                        └─ @neondatabase/serverless (HTTP) ─▶ Neon
```

API files use fixed names plus query parameters (no dynamic route segments):

| Endpoint | Purpose |
|---|---|
| `GET /api/auth/me` | current user or 401 |
| `GET /api/auth/login?returnTo=` | start OAuth |
| `GET /api/auth/callback` | finish OAuth, set session |
| `POST /api/auth/logout` | clear session |
| `GET /api/doc?kind=&name=&sv=` | pull: diff against client state vector |
| `POST /api/doc?kind=&name=&sv=` | push a Yjs update (binary body), returns diff |
| `GET /api/boards`, `GET /api/projects` | dashboard lists |
| `PUT /api/markdown?name=` | project plain-text markdown for the dashboard |

Handlers stay thin; logic lives in `server/` and is unit-tested without
Vercel or Neon.

## Data model

- `documents(id PK = "<kind>/<name>", kind, name, markdown, created_at, updated_at)`
- `document_updates(id BIGSERIAL, document_id FK, data BYTEA, created_at)`

Rules:
- Updates are append-only; concurrent pushes never overwrite each other.
- New board seeding is atomic: one statement inserts the document with
  `ON CONFLICT DO NOTHING` and inserts the seed update only if the insert
  happened, so a board is seeded exactly once.
- Compaction when a document has more than 50 update rows: read rows up to
  `maxId`, merge, then in one transaction insert the merged row and delete
  rows `<= maxId`. Rows committed concurrently are untouched; duplicate merged
  rows are harmless because Yjs merges are idempotent.
- Binary data is passed as hex / read as base64 in SQL to avoid driver-specific
  bytea handling.

## Client sync (`HttpSyncProvider`)

- Local updates are queued and pushed ~800 ms after the last change; the
  queue is mirrored to sessionStorage so a crash or an auth redirect does not
  lose edits.
- Pull every 5 s while the tab is visible and the user was active within
  10 minutes; pull immediately when the tab becomes visible.
- Push failure: status `offline`, exponential backoff 2 s → 30 s. Re-sending an
  already-applied update is harmless.
- 401: status `unauthorized`, timers stop, queue stays in sessionStorage and
  is re-sent after login.
- Warn on page unload while changes are unsent.
- Exposes `synced`, `on('sync')`, and a local-only `awareness` so the
  Milkdown collab binding keeps working.

## Auth

- `/api/auth/login` stores a random `state` and the validated `returnTo`
  (same-site relative path only) in a short-lived httpOnly cookie, then
  redirects to GitHub with no extra scopes.
- `/api/auth/callback` checks `state`, exchanges the code, reads `/user`,
  checks the numeric ID against the whitelist. Denied → `/?auth=denied`.
  The GitHub token is discarded.
- Session cookie: `base64url(payload).base64url(HMAC-SHA256)` signed with
  `AUTH_SECRET`; payload `{ id, login, exp }`; httpOnly, SameSite=Lax, Secure
  on https; 30-day lifetime, refreshed when fewer than 7 days remain.
- Every data endpoint verifies signature, expiry, and whitelist membership.
  Mutating requests also require a same-origin `Origin` header.
- Frontend: `AuthGate` calls `/api/auth/me`; shows a zen login page, an
  access-denied page, or the app. Logout button on the dashboard.

## Environment

`DATABASE_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `AUTH_SECRET`,
`ALLOWED_GITHUB_IDS`. Values are set by the owner in `.env` (local) and the
Vercel dashboard; they are never committed or pasted into chat. Two GitHub
OAuth apps: production callback and `http://localhost:3000/api/auth/callback`.

Local development: `bun run dev` runs a small Bun server that serves the same
`api/*.ts` handlers plus Vite. Without `DATABASE_URL` (and never on Vercel) it
falls back to an in-memory store.

## Errors

| Case | Handling |
|---|---|
| invalid kind/name, name > 100 chars, malformed update | 400 |
| update body > 1 MB | 413 |
| unauthenticated / not whitelisted | 401 |
| cross-origin mutating request | 403 |
| Neon cold start | slower response, shown as "saving" |

## Testing

- `bun test` unit tests: session sign/verify/tamper/expiry/refresh, whitelist,
  returnTo and state validation; sync convergence of concurrent pushes,
  diff-only pulls, compaction preserving content, single seeding; provider
  debounce, retry/backoff, offline and unauthorized handling, background pause.
- Neon store contract tests run only when `TEST_DATABASE_URL` is set (a separate
  variable so tests never touch the production database).
- End-to-end: local dev server + headless browser, two pages editing one board
  converge; unauthenticated access shows login. The test signs its own session
  cookie with the dev `AUTH_SECRET`; the app has no auth bypass.
- Manual: real GitHub login on production; a non-whitelisted account is denied.
