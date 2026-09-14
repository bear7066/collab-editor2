# Collab Editor

A personal Markdown editor and task board with a zen interface. Built with
**React**, **Yjs**, **Milkdown**, **Vercel Functions** and **Neon Postgres**,
behind GitHub sign-in restricted to a whitelist.

- **Boards**: task sections with owner groups, nested tasks, progress, links and archives, plus focused Note sections with collaborative Markdown and multi-file attachments.
- **Projects**: WYSIWYG (Milkdown Crepe) and raw Markdown editing.
- **Sync across devices**: edits save automatically about a second after you stop typing; other open devices pick them up within a few seconds. Concurrent edits merge (Yjs CRDT), and unsent edits survive going offline.
- **Private**: every API call requires a GitHub account listed in `ALLOWED_GITHUB_IDS`.
- **Light and dark**: the same zen palette in both. The header toggle cycles system → light → dark and remembers the choice on that device; dark is applied before first paint, so there is no white flash.
- **Iframe mode**: append `?iframe=true` to a board or project URL to hide the header.

Design notes: [`docs/superpowers/specs/2026-09-12-vercel-neon-auth-design.md`](docs/superpowers/specs/2026-09-12-vercel-neon-auth-design.md).

## Layout

```text
api/                  Vercel Functions (thin adapters over server/)
server/               API logic: auth, sync, storage (unit-tested)
scripts/              dev API server, database migration
packages/frontend/    Vite + React app
vercel.json           build output and SPA routing
```

## Deploying

You need a Neon project, two GitHub OAuth apps (production and local), and a Vercel account.

### 1. Neon

1. Create a project at [neon.tech](https://neon.tech). Keep the default `main` branch for production and create a `dev` branch for local work.
2. Copy each branch's connection string (the pooled one is fine).
3. Create the tables once per branch:

   ```bash
   DATABASE_URL='<connection string>' bun run db:migrate
   ```

### 2. GitHub OAuth apps

Create them at GitHub → Settings → Developer settings → OAuth Apps → New OAuth App:

| App | Homepage URL | Authorization callback URL |
|---|---|---|
| Production | `https://<your-domain>` | `https://<your-domain>/api/auth/callback` |
| Local | `http://localhost:3000` | `http://localhost:3000/api/auth/callback` |

For each, note the Client ID and generate a Client secret. If you don't have a domain yet, deploy once (step 3) to get the `*.vercel.app` URL, then create the production app.

### 3. Vercel

1. Import the GitHub repository at [vercel.com/new](https://vercel.com/new). `vercel.json` sets the build; leave the framework preset as "Other".
2. Under Settings → Environment Variables (Production), add:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Neon `main` branch connection string |
   | `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | production OAuth app |
   | `AUTH_SECRET` | output of `openssl rand -base64 32` |
   | `ALLOWED_GITHUB_IDS` | `86918643,99878260,91186819` (bear7066, THChou1220, GNITOAHC) |

3. Redeploy, open the site, and sign in with GitHub.

To look up someone's numeric GitHub id: `curl -s https://api.github.com/users/<login> | grep '"id"'`.
To sign everyone out, change `AUTH_SECRET` and redeploy.

## Local development

```bash
bun install
cp .env.example .env    # fill in the local OAuth app, AUTH_SECRET, and optionally DATABASE_URL (Neon dev branch)
bun run dev             # http://localhost:3000
```

`bun run dev` starts Vite on port 3000 and a small Bun server on port 3001 that serves the same `api/*.ts` handlers. Without `DATABASE_URL` it uses an in-memory store that is cleared on restart (this fallback is disabled on Vercel).

```bash
bun test            # unit tests
bun run typecheck   # server + frontend
bun run build       # production frontend build
```

Set `TEST_DATABASE_URL` (a throwaway Neon branch) to also run the storage tests against Postgres.
