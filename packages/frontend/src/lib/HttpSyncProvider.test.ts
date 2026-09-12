import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { routes, type AppDeps } from '../../../../server/app.js';
import { createSessionToken } from '../../../../server/auth.js';
import { MemoryDocStore } from '../../../../server/memoryDocStore.js';
import { HttpSyncProvider, type HttpSyncOptions, type SyncEnvironment, type SyncStatus } from './HttpSyncProvider';

const ORIGIN = 'http://localhost:3000';
const SECRET = 'test-secret-that-is-at-least-32-characters-long';
const OWNER = { id: 86918643, login: 'bear7066' };

/** Browser-like fetch that runs the real API routes against an in-memory store. */
async function createServer() {
  const deps: AppDeps = {
    store: new MemoryDocStore(),
    config: { authSecret: SECRET, githubClientId: 'id', githubClientSecret: 'secret', allowedIds: new Set([OWNER.id]) },
    fetch: (async () => {
      throw new Error('no network');
    }) as unknown as typeof fetch,
    now: () => Date.now(),
  };
  const cookie = `session=${await createSessionToken(OWNER, SECRET)}`;
  const server = {
    online: true,
    signedIn: true,
    missing: false,
    calls: [] as string[],
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), ORIGIN);
      server.calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
      if (!server.online) throw new TypeError('Failed to fetch');
      if (server.missing) return Response.json({ error: 'Not found' }, { status: 404 });
      const headers = new Headers(init?.headers);
      if (server.signedIn) headers.set('cookie', cookie);
      if (init?.method && init.method !== 'GET') headers.set('origin', ORIGIN);
      return routes.doc(new Request(url, { ...init, headers }), deps);
    }) as unknown as typeof fetch,
  };
  return server;
}

type Server = Awaited<ReturnType<typeof createServer>>;

function createEnvironment() {
  let visible = true;
  let now = 0;
  const visibleListeners = new Set<() => void>();
  const environment: SyncEnvironment & { setVisible(value: boolean): void; advance(ms: number): void } = {
    isVisible: () => visible,
    onVisible: (listener) => {
      visibleListeners.add(listener);
      return () => visibleListeners.delete(listener);
    },
    onActivity: () => () => {},
    now: () => now,
    setVisible(value) {
      visible = value;
      if (value) visibleListeners.forEach((listener) => listener());
    },
    advance(ms) {
      now += ms;
    },
  };
  return environment;
}

const fast: Partial<HttpSyncOptions> = { pushDelayMs: 5, pullIntervalMs: 20, retryBaseMs: 10, retryMaxMs: 40 };

function connect(server: Server, overrides: Partial<HttpSyncOptions> = {}, name = 'plans', doc = new Y.Doc()) {
  const provider = new HttpSyncProvider(doc, { kind: 'board', name }, {
    ...fast,
    fetch: server.fetch,
    storage: null,
    environment: createEnvironment(),
    ...overrides,
  });
  return { doc, provider };
}

async function waitFor(condition: () => boolean, timeoutMs = 2000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const sections = (doc: Y.Doc) => doc.getMap('board').get('sections') as Y.Array<Y.Map<unknown>> | undefined;

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    size: () => data.size,
  };
}

