import {
  createSessionToken,
  needsRefresh,
  parseCookies,
  sanitizeReturnTo,
  serializeCookie,
  SESSION_TTL_MS,
  type SessionUser,
  verifySessionToken,
} from './auth.js';
import type { DocKind, DocStore } from './docStore.js';
import { BadRequestError, parseDocRef, syncDocument } from './sync.js';

export interface AuthConfig {
  authSecret: string;
  githubClientId: string;
  githubClientSecret: string;
  allowedIds: Set<number>;
}

export interface AppDeps {
  store: DocStore;
  config: AuthConfig;
  fetch: typeof fetch;
  now: () => number;
}

export type Route = (request: Request, deps: AppDeps) => Promise<Response>;

const SESSION_COOKIE = 'session';
const STATE_COOKIE = 'oauth_state';
const STATE_TTL_SECONDS = 10 * 60;
export const MAX_UPDATE_BYTES = 1024 * 1024;

const isSecure = (request: Request) => new URL(request.url).protocol === 'https:';
const jsonError = (status: number, error: string) => Response.json({ error }, { status });

const sessionCookie = (request: Request, token: string) =>
  serializeCookie(SESSION_COOKIE, token, { maxAgeSeconds: SESSION_TTL_MS / 1000, secure: isSecure(request) });
const clearCookie = (request: Request, name: string) =>
  serializeCookie(name, '', { maxAgeSeconds: 0, secure: isSecure(request) });

const redirect = (location: string, cookies: string[] = []) => {
  const headers = new Headers({ location });
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response(null, { status: 302, headers });
};

async function currentSession(request: Request, deps: AppDeps) {
  const token = parseCookies(request.headers.get('cookie'))[SESSION_COOKIE];
  if (!token) return null;
  const session = await verifySessionToken(token, deps.config.authSecret, deps.now());
  // Whitelist is re-checked on every request so removing an id revokes access immediately.
  if (!session || !deps.config.allowedIds.has(session.user.id)) return null;
  return session;
}

/** Wraps a data route with session, whitelist and same-origin checks plus sliding refresh. */
const authenticated =
  (handler: (request: Request, deps: AppDeps, user: SessionUser) => Promise<Response>): Route =>
  async (request, deps) => {
    const session = await currentSession(request, deps);
    if (!session) return jsonError(401, 'Unauthorized');

    if (request.method !== 'GET' && request.headers.get('origin') !== new URL(request.url).origin) {
      return jsonError(403, 'Cross-origin request rejected');
    }

    let response: Response;
    try {
      response = await handler(request, deps, session.user);
    } catch (error) {
      if (error instanceof BadRequestError) return jsonError(400, error.message);
      throw error;
    }

    if (needsRefresh(session.exp, deps.now())) {
      const token = await createSessionToken(session.user, deps.config.authSecret, deps.now());
      response.headers.append('set-cookie', sessionCookie(request, token));
    }
    return response;
  };

const methodNotAllowed = () => jsonError(405, 'Method not allowed');

