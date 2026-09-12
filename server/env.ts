import type { AppDeps, Route } from './app.js';
import { parseAllowedIds } from './auth.js';
import { MemoryDocStore } from './memoryDocStore.js';
import { NeonDocStore } from './neonDocStore.js';

type Env = Record<string, string | undefined>;

const REQUIRED = ['AUTH_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'ALLOWED_GITHUB_IDS'] as const;

/**
 * A deployment whose environment is missing or malformed. `detail` names the
 * variables at fault — never their values — so it is safe to return to the
 * caller; without it a fresh deploy just answers 500 and hides the reason.
 */
export class ConfigurationError extends Error {
  constructor(readonly detail: string) {
    super(`Server is not configured: ${detail}`);
    this.name = 'ConfigurationError';
  }
}

export function createDeps(env: Env): AppDeps {
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length > 0) throw new ConfigurationError(`missing environment variables: ${missing.join(', ')}`);
  if (env.AUTH_SECRET!.length < 32) throw new ConfigurationError('AUTH_SECRET must be at least 32 characters');

  const allowedIds = parseAllowedIds(env.ALLOWED_GITHUB_IDS);
  if (allowedIds.size === 0) {
    throw new ConfigurationError('ALLOWED_GITHUB_IDS must contain at least one numeric GitHub user id');
  }

  let store;
  if (env.DATABASE_URL) {
    store = new NeonDocStore(env.DATABASE_URL);
  } else if (env.VERCEL) {
    throw new ConfigurationError('DATABASE_URL is required on Vercel');
  } else {
    console.warn('[collab-editor] DATABASE_URL not set: using an in-memory store; data is lost on restart.');
    store = new MemoryDocStore();
  }

  return {
    store,
    config: {
      authSecret: env.AUTH_SECRET!,
      githubClientId: env.GITHUB_CLIENT_ID!,
      githubClientSecret: env.GITHUB_CLIENT_SECRET!,
      allowedIds,
    },
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init)) as typeof fetch,
    now: () => Date.now(),
  };
}

/**
 * Turns a database failure into a safe one-line explanation. Only the shape of
 * the problem is reported — never the connection string, credentials or the
 * driver's raw message, which can carry both.
 */
function describeDatabaseError(error: unknown): string | null {
  const codes = new Set<string>();
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 3; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') codes.add(code);
    messages.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }

  if (codes.has('42P01')) return 'the database schema is missing: run "bun run db:migrate" against DATABASE_URL';
  if (codes.has('28P01') || codes.has('28000') || codes.has('3D000')) {
    return 'the database rejected the connection: check DATABASE_URL';
  }
  if (codes.has('ENOTFOUND') || codes.has('ECONNREFUSED') || messages.some((m) => /fetch failed|getaddrinfo/i.test(m))) {
    return 'the database could not be reached: check DATABASE_URL';
  }
  return null;
}

let cachedDeps: AppDeps | null = null;

/** Adapts a route to Vercel's Web fetch handler export, reusing deps across warm invocations. */
export const vercelHandler = (route: Route, env: Env = process.env) => ({
  async fetch(request: Request) {
    try {
      // Only the real environment is cached; tests pass their own and get a fresh build.
      const deps = env === process.env ? (cachedDeps ??= createDeps(env)) : createDeps(env);
      return await route(request, deps);
    } catch (error) {
      console.error('[collab-editor]', error);
      if (error instanceof ConfigurationError) {
        return Response.json({ error: 'Server is not configured', detail: error.detail }, { status: 503 });
      }
      const detail = describeDatabaseError(error);
      return Response.json(detail ? { error: 'Internal server error', detail } : { error: 'Internal server error' }, {
        status: 500,
      });
    }
  },
});
