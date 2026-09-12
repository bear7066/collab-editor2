import type { AppDeps, Route } from './app.js';
import { parseAllowedIds } from './auth.js';
import { MemoryDocStore } from './memoryDocStore.js';
import { NeonDocStore } from './neonDocStore.js';

type Env = Record<string, string | undefined>;

const REQUIRED = ['AUTH_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'ALLOWED_GITHUB_IDS'] as const;

export function createDeps(env: Env): AppDeps {
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length > 0) throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  if (env.AUTH_SECRET!.length < 32) throw new Error('AUTH_SECRET must be at least 32 characters');

  const allowedIds = parseAllowedIds(env.ALLOWED_GITHUB_IDS);
  if (allowedIds.size === 0) throw new Error('ALLOWED_GITHUB_IDS must contain at least one numeric GitHub user id');

  let store;
  if (env.DATABASE_URL) {
    store = new NeonDocStore(env.DATABASE_URL);
  } else if (env.VERCEL) {
    throw new Error('DATABASE_URL is required on Vercel');
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

let deps: AppDeps | null = null;

/** Adapts a route to Vercel's Web fetch handler export, reusing deps across warm invocations. */
export const vercelHandler = (route: Route) => ({
  async fetch(request: Request) {
    try {
      deps ??= createDeps(process.env);
      return await route(request, deps);
    } catch (error) {
      console.error('[collab-editor]', error);
      return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
  },
});
