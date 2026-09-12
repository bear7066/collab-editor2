import type { DocKind, DocStore, DocSummary } from './docStore.js';

interface MemoryDocument {
  kind: DocKind;
  name: string;
  markdown: string;
  updatedAt: Date;
  rows: { id: number; data: Uint8Array }[];
}

/** In-process store for tests and local development without a database. */
export class MemoryDocStore implements DocStore {
  private documents = new Map<string, MemoryDocument>();
  private nextRowId = 1;

  async ensureDocument(id: string, kind: DocKind, name: string, seed: Uint8Array | null) {
    if (this.documents.has(id)) return;
    const rows = seed ? [{ id: this.nextRowId++, data: seed }] : [];
    this.documents.set(id, { kind, name, markdown: '', updatedAt: new Date(), rows });
  }

  async appendUpdate(id: string, update: Uint8Array) {
    const document = this.require(id);
    document.rows.push({ id: this.nextRowId++, data: update });
    document.updatedAt = new Date();
  }

  async loadUpdates(id: string) {
    const rows = this.require(id).rows;
    return { maxId: rows.at(-1)?.id ?? 0, updates: rows.map((row) => row.data) };
  }

  async replaceUpdates(id: string, maxId: number, merged: Uint8Array) {
    const document = this.require(id);
    const later = document.rows.filter((row) => row.id > maxId);
    document.rows = [{ id: this.nextRowId++, data: merged }, ...later];
  }

  async listDocuments(kind: DocKind): Promise<DocSummary[]> {
    return [...this.documents.values()]
      .filter((document) => document.kind === kind)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map((document) => ({ name: document.name, markdown: document.markdown, updated_at: document.updatedAt.toISOString() }));
  }

  async setMarkdown(id: string, markdown: string) {
    const document = this.require(id);
    document.markdown = markdown;
    document.updatedAt = new Date();
  }

  /** Number of stored update rows; used by tests to observe compaction. */
  rowCount(id: string) {
    return this.documents.get(id)?.rows.length ?? 0;
  }

  private require(id: string) {
    const document = this.documents.get(id);
    if (!document) throw new Error(`Unknown document ${id}`);
    return document;
  }
}
