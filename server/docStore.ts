export type DocKind = 'board' | 'project';

/** Who may open a document: its owner only, or everyone who can sign in. */
export type Visibility = 'personal' | 'collab';

export interface DocumentInit {
  id: string;
  kind: DocKind;
  name: string;
  /** Initial Yjs state, stored only if this call created the document. */
  seed: Uint8Array | null;
  /** Creator's GitHub id; null for documents made before ownership existed. */
  ownerId: number | null;
  visibility: Visibility;
}

export type RenameOutcome = 'renamed' | 'conflict' | 'missing';

export interface DocumentMeta {
  ownerId: number | null;
  visibility: Visibility;
}

export interface DocSummary {
  name: string;
  markdown: string;
  updated_at: string;
  visibility: Visibility;
  ownerId: number | null;
}

/**
 * Persistence for Yjs documents stored as append-only update rows.
 * Implementations must make each method atomic on its own.
 */
export interface DocStore {
  /**
   * Create the document if missing. Owner, visibility and seed apply only to
   * the call that created it; later calls leave an existing document alone.
   */
  ensureDocument(init: DocumentInit): Promise<void>;
  /** Ownership and visibility, or null when the document does not exist. */
  getDocument(id: string): Promise<DocumentMeta | null>;
  setVisibility(id: string, visibility: Visibility): Promise<void>;
  /**
   * Move a document and its updates to a new id, keeping owner, visibility and
   * content. Reports 'conflict' when the target id is taken and 'missing' when
   * the source is not there, so callers can answer without exception mapping.
   */
  renameDocument(fromId: string, toId: string, newName: string): Promise<RenameOutcome>;
  appendUpdate(id: string, update: Uint8Array): Promise<void>;
  /** All stored updates in insertion order, plus the highest row id read. */
  loadUpdates(id: string): Promise<{ maxId: number; updates: Uint8Array[] }>;
  /** Replace rows with id <= maxId by a single merged update. Later rows are untouched. */
  replaceUpdates(id: string, maxId: number, merged: Uint8Array): Promise<void>;
  /** Collab documents plus the viewer's own personal ones, newest first. */
  listDocuments(kind: DocKind, viewerId: number): Promise<DocSummary[]>;
  setMarkdown(id: string, markdown: string): Promise<void>;
}
