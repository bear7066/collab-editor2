import { afterAll, describe, expect, test } from 'bun:test';
import type { DocStore } from './docStore.js';
import { MemoryDocStore } from './memoryDocStore.js';
import { NeonDocStore } from './neonDocStore.js';

const bytes = (...values: number[]) => new Uint8Array(values);

function contract(name: string, makeStore: () => DocStore, prefix: string) {
  describe(`${name} DocStore contract`, () => {
    const store = makeStore();
    const id = (suffix: string) => `project/${prefix}${suffix}`;
    const docName = (suffix: string) => `${prefix}${suffix}`;

    test('stores the seed only when the document is created', async () => {
      await store.ensureDocument(id('seed'), 'project', docName('seed'), bytes(1));
      await store.ensureDocument(id('seed'), 'project', docName('seed'), bytes(2));
      expect((await store.loadUpdates(id('seed'))).updates).toEqual([bytes(1)]);
    });

    test('seeds once under concurrent creation', async () => {
      await Promise.all([1, 2, 3].map((n) => store.ensureDocument(id('race'), 'project', docName('race'), bytes(n))));
      expect((await store.loadUpdates(id('race'))).updates).toHaveLength(1);
    });

    test('appends updates in order and reports the highest row id', async () => {
      await store.ensureDocument(id('append'), 'project', docName('append'), null);
      await store.appendUpdate(id('append'), bytes(10, 11));
      await store.appendUpdate(id('append'), bytes(12));
      const { maxId, updates } = await store.loadUpdates(id('append'));
      expect(updates).toEqual([bytes(10, 11), bytes(12)]);
      expect(maxId).toBeGreaterThan(0);
    });

    test('replaces rows up to maxId and keeps later rows', async () => {
      await store.ensureDocument(id('compact'), 'project', docName('compact'), null);
      await store.appendUpdate(id('compact'), bytes(1));
      await store.appendUpdate(id('compact'), bytes(2));
      const { maxId } = await store.loadUpdates(id('compact'));
      await store.appendUpdate(id('compact'), bytes(3));

      await store.replaceUpdates(id('compact'), maxId, bytes(9));
      expect((await store.loadUpdates(id('compact'))).updates.sort((a, b) => a[0] - b[0])).toEqual([bytes(3), bytes(9)]);
    });

    test('lists documents of one kind with markdown, newest first', async () => {
      await store.ensureDocument(id('list-a'), 'project', docName('list-a'), null);
      await store.ensureDocument(id('list-b'), 'project', docName('list-b'), null);
      await store.setMarkdown(id('list-a'), '# hello');

      const listed = (await store.listDocuments('project')).filter((doc) => doc.name.startsWith(`${prefix}list-`));
      expect(listed.map((doc) => doc.name)).toEqual([docName('list-a'), docName('list-b')]);
      expect(listed[0].markdown).toBe('# hello');
      expect(Number.isNaN(Date.parse(listed[0].updated_at))).toBe(false);
      expect((await store.listDocuments('board')).some((doc) => doc.name.startsWith(prefix))).toBe(false);
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
