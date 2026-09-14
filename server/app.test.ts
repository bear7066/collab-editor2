import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { type AppDeps, routes } from './app.js';
import { SESSION_TTL_MS, createSessionToken, parseCookies } from './auth.js';
import { MemoryDocStore } from './memoryDocStore.js';

const ORIGIN = 'https://collab.example';
const SECRET = 'test-secret-that-is-at-least-32-characters-long';
const OWNER = { id: 86918643, login: 'bear7066' };
const FRIEND = { id: 99878260, login: 'friend' };
const STRANGER = { id: 1, login: 'someone' };

function makeDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    store: new MemoryDocStore(),
    config: {
      authSecret: SECRET,
      githubClientId: 'client-id',
      githubClientSecret: 'client-secret',
      allowedIds: new Set([OWNER.id, FRIEND.id]),
    },
    fetch: (async () => {
      throw new Error('unexpected network call');
    }) as unknown as typeof fetch,
    now: () => Date.now(),
    ...overrides,
  };
}

const sessionCookie = async (user = OWNER, issuedAt = Date.now()) =>
  `session=${await createSessionToken(user, SECRET, issuedAt)}`;

const request = (path: string, init: RequestInit & { cookie?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
};

const setCookies = (response: Response) =>
  Object.fromEntries(response.headers.getSetCookie().map((header) => Object.entries(parseCookies(header.split(';')[0]))[0]));

describe('data routes require a whitelisted session', () => {
  test('rejects requests without a session', async () => {
    const response = await routes.doc(request('/api/doc?kind=board&name=plans'), makeDeps());
    expect(response.status).toBe(401);
  });

  test('rejects a validly signed session for an account not on the whitelist', async () => {
    const response = await routes.boards(request('/api/boards', { cookie: await sessionCookie(STRANGER) }), makeDeps());
    expect(response.status).toBe(401);
  });

  test('rejects mutating requests from another origin', async () => {
    const response = await routes.doc(
      request('/api/doc?kind=project&name=notes', {
        method: 'POST',
        cookie: await sessionCookie(),
        headers: { origin: 'https://evil.example' },
        body: Y.encodeStateAsUpdate(new Y.Doc()) as Uint8Array<ArrayBuffer>,
      }),
      makeDeps()
    );
    expect(response.status).toBe(403);
  });

  test('refreshes a session that is close to expiring', async () => {
    const deps = makeDeps();
    const issuedAt = Date.now() - SESSION_TTL_MS + 2 * 24 * 60 * 60 * 1000;
    const response = await routes.boards(request('/api/boards', { cookie: await sessionCookie(OWNER, issuedAt) }), deps);
    expect(response.status).toBe(200);
    expect(setCookies(response).session).toBeTruthy();
  });

  test('does not reissue a fresh session', async () => {
    const response = await routes.boards(request('/api/boards', { cookie: await sessionCookie() }), makeDeps());
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});

const seedProject = (deps: AppDeps, name: string, ownerId = OWNER.id) =>
  deps.store.ensureDocument({ id: `project/${name}`, kind: 'project', name, seed: null, ownerId, visibility: 'collab' });

describe('document sync routes', () => {
  test('opening a board that was never created is a dead end', async () => {
    const response = await routes.doc(
      request('/api/doc?kind=board&name=never-made', { cookie: await sessionCookie() }),
      makeDeps()
    );
    expect(response.status).toBe(404);
  });

  test('push from one device is pulled by another', async () => {
    const deps = makeDeps();
    const cookie = await sessionCookie();
    await seedProject(deps, 'notes');
    const phone = new Y.Doc();
    phone.getText('t').insert(0, 'from phone');

    const push = await routes.doc(
      request('/api/doc?kind=project&name=notes', {
        method: 'POST',
        cookie,
        headers: { origin: ORIGIN, 'content-type': 'application/octet-stream' },
        body: Y.encodeStateAsUpdate(phone) as Uint8Array<ArrayBuffer>,
      }),
      deps
    );
    expect(push.status).toBe(200);

    const laptop = new Y.Doc();
    const sv = Buffer.from(Y.encodeStateVector(laptop)).toString('base64url');
    const pull = await routes.doc(request(`/api/doc?kind=project&name=notes&sv=${sv}`, { cookie }), deps);
    expect(pull.headers.get('content-type')).toBe('application/octet-stream');
    Y.applyUpdate(laptop, new Uint8Array(await pull.arrayBuffer()));
    expect(laptop.getText('t').toString()).toBe('from phone');
  });

  test('rejects an invalid document reference', async () => {
    const response = await routes.doc(request('/api/doc?kind=folder&name=x', { cookie: await sessionCookie() }), makeDeps());
    expect(response.status).toBe(400);
  });

  test('rejects an oversized update body', async () => {
    const deps = makeDeps();
    await seedProject(deps, 'notes');
    const response = await routes.doc(
      request('/api/doc?kind=project&name=notes', {
        method: 'POST',
        cookie: await sessionCookie(),
        headers: { origin: ORIGIN },
        body: new Uint8Array(1024 * 1024 + 1),
      }),
      deps
    );
    expect(response.status).toBe(413);
  });

  test('lists boards and projects with project markdown', async () => {
    const deps = makeDeps();
    const cookie = await sessionCookie();
    await routes.boards(
      request('/api/boards', {
        method: 'POST',
        cookie,
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'plans' }),
      }),
      deps
    );
    await routes.markdown(
      request('/api/markdown?name=notes', {
        method: 'PUT',
        cookie,
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ markdown: '# Notes' }),
      }),
      deps
    );

    const boards = await (await routes.boards(request('/api/boards', { cookie }), deps)).json();
    const projects = await (await routes.projects(request('/api/projects', { cookie }), deps)).json();
    expect(boards.map((board: { name: string }) => board.name)).toEqual(['plans']);
    expect(projects).toEqual([expect.objectContaining({ name: 'notes', markdown: '# Notes' })]);
  });
});

