export type DocKind = 'board' | 'project';

export interface DocSummary {
  name: string;
  markdown: string;
  updated_at: string;
}

/**
 * Persistence for Yjs documents stored as append-only update rows.
 * Implementations must make each method atomic on its own.
 */
export interface DocStore {
  /** Create the document if missing; `seed` is stored only when this call created it. */
  ensureDocument(id: string, kind: DocKind, name: string, seed: Uint8Array | null): Promise<void>;
  appendUpdate(id: string, update: Uint8Array): Promise<void>;
  /** All stored updates in insertion order, plus the highest row id read. */
  loadUpdates(id: string): Promise<{ maxId: number; updates: Uint8Array[] }>;
  /** Replace rows with id <= maxId by a single merged update. Later rows are untouched. */
  replaceUpdates(id: string, maxId: number, merged: Uint8Array): Promise<void>;
  listDocuments(kind: DocKind): Promise<DocSummary[]>;
  setMarkdown(id: string, markdown: string): Promise<void>;
}