describe('HttpSyncProvider', () => {
  test('loads the server state and reports synced', async () => {
    const server = await createServer();
    const { doc, provider } = connect(server);
    const syncEvents: boolean[] = [];
    provider.on('sync', (synced) => syncEvents.push(synced));

    await waitFor(() => provider.synced);
    expect(syncEvents).toEqual([true]);
    expect(sections(doc)?.get(0).get('name')).toBe('General');
    expect(provider.status).toBe('saved');
    provider.destroy();
  });

  test('applies remote state with the provider as transaction origin', async () => {
    const server = await createServer();
    const { doc, provider } = connect(server);
    const origins: unknown[] = [];
    doc.on('update', (_update, origin) => origins.push(origin));

    await waitFor(() => provider.synced);
    expect(origins.length).toBeGreaterThan(0);
    expect(origins.every((origin) => origin === provider)).toBe(true);
    provider.destroy();
  });

  test('pushes local edits and another device receives them by polling', async () => {
    const server = await createServer();
    const phone = connect(server);
    const laptop = connect(server);
    await waitFor(() => phone.provider.synced && laptop.provider.synced);

    phone.doc.getMap('board').set('meetSchedule', 'Mon 10:00');
    await waitFor(() => laptop.doc.getMap('board').get('meetSchedule') === 'Mon 10:00');
    await waitFor(() => phone.provider.status === 'saved' && !phone.provider.hasPendingChanges());

    // Both devices opened the board at once, yet it still has one seeded section.
    expect(sections(laptop.doc)?.length).toBe(1);
    phone.provider.destroy();
    laptop.provider.destroy();
  });

  test('reports offline, retries, and delivers edits once the network returns', async () => {
    const server = await createServer();
    const { doc, provider } = connect(server);
    await waitFor(() => provider.synced);

    server.online = false;
    doc.getMap('board').set('meetLink', 'https://meet.example');
    await waitFor(() => provider.status === 'offline');
    expect(provider.hasPendingChanges()).toBe(true);

    server.online = true;
    await waitFor(() => provider.status === 'saved' && !provider.hasPendingChanges());
    const reader = connect(server);
    await waitFor(() => reader.provider.synced);
    expect(reader.doc.getMap('board').get('meetLink')).toBe('https://meet.example');
    provider.destroy();
    reader.provider.destroy();
  });

  test('keeps unsent edits in storage when the session expires and resends them after sign-in', async () => {
    const server = await createServer();
    const storage = memoryStorage();
    const first = connect(server, { storage });
    const statuses: SyncStatus[] = [];
    first.provider.on('status', (status) => statuses.push(status));
    await waitFor(() => first.provider.synced);

    server.signedIn = false;
    first.doc.getMap('board').set('meetSchedule', 'Fri 09:00');
    await waitFor(() => first.provider.status === 'unauthorized');
    first.provider.destroy();
    expect(storage.size()).toBe(1);

    server.signedIn = true;
    const second = connect(server, { storage });
    await waitFor(() => second.provider.status === 'saved' && !second.provider.hasPendingChanges());
    expect(storage.size()).toBe(0);

    const reader = connect(server);
    await waitFor(() => reader.provider.synced);
    expect(reader.doc.getMap('board').get('meetSchedule')).toBe('Fri 09:00');
    expect(statuses).toContain('unauthorized');
    second.provider.destroy();
    reader.provider.destroy();
  });

  test('does not poll while the tab is hidden and pulls as soon as it is visible again', async () => {
    const server = await createServer();
    const environment = createEnvironment();
    const { provider } = connect(server, { environment });
    await waitFor(() => provider.synced);

    environment.setVisible(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const callsWhileHidden = server.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(server.calls.length).toBe(callsWhileHidden);

    environment.setVisible(true);
    await waitFor(() => server.calls.length > callsWhileHidden);
    provider.destroy();
  });

  test('stops polling after the idle timeout until there is activity', async () => {
    const server = await createServer();
    const environment = createEnvironment();
    const { doc, provider } = connect(server, { environment, idleTimeoutMs: 1000 });
    await waitFor(() => provider.synced);

    environment.advance(1001);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const callsWhenIdle = server.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(server.calls.length).toBe(callsWhenIdle);

    // A local edit counts as activity and resumes syncing.
    doc.getMap('board').set('meetSchedule', 'Tue');
    await waitFor(() => server.calls.length > callsWhenIdle + 1);
    provider.destroy();
  });

  test('treats a missing or forbidden document as final, without retrying', async () => {
    const server = await createServer();
    server.missing = true;
    const { provider } = connect(server);

    await waitFor(() => provider.status === 'notFound');
    expect(provider.synced).toBe(false);
    const calls = server.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(server.calls.length).toBe(calls);
    provider.destroy();
  });

  test('makes no requests after destroy', async () => {
    const server = await createServer();
    const { provider } = connect(server);
    await waitFor(() => provider.synced);
    provider.destroy();
    const calls = server.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(server.calls.length).toBe(calls);
  });
});
