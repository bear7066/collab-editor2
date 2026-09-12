import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { notifyUnauthorized } from './authEvents';

export type SyncStatus = 'loading' | 'saved' | 'saving' | 'offline' | 'unauthorized' | 'notFound';
export type DocKind = 'board' | 'project';

/** Browser hooks, injectable so tests can drive visibility, activity and time. */
export interface SyncEnvironment {
  isVisible(): boolean;
  onVisible(listener: () => void): () => void;
  onActivity(listener: () => void): () => void;
  now(): number;
}

type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface HttpSyncOptions {
  fetch: typeof fetch;
  /** Mirror of unsent updates so a crash or login redirect does not lose them. */
  storage: PendingStorage | null;
  environment: SyncEnvironment;
  pushDelayMs: number;
  pullIntervalMs: number;
  idleTimeoutMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
}

const browserEnvironment = (): SyncEnvironment => ({
  isVisible: () => document.visibilityState === 'visible',
  onVisible: (listener) => {
    const handle = () => {
      if (document.visibilityState === 'visible') listener();
    };
    document.addEventListener('visibilitychange', handle);
    return () => document.removeEventListener('visibilitychange', handle);
  },
  onActivity: (listener) => {
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((event) => window.addEventListener(event, listener, { passive: true }));
    return () => events.forEach((event) => window.removeEventListener(event, listener));
  },
  now: () => Date.now(),
});

function sessionStorageOrNull(): PendingStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const toBase64 = (bytes: Uint8Array) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};
const fromBase64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const toBase64Url = (bytes: Uint8Array) => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

class UnauthorizedError extends Error {}
/** The document is gone, or this user may not see it. Either way: terminal. */
class MissingError extends Error {}

type Listeners = { sync: Set<(synced: boolean) => void>; status: Set<(status: SyncStatus) => void> };

/**
 * Syncs a Y.Doc with the server over HTTP: debounced pushes of local updates
 * and periodic pulls of whatever the server has that we lack. Stands in for
 * y-websocket's provider (`synced`, `on('sync')`, `awareness`).
 */
export class HttpSyncProvider {
  readonly awareness: Awareness;
  synced = false;
  status: SyncStatus = 'loading';

  private readonly options: HttpSyncOptions;
  private readonly url: string;
  private readonly storageKey: string;
  private readonly listeners: Listeners = { sync: new Set(), status: new Set() };
  private readonly cleanups: (() => void)[] = [];

