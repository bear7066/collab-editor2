import * as Y from 'yjs';

/**
 * Initial Yjs state for a new board, matching the schema in the frontend's
 * boardDoc.ts: a root "board" map with `meta`, `sections` and `updatedAt`.
 */
export function createBoardSeed(): Uint8Array {
  const doc = new Y.Doc();
  const root = doc.getMap('board');
  doc.transact(() => {
    const meta = new Y.Map<unknown>();
    meta.set('meetLink', '');
    meta.set('meetSchedule', '');
    root.set('meta', meta);

    const general = new Y.Map<unknown>();
    general.set('id', 'section_general');
    general.set('name', 'General');
    general.set('accent', '#6b8f71');
    general.set('notes', new Y.XmlFragment());
    general.set('groups', new Y.Array());

    const sections = new Y.Array<Y.Map<unknown>>();
    sections.push([general]);
    root.set('sections', sections);
    root.set('updatedAt', new Date().toISOString());
  });
  return Y.encodeStateAsUpdate(doc);
}