const doc: Route = authenticated(async (request, deps) => {
  if (request.method !== 'GET' && request.method !== 'POST') return methodNotAllowed();
  const url = new URL(request.url);
  const ref = parseDocRef(url.searchParams.get('kind'), url.searchParams.get('name'));

  let stateVector: Uint8Array | undefined;
  const sv = url.searchParams.get('sv');
  if (sv) stateVector = new Uint8Array(Buffer.from(sv, 'base64url'));

  let update: Uint8Array | undefined;
  if (request.method === 'POST') {
    update = new Uint8Array(await request.arrayBuffer());
    if (update.byteLength > MAX_UPDATE_BYTES) return jsonError(413, 'Update too large');
  }

  const diff = await syncDocument(deps.store, ref, { update, stateVector });
  return new Response(diff as Uint8Array<ArrayBuffer>, { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' } });
});

const listRoute = (kind: DocKind): Route =>
  authenticated(async (request, deps) => {
    if (request.method !== 'GET') return methodNotAllowed();
    const documents = await deps.store.listDocuments(kind);
    const body = kind === 'board' ? documents.map(({ name, updated_at }) => ({ name, updated_at })) : documents;
    return Response.json(body, { headers: { 'cache-control': 'no-store' } });
  });

const markdown: Route = authenticated(async (request, deps) => {
  if (request.method !== 'PUT') return methodNotAllowed();
  const ref = parseDocRef('project', new URL(request.url).searchParams.get('name'));
  const body = (await request.json().catch(() => null)) as { markdown?: unknown } | null;
  if (typeof body?.markdown !== 'string') throw new BadRequestError('Missing markdown field');

  await deps.store.ensureDocument(ref.id, ref.kind, ref.name, null);
  await deps.store.setMarkdown(ref.id, body.markdown);
  return Response.json({ success: true });
});

const me: Route = async (request, deps) => {
  const session = await currentSession(request, deps);
  if (!session) return jsonError(401, 'Unauthorized');
  return Response.json(session.user, { headers: { 'cache-control': 'no-store' } });
};

const login: Route = async (request, deps) => {
  const url = new URL(request.url);
  const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const returnTo = sanitizeReturnTo(url.searchParams.get('returnTo'));

  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', deps.config.githubClientId);
  authorize.searchParams.set('redirect_uri', `${url.origin}/api/auth/callback`);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('allow_signup', 'false');

  const stateValue = Buffer.from(JSON.stringify({ state, returnTo })).toString('base64url');
  return redirect(authorize.toString(), [
    serializeCookie(STATE_COOKIE, stateValue, { maxAgeSeconds: STATE_TTL_SECONDS, secure: isSecure(request) }),
  ]);
};

function readStateCookie(request: Request): { state: string; returnTo: string } | null {
  const raw = parseCookies(request.headers.get('cookie'))[STATE_COOKIE];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    return typeof parsed.state === 'string' ? { state: parsed.state, returnTo: sanitizeReturnTo(parsed.returnTo) } : null;
  } catch {
    return null;
  }
}

const callback: Route = async (request, deps) => {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const stored = readStateCookie(request);
  if (!code || !stored || url.searchParams.get('state') !== stored.state) {
    return jsonError(400, 'Invalid OAuth state');
  }

  const tokenResponse = await deps.fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: deps.config.githubClientId,
      client_secret: deps.config.githubClientSecret,
      code,
      redirect_uri: `${url.origin}/api/auth/callback`,
    }),
  });
  const { access_token: accessToken } = (await tokenResponse.json().catch(() => ({}))) as { access_token?: string };
  if (!accessToken) return jsonError(502, 'GitHub token exchange failed');

  const userResponse = await deps.fetch('https://api.github.com/user', {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/vnd.github+json', 'user-agent': 'collab-editor' },
  });
  const githubUser = (await userResponse.json().catch(() => ({}))) as { id?: unknown; login?: unknown };
  if (!userResponse.ok || !Number.isInteger(githubUser.id) || typeof githubUser.login !== 'string') {
    return jsonError(502, 'GitHub user lookup failed');
  }

  const clearState = clearCookie(request, STATE_COOKIE);
  const user = { id: githubUser.id as number, login: githubUser.login };
  if (!deps.config.allowedIds.has(user.id)) {
    return redirect(`${url.origin}/?auth=denied`, [clearState]);
  }

  const token = await createSessionToken(user, deps.config.authSecret, deps.now());
  return redirect(`${url.origin}${stored.returnTo}`, [clearState, sessionCookie(request, token)]);
};

const logout: Route = async (request) => {
  if (request.method !== 'POST') return methodNotAllowed();
  if (request.headers.get('origin') !== new URL(request.url).origin) return jsonError(403, 'Cross-origin request rejected');
  const headers = new Headers({ 'set-cookie': clearCookie(request, SESSION_COOKIE) });
  return new Response(null, { status: 204, headers });
};

export const routes = {
  doc,
  boards: listRoute('board'),
  projects: listRoute('project'),
  markdown,
  me,
  login,
  callback,
  logout,
} satisfies Record<string, Route>;