describe('personal and collab boards', () => {
  const json = (path: string, method: string, cookie: string, body: unknown) =>
    request(path, { method, cookie, headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify(body) });

  /** Owner creates a personal board; returns deps plus both users' cookies. */
  async function withPersonalBoard() {
    const deps = makeDeps();
    const owner = await sessionCookie(OWNER);
    const friend = await sessionCookie(FRIEND);
    const created = await routes.boards(json('/api/boards', 'POST', owner, { name: 'secret', visibility: 'personal' }), deps);
    expect(created.status).toBe(200);
    return { deps, owner, friend };
  }

  test('a board created without a visibility is collab', async () => {
    const deps = makeDeps();
    const owner = await sessionCookie(OWNER);
    await routes.boards(json('/api/boards', 'POST', owner, { name: 'shared' }), deps);
    const listed = await (await routes.boards(request('/api/boards', { cookie: await sessionCookie(FRIEND) }), deps)).json();
    expect(listed).toEqual([expect.objectContaining({ name: 'shared', visibility: 'collab' })]);
  });

  test('another user cannot read a personal board', async () => {
    const { deps, friend } = await withPersonalBoard();
    const response = await routes.doc(request('/api/doc?kind=board&name=secret', { cookie: friend }), deps);
    expect(response.status).toBe(404);
  });

  test('another user cannot write to a personal board', async () => {
    const { deps, friend } = await withPersonalBoard();
    const response = await routes.doc(
      request('/api/doc?kind=board&name=secret', {
        method: 'POST',
        cookie: friend,
        headers: { origin: ORIGIN, 'content-type': 'application/octet-stream' },
        body: Y.encodeStateAsUpdate(new Y.Doc()) as Uint8Array<ArrayBuffer>,
      }),
      deps
    );
    expect(response.status).toBe(404);
  });

  test('the owner can still open their personal board', async () => {
    const { deps, owner } = await withPersonalBoard();
    expect((await routes.doc(request('/api/doc?kind=board&name=secret', { cookie: owner }), deps)).status).toBe(200);
  });

  test('a personal board appears only in its owner list', async () => {
    const { deps, owner, friend } = await withPersonalBoard();
    const forOwner = await (await routes.boards(request('/api/boards', { cookie: owner }), deps)).json();
    const forFriend = await (await routes.boards(request('/api/boards', { cookie: friend }), deps)).json();
    expect(forOwner).toEqual([expect.objectContaining({ name: 'secret', visibility: 'personal' })]);
    expect(forFriend).toEqual([]);
  });

  test('the owner can switch a board back to collab', async () => {
    const { deps, owner, friend } = await withPersonalBoard();
    const patched = await routes.boards(json('/api/boards', 'PATCH', owner, { name: 'secret', visibility: 'collab' }), deps);
    expect(patched.status).toBe(200);
    expect((await routes.doc(request('/api/doc?kind=board&name=secret', { cookie: friend }), deps)).status).toBe(200);
  });

  test('another user cannot change visibility', async () => {
    const { deps, friend } = await withPersonalBoard();
    const response = await routes.boards(json('/api/boards', 'PATCH', friend, { name: 'secret', visibility: 'collab' }), deps);
    expect(response.status).toBe(404);
  });

  test('the owner can rename a board, and the old name stops working', async () => {
    const { deps, owner } = await withPersonalBoard();
    const renamed = await routes.boards(json('/api/boards', 'PATCH', owner, { name: 'secret', newName: 'diary' }), deps);
    expect(renamed.status).toBe(200);

    expect((await routes.doc(request('/api/doc?kind=board&name=diary', { cookie: owner }), deps)).status).toBe(200);
    const listed = await (await routes.boards(request('/api/boards', { cookie: owner }), deps)).json();
    expect(listed.map((board: { name: string }) => board.name)).toEqual(['diary']);
  });

  test('a rename keeps the board content', async () => {
    const deps = makeDeps();
    const owner = await sessionCookie(OWNER);
    await routes.boards(json('/api/boards', 'POST', owner, { name: 'notes' }), deps);

    const writer = new Y.Doc();
    writer.getMap('board').set('meetLink', 'https://meet.example');
    await routes.doc(
      request('/api/doc?kind=board&name=notes', {
        method: 'POST',
        cookie: owner,
        headers: { origin: ORIGIN, 'content-type': 'application/octet-stream' },
        body: Y.encodeStateAsUpdate(writer) as Uint8Array<ArrayBuffer>,
      }),
      deps
    );
    await routes.boards(json('/api/boards', 'PATCH', owner, { name: 'notes', newName: 'journal' }), deps);

    const reader = new Y.Doc();
    const pull = await routes.doc(request('/api/doc?kind=board&name=journal', { cookie: owner }), deps);
    Y.applyUpdate(reader, new Uint8Array(await pull.arrayBuffer()));
    expect(reader.getMap('board').get('meetLink')).toBe('https://meet.example');
  });

  test('another user cannot rename a personal board', async () => {
    const { deps, friend } = await withPersonalBoard();
    const response = await routes.boards(json('/api/boards', 'PATCH', friend, { name: 'secret', newName: 'stolen' }), deps);
    expect(response.status).toBe(404);
  });

  test('rejects a rename onto an existing board', async () => {
    const deps = makeDeps();
    const owner = await sessionCookie(OWNER);
    await routes.boards(json('/api/boards', 'POST', owner, { name: 'one' }), deps);
    await routes.boards(json('/api/boards', 'POST', owner, { name: 'two' }), deps);

    const response = await routes.boards(json('/api/boards', 'PATCH', owner, { name: 'one', newName: 'two' }), deps);
    expect(response.status).toBe(409);
  });

  test('rejects an invalid new name', async () => {
    const { deps, owner } = await withPersonalBoard();
    const response = await routes.boards(json('/api/boards', 'PATCH', owner, { name: 'secret', newName: 'a/b' }), deps);
    expect(response.status).toBe(400);
  });

  test('rejects an unknown visibility value', async () => {
    const deps = makeDeps();
    const owner = await sessionCookie(OWNER);
    const response = await routes.boards(json('/api/boards', 'POST', owner, { name: 'x', visibility: 'secretish' }), deps);
    expect(response.status).toBe(400);
  });

  test('the owner can delete a board, and it disappears from the listing', async () => {
    const { deps, owner } = await withPersonalBoard();
    const deleted = await routes.boards(json('/api/boards', 'DELETE', owner, { name: 'secret' }), deps);
    expect(deleted.status).toBe(200);

    const listed = await (await routes.boards(request('/api/boards', { cookie: owner }), deps)).json();
    expect(listed).toEqual([]);
    expect((await routes.doc(request('/api/doc?kind=board&name=secret', { cookie: owner }), deps)).status).toBe(404);
  });

  test('another user cannot delete a personal board', async () => {
    const { deps, friend } = await withPersonalBoard();
    const response = await routes.boards(json('/api/boards', 'DELETE', friend, { name: 'secret' }), deps);
    expect(response.status).toBe(404);

    // Confirm it survived: still openable by its actual owner.
    const owner = await sessionCookie(OWNER);
    expect((await routes.doc(request('/api/doc?kind=board&name=secret', { cookie: owner }), deps)).status).toBe(200);
  });

  test('another user cannot delete a collab board they do not own', async () => {
    const deps = makeDeps();
    const owner = await sessionCookie(OWNER);
    const friend = await sessionCookie(FRIEND);
    await routes.boards(json('/api/boards', 'POST', owner, { name: 'team-board' }), deps);

    const response = await routes.boards(json('/api/boards', 'DELETE', friend, { name: 'team-board' }), deps);
    expect(response.status).toBe(404);
  });

  test('deleting a board that does not exist is a dead end, not a crash', async () => {
    const deps = makeDeps();
    const owner = await sessionCookie(OWNER);
    const response = await routes.boards(json('/api/boards', 'DELETE', owner, { name: 'never-was' }), deps);
    expect(response.status).toBe(404);
  });
});

