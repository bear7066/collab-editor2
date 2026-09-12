import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { MemoryDocStore } from './memoryDocStore.js';
import { BadRequestError, COMPACT_THRESHOLD, parseDocRef, syncDocument } from './sync.js';

const board = (name = 'plans') => parseDocRef('board', name);
const project = (name = 'notes') => parseDocRef('project', name);

/** A client doc that has applied everything the server sent it. */
async function pullInto(store: MemoryDocStore, ref: ReturnType<typeof parseDocRef>, doc = new Y.Doc()) {
  const diff = await syncDocument(store, ref, { stateVector: Y.encodeStateVector(doc) });
  Y.applyUpdate(doc, diff);
  return doc;
}

const sectionNames = (doc: Y.Doc) =>
  ((doc.getMap('board').get('sections') as Y.Array<Y.Map<unknown>> | undefined)?.toArray() ?? []).map((s) => s.get('name'));

describe('parseDocRef', () => {
  test('builds the document id from kind and name', () => {
    expect(parseDocRef('board', '我的板子')).toEqual({ id: 'board/我的板子', kind: 'board', name: '我的板子' });
  });

  test('rejects unknown kinds and invalid names', () => {
    const invalid: [string | null, string | null][] = [
      ['folder', 'x'],
      [null, 'x'],
      ['board', null],
      ['board', ''],
      ['board', 'a/b'],
      ['board', 'x'.repeat(101)],
      ['board', 'tab\there'],
    ];
    for (const [kind, name] of invalid) {
      expect(() => parseDocRef(kind, name)).toThrow(BadRequestError);
    }
  });
});

describe('syncDocument', () => {
  test('seeds a new board with a General section', async () => {
    const store = new MemoryDocStore();
    expect(sectionNames(await pullInto(store, board()))).toEqual(['General']);
  });

  test('starts a new project empty', async () => {
    const store = new MemoryDocStore();
    const doc = await pullInto(store, project());
    expect(doc.getXmlFragment('prosemirror').length).toBe(0);
    expect(store.rowCount('project/notes')).toBe(0);
  });

  test('seeds a board only once when first opened concurrently', async () => {
    const store = new MemoryDocStore();
    const [a, b] = await Promise.all([pullInto(store, board()), pullInto(store, board())]);
    const merged = new Y.Doc();
    Y.applyUpdate(merged, Y.encodeStateAsUpdate(a));
    Y.applyUpdate(merged, Y.encodeStateAsUpdate(b));
    expect(sectionNames(merged)).toEqual(['General']);
  });

  test('delivers a pushed update to another client', async () => {
    const store = new MemoryDocStore();
    const phone = new Y.Doc();
    const beforeEdit = Y.encodeStateVector(phone);
    phone.getText('t').insert(0, 'hello');
    await syncDocument(store, project(), { update: Y.encodeStateAsUpdate(phone, beforeEdit) });

    const laptop = await pullInto(store, project());
    expect(laptop.getText('t').toString()).toBe('hello');
  });

  test('keeps both edits when two clients push concurrently', async () => {
    const store = new MemoryDocStore();
    const phone = new Y.Doc();
    const laptop = new Y.Doc();
    phone.getMap('m').set('phone', 1);
    laptop.getMap('m').set('laptop', 2);

    await Promise.all([
      syncDocument(store, project(), { update: Y.encodeStateAsUpdate(phone) }),
      syncDocument(store, project(), { update: Y.encodeStateAsUpdate(laptop) }),
    ]);

    const reader = await pullInto(store, project());
    expect(reader.getMap('m').toJSON()).toEqual({ phone: 1, laptop: 2 });
  });

  test('returns only what the client is missing', async () => {
    const store = new MemoryDocStore();
    const writer = new Y.Doc();
    writer.getText('t').insert(0, 'x'.repeat(2000));
    await syncDocument(store, project(), { update: Y.encodeStateAsUpdate(writer) });

    const upToDate = await pullInto(store, project());
    const diff = await syncDocument(store, project(), { stateVector: Y.encodeStateVector(upToDate) });
    const full = await syncDocument(store, project(), {});
    expect(diff.byteLength).toBeLessThan(full.byteLength / 10);
  });

  test('compacts stored updates without losing content', async () => {
    const store = new MemoryDocStore();
    const writer = new Y.Doc();
    const text = writer.getText('t');
    for (let i = 0; i < COMPACT_THRESHOLD + 10; i++) {
      const before = Y.encodeStateVector(writer);
      text.insert(text.length, String(i % 10));
      await syncDocument(store, project(), { update: Y.encodeStateAsUpdate(writer, before) });
    }

    expect(store.rowCount('project/notes')).toBeLessThanOrEqual(COMPACT_THRESHOLD);
    expect((await pullInto(store, project())).getText('t').toString()).toBe(text.toString());
  });

  test('rejects a malformed update', async () => {
    const store = new MemoryDocStore();
    const garbage = new Uint8Array([255, 1, 2, 3, 4, 5]);
    await expect(syncDocument(store, project(), { update: garbage })).rejects.toThrow(BadRequestError);
    expect(store.rowCount('project/notes')).toBe(0);
  });
});
