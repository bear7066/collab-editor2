import { afterAll, describe, expect, test } from 'bun:test';
import type { DocStore } from './docStore.js';
import { MemoryDocStore } from './memoryDocStore.js';
import { NeonDocStore } from './neonDocStore.js';

const bytes = (...values: number[]) => new Uint8Array(values);

const OWNER = 1001;
const OTHER = 2002;

function contract(name: string, makeStore: () => DocStore, prefix: string) {
  describe(`${name} DocStore contract`, () => {
    const store = makeStore();
    const id = (suffix: string) => `project/${prefix}${suffix}`;
    const docName = (suffix: string) => `${prefix}${suffix}`;

    /** Creation defaults used by tests that do not care about ownership. */
    const create = (suffix: string, extra: Partial<Parameters<DocStore['ensureDocument']>[0]> = {}) =>
      store.ensureDocument({
        id: id(suffix),
        kind: 'project',
        name: docName(suffix),
        seed: null,
        ownerId: OWNER,
        visibility: 'collab',
        ...extra,
      });

    test('stores the seed only when the document is created', async () => {
      await create('seed', { seed: bytes(1) });
      await create('seed', { seed: bytes(2) });
      expect((await store.loadUpdates(id('seed'))).updates).toEqual([bytes(1)]);
    });

    test('seeds once under concurrent creation', async () => {
      await Promise.all([1, 2, 3].map((n) => create('race', { seed: bytes(n) })));
      expect((await store.loadUpdates(id('race'))).updates).toHaveLength(1);
    });

    test('records the owner and visibility chosen at creation', async () => {
      await create('owned', { ownerId: OWNER, visibility: 'personal' });
      expect(await store.getDocument(id('owned'))).toEqual({ ownerId: OWNER, visibility: 'personal' });
    });

    test('a later ensureDocument never reassigns the owner or visibility', async () => {
      await create('keep', { ownerId: OWNER, visibility: 'personal' });
      await create('keep', { ownerId: OTHER, visibility: 'collab' });
      expect(await store.getDocument(id('keep'))).toEqual({ ownerId: OWNER, visibility: 'personal' });
    });

    test('reports nothing for a document that does not exist', async () => {
      expect(await store.getDocument(id('missing'))).toBeNull();
    });

    test('changes visibility on request', async () => {
      await create('flip', { visibility: 'collab' });
      await store.setVisibility(id('flip'), 'personal');
      expect((await store.getDocument(id('flip')))?.visibility).toBe('personal');
    });

    test('appends updates in order and reports the highest row id', async () => {
      await create('append');
      await store.appendUpdate(id('append'), bytes(10, 11));
      await store.appendUpdate(id('append'), bytes(12));
      const { maxId, updates } = await store.loadUpdates(id('append'));
      expect(updates).toEqual([bytes(10, 11), bytes(12)]);
      expect(maxId).toBeGreaterThan(0);
    });

    test('replaces rows up to maxId and keeps later rows', async () => {
      await create('compact');
      await store.appendUpdate(id('compact'), bytes(1));
      await store.appendUpdate(id('compact'), bytes(2));
      const { maxId } = await store.loadUpdates(id('compact'));
      await store.appendUpdate(id('compact'), bytes(3));

      await store.replaceUpdates(id('compact'), maxId, bytes(9));
      expect((await store.loadUpdates(id('compact'))).updates.sort((a, b) => a[0] - b[0])).toEqual([bytes(3), bytes(9)]);
    });

    test('lists documents of one kind with markdown, newest first', async () => {
      await create('list-a');
      await create('list-b');
      await store.setMarkdown(id('list-a'), '# hello');

      const listed = (await store.listDocuments('project', OWNER)).filter((doc) => doc.name.startsWith(`${prefix}list-`));
      expect(listed.map((doc) => doc.name)).toEqual([docName('list-a'), docName('list-b')]);
      expect(listed[0].markdown).toBe('# hello');
      expect(Number.isNaN(Date.parse(listed[0].updated_at))).toBe(false);
      expect((await store.listDocuments('board', OWNER)).some((doc) => doc.name.startsWith(prefix))).toBe(false);
    });

    test('hides personal documents from everyone but their owner', async () => {
      await create('mine', { ownerId: OWNER, visibility: 'personal' });
      await create('theirs', { ownerId: OTHER, visibility: 'personal' });
      await create('shared', { ownerId: OTHER, visibility: 'collab' });

      const namesFor = async (viewer: number) =>
        (await store.listDocuments('project', viewer))
          .filter((doc) => ['mine', 'theirs', 'shared'].some((suffix) => doc.name === docName(suffix)))
          .map((doc) => doc.name)
          .sort();

      expect(await namesFor(OWNER)).toEqual([docName('mine'), docName('shared')].sort());
      expect(await namesFor(OTHER)).toEqual([docName('shared'), docName('theirs')].sort());
    });

    test('renames a document, carrying its updates, owner and visibility', async () => {
      await create('rename-from', { ownerId: OWNER, visibility: 'personal', seed: bytes(5) });
      await store.appendUpdate(id('rename-from'), bytes(6));

      expect(await store.renameDocument(id('rename-from'), id('rename-to'), docName('rename-to'))).toBe('renamed');

      expect(await store.getDocument(id('rename-from'))).toBeNull();
      expect(await store.getDocument(id('rename-to'))).toEqual({ ownerId: OWNER, visibility: 'personal' });
      expect((await store.loadUpdates(id('rename-to'))).updates).toEqual([bytes(5), bytes(6)]);
    });

    test('refuses a rename onto a name already in use', async () => {
      await create('rename-a');
      await create('rename-b');
      expect(await store.renameDocument(id('rename-a'), id('rename-b'), docName('rename-b'))).toBe('conflict');
      expect(await store.getDocument(id('rename-a'))).not.toBeNull();
    });

    test('reports a rename of something that is not there', async () => {
      expect(await store.renameDocument(id('rename-ghost'), id('rename-ghost2'), docName('rename-ghost2'))).toBe('missing');
    });

    test('reports visibility and owner with each listed document', async () => {
      await create('badge', { ownerId: OWNER, visibility: 'personal' });
      const listed = (await store.listDocuments('project', OWNER)).find((doc) => doc.name === docName('badge'));
      expect(listed).toMatchObject({ visibility: 'personal', ownerId: OWNER });
    });
  });
}

contract('memory', () => new MemoryDocStore(), '');

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl) {
  const prefix = `__test_${Date.now()}_`;
  const neonStore = new NeonDocStore(databaseUrl);
  contract('neon', () => neonStore, prefix);
  afterAll(() => neonStore.deleteDocumentsWithNamePrefix(prefix));
} else {
  test.skip('neon DocStore contract (set TEST_DATABASE_URL to run)', () => {});
}
