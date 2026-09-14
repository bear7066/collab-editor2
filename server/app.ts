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
import type { DocStore } from './docStore.js';
import { BadRequestError, NotFoundError, parseDocRef, parseVisibility, requireAccess, syncDocument } from './sync.js';
import { Buffer } from 'node:buffer';

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
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

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
      if (error instanceof NotFoundError) return jsonError(404, error.message);
      throw error;
    }

    if (needsRefresh(session.exp, deps.now())) {
      const token = await createSessionToken(session.user, deps.config.authSecret, deps.now());
      response.headers.append('set-cookie', sessionCookie(request, token));
    }
    return response;
  };

const methodNotAllowed = () => jsonError(405, 'Method not allowed');

const doc: Route = authenticated(async (request, deps, user) => {
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

  const diff = await syncDocument(deps.store, ref, { viewer: user.id, update, stateVector });
  return new Response(diff as Uint8Array<ArrayBuffer>, { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' } });
});

const listBoards = async (deps: AppDeps, viewer: number) => {
  const documents = await deps.store.listDocuments('board', viewer);
  return documents.map(({ name, updated_at, visibility, ownerId }) => ({ name, updated_at, visibility, ownerId }));
};

/** GET lists boards, POST creates one, PATCH renames/re-visibilities it, DELETE removes it. */
const boards: Route = authenticated(async (request, deps, user) => {
  if (request.method === 'GET') {
    return Response.json(await listBoards(deps, user.id), { headers: { 'cache-control': 'no-store' } });
  }

  if (request.method === 'POST' || request.method === 'PATCH' || request.method === 'DELETE') {
    const body = (await request.json().catch(() => null)) as { name?: unknown; newName?: unknown; visibility?: unknown } | null;
    const ref = parseDocRef('board', typeof body?.name === 'string' ? body.name : null);
    if (request.method === 'POST') {
      const visibility = parseVisibility(body?.visibility);
      await syncDocument(deps.store, ref, { viewer: user.id, visibility, create: true });
      return Response.json({ name: ref.name, visibility });
    }

    // Only the owner may rename, re-visibility or delete; for anyone else the
    // board is not found, matching the "existence not revealed" rule personal
    // boards already rely on.
    const meta = await requireAccess(deps.store, ref.id, user.id);
    if (meta.ownerId !== user.id) throw new NotFoundError('Document not found');

    if (request.method === 'DELETE') {
      await deps.store.deleteDocument(ref.id);
      return Response.json({ success: true });
    }

    if (typeof body?.newName === 'string') {
      const target = parseDocRef('board', body.newName);
      const outcome = await deps.store.renameDocument(ref.id, target.id, target.name);
      if (outcome === 'conflict') return jsonError(409, 'A board with that name already exists');
      if (outcome === 'missing') throw new NotFoundError('Document not found');
      return Response.json({ name: target.name, visibility: meta.visibility });
    }

    // Absent visibility keeps what the board already has, so a rename-only
    // request cannot quietly turn a personal board into a shared one.
    await deps.store.setVisibility(ref.id, parseVisibility(body?.visibility, meta.visibility));
    return Response.json({ name: ref.name, visibility: parseVisibility(body?.visibility, meta.visibility) });
  }

  return methodNotAllowed();
});

const projects: Route = authenticated(async (request, deps, user) => {
  if (request.method !== 'GET') return methodNotAllowed();
  const documents = await deps.store.listDocuments('project', user.id);
  return Response.json(documents, { headers: { 'cache-control': 'no-store' } });
});

const markdown: Route = authenticated(async (request, deps, user) => {
  if (request.method !== 'PUT') return methodNotAllowed();
  const ref = parseDocRef('project', new URL(request.url).searchParams.get('name'));
  const body = (await request.json().catch(() => null)) as { markdown?: unknown } | null;
  if (typeof body?.markdown !== 'string') throw new BadRequestError('Missing markdown field');

  await deps.store.ensureDocument({
    id: ref.id,
    kind: ref.kind,
    name: ref.name,
    seed: null,
    ownerId: user.id,
    visibility: 'collab',
  });
  await requireAccess(deps.store, ref.id, user.id);
  await deps.store.setMarkdown(ref.id, body.markdown);
  return Response.json({ success: true });
});

/** POST uploads a file for a board's attachments, GET streams one back, DELETE removes it. */
const files: Route = authenticated(async (request, deps, user) => {
  const url = new URL(request.url);

  if (request.method === 'POST') {
    const ref = parseDocRef('board', url.searchParams.get('board'));
    await requireAccess(deps.store, ref.id, user.id);

    const form = await request.formData().catch(() => null);
    const uploaded = form?.get('file');
    if (!(uploaded instanceof File)) throw new BadRequestError('Missing file');
    if (uploaded.size > MAX_FILE_BYTES) return jsonError(413, 'File too large');

    const data = new Uint8Array(await uploaded.arrayBuffer());
    const filename = uploaded.name.slice(0, 200) || 'file';
    const mimeType = uploaded.type || 'application/octet-stream';
    const id = crypto.randomUUID();
    await deps.store.saveFile({ id, documentId: ref.id, filename, mimeType, size: data.byteLength, data });
    return Response.json({ id, filename, mimeType, size: data.byteLength });
  }

  if (request.method === 'GET') {
    const id = url.searchParams.get('id');
    if (!id) throw new BadRequestError('Missing id');
    const file = await deps.store.getFile(id);
    if (!file) throw new NotFoundError('File not found');
    await requireAccess(deps.store, file.documentId, user.id);
    return new Response(file.data as Uint8Array<ArrayBuffer>, {
      headers: {
        'content-type': file.mimeType,
        'content-disposition': `inline; filename="${file.filename.replace(/["\r\n]/g, '_')}"`,
        'cache-control': 'private, max-age=31536000, immutable',
        'content-security-policy': "sandbox; default-src 'none'",
        'x-content-type-options': 'nosniff',
      },
    });
  }

  if (request.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) throw new BadRequestError('Missing id');
    const file = await deps.store.getFile(id);
    if (!file) throw new NotFoundError('File not found');
    await requireAccess(deps.store, file.documentId, user.id);
    await deps.store.deleteFile(id);
    return Response.json({ success: true });
  }

  return methodNotAllowed();
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
  boards,
  projects,
  markdown,
  files,
  me,
  login,
  callback,
  logout,
} satisfies Record<string, Route>;