describe('auth routes', () => {
  test('me returns the signed-in user', async () => {
    const response = await routes.me(request('/api/auth/me', { cookie: await sessionCookie() }), makeDeps());
    expect(await response.json()).toEqual(OWNER);
  });

  test('login redirects to GitHub with a state bound to a cookie', async () => {
    const response = await routes.login(request('/api/auth/login?returnTo=/board/plans'), makeDeps());
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(location.searchParams.get('client_id')).toBe('client-id');
    expect(location.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/callback`);
    const state = location.searchParams.get('state')!;
    expect(state.length).toBeGreaterThanOrEqual(32);
    // The binding itself is exercised by the callback tests (matching vs forged state).
    const stateCookie = response.headers.getSetCookie().find((header) => header.startsWith('oauth_state='));
    expect(stateCookie).toContain('HttpOnly');
  });

  async function startLogin(deps: AppDeps, returnTo = '/board/plans') {
    const login = await routes.login(request(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`), deps);
    const state = new URL(login.headers.get('location')!).searchParams.get('state')!;
    return { state, cookie: `oauth_state=${setCookies(login).oauth_state}` };
  }

  const githubReturning = (user: { id: number; login: string }): typeof fetch =>
    (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://github.com/login/oauth/access_token') return Response.json({ access_token: 'gho_token' });
      if (url === 'https://api.github.com/user') return Response.json(user);
      throw new Error(`unexpected fetch ${url}`);
    }) as unknown as typeof fetch;

  test('callback signs in a whitelisted account and returns to the original page', async () => {
    const deps = makeDeps({ fetch: githubReturning(OWNER) });
    const { state, cookie } = await startLogin(deps);
    const response = await routes.callback(request(`/api/auth/callback?code=abc&state=${state}`, { cookie }), deps);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/board/plans`);
    const me = await routes.me(request('/api/auth/me', { cookie: `session=${setCookies(response).session}` }), deps);
    expect(await me.json()).toEqual(OWNER);
  });

  test('callback denies an account that is not on the whitelist', async () => {
    const deps = makeDeps({ fetch: githubReturning(STRANGER) });
    const { state, cookie } = await startLogin(deps);
    const response = await routes.callback(request(`/api/auth/callback?code=abc&state=${state}`, { cookie }), deps);

    expect(response.headers.get('location')).toBe(`${ORIGIN}/?auth=denied`);
    expect(setCookies(response).session ?? '').toBe('');
  });

  test('callback rejects a mismatched state', async () => {
    const deps = makeDeps({ fetch: githubReturning(OWNER) });
    const { cookie } = await startLogin(deps);
    const response = await routes.callback(request('/api/auth/callback?code=abc&state=forged', { cookie }), deps);
    expect(response.status).toBe(400);
  });

  test('logout clears the session cookie', async () => {
    const response = await routes.logout(
      request('/api/auth/logout', { method: 'POST', cookie: await sessionCookie(), headers: { origin: ORIGIN } }),
      makeDeps()
    );
    expect(response.headers.getSetCookie().some((header) => header.startsWith('session=;') && header.includes('Max-Age=0'))).toBe(true);
  });
});

const seedBoard = (deps: AppDeps, name: string, ownerId = OWNER.id, visibility: 'collab' | 'personal' = 'collab') =>
  deps.store.ensureDocument({ id: `board/${name}`, kind: 'board', name, seed: null, ownerId, visibility });

const uploadRequest = (path: string, cookie: string, file: File) => {
  const form = new FormData();
  form.set('file', file);
  return new Request(`${ORIGIN}${path}`, { method: 'POST', headers: { cookie, origin: ORIGIN }, body: form });
};

describe('file attachments', () => {
  test('an uploaded file round-trips through GET', async () => {
    const deps = makeDeps();
    const cookie = await sessionCookie();
    await seedBoard(deps, 'plans');
    const file = new File(['hello world'], 'notes.txt', { type: 'text/plain' });

    const uploaded = await routes.files(uploadRequest('/api/files?board=plans', cookie, file), deps);
    expect(uploaded.status).toBe(200);
    const { id, filename, size } = (await uploaded.json()) as { id: string; filename: string; size: number };
    expect(filename).toBe('notes.txt');
    expect(size).toBe(11);

    const fetched = await routes.files(request(`/api/files?id=${id}`, { cookie }), deps);
    expect(fetched.headers.get('content-type')).toContain('text/plain');
    expect(await fetched.text()).toBe('hello world');
  });

  test('rejects a file over the size limit', async () => {
    const deps = makeDeps();
    const cookie = await sessionCookie();
    await seedBoard(deps, 'plans');
    const big = new File([new Uint8Array(11 * 1024 * 1024)], 'big.bin', { type: 'application/octet-stream' });

    const response = await routes.files(uploadRequest('/api/files?board=plans', cookie, big), deps);
    expect(response.status).toBe(413);
  });

  test('a stranger to a personal board cannot upload or download its files', async () => {
    const deps = makeDeps();
    const owner = await sessionCookie(OWNER);
    const friend = await sessionCookie(FRIEND);
    await seedBoard(deps, 'secret', OWNER.id, 'personal');
    const file = new File(['top secret'], 'secret.txt', { type: 'text/plain' });

    expect((await routes.files(uploadRequest('/api/files?board=secret', friend, file), deps)).status).toBe(404);

    const uploaded = await routes.files(uploadRequest('/api/files?board=secret', owner, file), deps);
    const { id } = (await uploaded.json()) as { id: string };
    expect((await routes.files(request(`/api/files?id=${id}`, { cookie: friend }), deps)).status).toBe(404);
    expect((await routes.files(request(`/api/files?id=${id}`, { cookie: owner }), deps)).status).toBe(200);
  });

  test('delete removes the file', async () => {
    const deps = makeDeps();
    const cookie = await sessionCookie();
    await seedBoard(deps, 'plans');
    const file = new File(['bye'], 'bye.txt', { type: 'text/plain' });
    const { id } = (await (await routes.files(uploadRequest('/api/files?board=plans', cookie, file), deps)).json()) as { id: string };

    const deleted = await routes.files(request(`/api/files?id=${id}`, { method: 'DELETE', cookie, headers: { origin: ORIGIN } }), deps);
    expect(deleted.status).toBe(200);
    expect((await routes.files(request(`/api/files?id=${id}`, { cookie }), deps)).status).toBe(404);
  });
});