  private queue: Uint8Array[] = [];
  private pushInFlight = false;
  private pullInFlight = false;
  private failures = 0;
  private offline = false;
  private unauthorized = false;
  private missing = false;
  private destroyed = false;
  private lastActivity: number;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly doc: Y.Doc,
    ref: { kind: DocKind; name: string },
    options: Partial<HttpSyncOptions> = {}
  ) {
    this.options = {
      fetch: (input, init) => fetch(input, init),
      storage: options.storage === undefined ? sessionStorageOrNull() : options.storage,
      environment: options.environment ?? browserEnvironment(),
      pushDelayMs: 800,
      pullIntervalMs: 5000,
      idleTimeoutMs: 10 * 60 * 1000,
      retryBaseMs: 2000,
      retryMaxMs: 30000,
      ...options,
    } as HttpSyncOptions;

    this.url = `/api/doc?kind=${ref.kind}&name=${encodeURIComponent(ref.name)}`;
    this.storageKey = `collab-editor:pending:${ref.kind}/${ref.name}`;
    this.awareness = new Awareness(doc);
    this.lastActivity = this.options.environment.now();

    this.restorePending();
    doc.on('update', this.handleDocUpdate);
    this.cleanups.push(() => doc.off('update', this.handleDocUpdate));
    this.cleanups.push(this.options.environment.onVisible(() => void this.pull()));
    this.cleanups.push(this.options.environment.onActivity(() => (this.lastActivity = this.options.environment.now())));

    const pollTimer = setInterval(() => this.poll(), this.options.pullIntervalMs);
    this.cleanups.push(() => clearInterval(pollTimer));

    void this.pull();
  }

  on(event: 'sync', listener: (synced: boolean) => void): void;
  on(event: 'status', listener: (status: SyncStatus) => void): void;
  on(event: keyof Listeners, listener: (value: never) => void) {
    (this.listeners[event] as Set<typeof listener>).add(listener);
  }

  off(event: 'sync', listener: (synced: boolean) => void): void;
  off(event: 'status', listener: (status: SyncStatus) => void): void;
  off(event: keyof Listeners, listener: (value: never) => void) {
    (this.listeners[event] as Set<typeof listener>).delete(listener);
  }

  hasPendingChanges() {
    return this.queue.length > 0 || this.pushInFlight;
  }

  destroy() {
    this.destroyed = true;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.cleanups.forEach((cleanup) => cleanup());
    this.awareness.destroy();
    this.listeners.sync.clear();
    this.listeners.status.clear();
  }

  private handleDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return;
    this.queue.push(update);
    this.persistQueue();
    this.lastActivity = this.options.environment.now();
    this.refreshStatus();
    this.schedulePush();
  };

  private restorePending() {
    const stored = this.options.storage?.getItem(this.storageKey);
    if (!stored) return;
    try {
      const pending = fromBase64(stored);
      this.queue.push(pending);
      // Show the edits right away; they integrate fully once the first pull arrives.
      Y.applyUpdate(this.doc, pending, this);
    } catch {
      this.options.storage?.removeItem(this.storageKey);
    }
  }

  private persistQueue() {
    const storage = this.options.storage;
    if (!storage) return;
    try {
      if (this.queue.length === 0) storage.removeItem(this.storageKey);
      else storage.setItem(this.storageKey, toBase64(Y.mergeUpdates(this.queue)));
    } catch {
      // Storage full or unavailable: syncing still works, only crash recovery is lost.
    }
  }

  private schedulePush() {
    if (this.destroyed || this.unauthorized || this.missing || this.retryTimer) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.push();
    }, this.options.pushDelayMs);
  }

  private poll() {
    const { environment, idleTimeoutMs } = this.options;
    if (this.missing || !this.synced || !environment.isVisible()) return;
    if (environment.now() - this.lastActivity > idleTimeoutMs) return;
    void this.pull();
  }

  private async request(init: RequestInit): Promise<Uint8Array> {
    const sv = toBase64Url(Y.encodeStateVector(this.doc));
    const response = await this.options.fetch(`${this.url}&sv=${sv}`, { credentials: 'same-origin', ...init });
    if (response.status === 401) throw new UnauthorizedError();
    if (response.status === 404) throw new MissingError();
    if (!response.ok) throw new Error(`Sync request failed with ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  private async push() {
    if (this.destroyed || this.unauthorized || this.missing || this.pushInFlight || this.queue.length === 0) return;
    this.pushInFlight = true;
    const sending = this.queue.splice(0);
    try {
      const diff = await this.request({
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: Y.mergeUpdates(sending) as Uint8Array<ArrayBuffer>,
      });
      if (this.destroyed) return;
      Y.applyUpdate(this.doc, diff, this);
      this.succeeded();
      this.persistQueue();
      if (this.queue.length > 0) this.schedulePush();
    } catch (error) {
      // Re-sending already-applied updates later is harmless: Yjs merges are idempotent.
      this.queue.unshift(...sending);
      this.persistQueue();
      this.failed(error, () => void this.push());
    } finally {
      this.pushInFlight = false;
      this.refreshStatus();
    }
  }

  private async pull() {
    if (this.destroyed || this.unauthorized || this.missing || this.pullInFlight) return;
    this.pullInFlight = true;
    try {
      const diff = await this.request({ method: 'GET' });
      if (this.destroyed) return;
      Y.applyUpdate(this.doc, diff, this);
      this.succeeded();
      if (!this.synced) {
        this.synced = true;
        this.listeners.sync.forEach((listener) => listener(true));
        if (this.queue.length > 0) this.schedulePush();
      }
    } catch (error) {
      this.failed(error, () => void this.pull());
    } finally {
      this.pullInFlight = false;
      this.refreshStatus();
    }
  }

  private succeeded() {
    this.failures = 0;
    this.offline = false;
  }

  private failed(error: unknown, retry: () => void) {
    if (this.destroyed) return;
    if (error instanceof UnauthorizedError) {
      this.unauthorized = true;
      this.refreshStatus();
      notifyUnauthorized();
      return;
    }

    // Retrying a 404 would never succeed: the board is missing, or private to
    // someone else. Stop, and let the page say so.
    if (error instanceof MissingError) {
      this.missing = true;
      this.refreshStatus();
      return;
    }

    this.offline = true;
    this.failures += 1;
    if (this.retryTimer) return;
    const { retryBaseMs, retryMaxMs } = this.options;
    const delay = Math.min(retryBaseMs * 2 ** (this.failures - 1), retryMaxMs);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      retry();
      if (this.queue.length > 0) this.schedulePush();
    }, delay);
  }

  private refreshStatus() {
    let next: SyncStatus;
    if (this.unauthorized) next = 'unauthorized';
    else if (this.missing) next = 'notFound';
    else if (this.offline) next = 'offline';
    else if (!this.synced) next = 'loading';
    else if (this.hasPendingChanges()) next = 'saving';
    else next = 'saved';

    if (next === this.status) return;
    this.status = next;
    this.listeners.status.forEach((listener) => listener(next));
  }
}
