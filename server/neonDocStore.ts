import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import type { DocKind, DocStore, DocSummary, DocumentInit, RenameOutcome, Visibility } from './docStore.js';
import { Buffer } from 'node:buffer';

// Binary data crosses the driver as hex in and base64 out, so behaviour does
// not depend on how the HTTP driver serialises bytea parameters.
const toHex = (data: Uint8Array) => Buffer.from(data).toString('hex');
const fromBase64 = (data: string) => new Uint8Array(Buffer.from(data, 'base64'));

// bigint columns arrive as strings from the driver.
const toId = (value: string | number | null) => (value === null ? null : Number(value));

export class NeonDocStore implements DocStore {
  private sql: NeonQueryFunction<false, false>;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  async ensureDocument({ id, kind, name, seed, ownerId, visibility }: DocumentInit) {
    const seedHex = seed ? toHex(seed) : null;
    // One statement: owner, visibility and the seed row all land only if this
    // call inserted the document, so a concurrent open cannot reassign them.
    await this.sql`
      WITH inserted AS (
        INSERT INTO documents (id, kind, name, owner_id, visibility)
        VALUES (${id}, ${kind}, ${name}, ${ownerId}, ${visibility})
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      )
      INSERT INTO document_updates (document_id, data)
      SELECT id, decode(${seedHex}::text, 'hex') FROM inserted WHERE ${seedHex}::text IS NOT NULL
    `;
  }

  async getDocument(id: string) {
    const rows = (await this.sql`
      SELECT owner_id, visibility FROM documents WHERE id = ${id}
    `) as { owner_id: string | number | null; visibility: Visibility }[];
    if (rows.length === 0) return null;
    return { ownerId: toId(rows[0].owner_id), visibility: rows[0].visibility };
  }

  async setVisibility(id: string, visibility: Visibility) {
    // updated_at is left alone: changing a flag should not reorder the list.
    await this.sql`UPDATE documents SET visibility = ${visibility} WHERE id = ${id}`;
  }

  async renameDocument(fromId: string, toId: string, newName: string): Promise<RenameOutcome> {
    const existing = (await this.sql`SELECT id FROM documents WHERE id IN (${fromId}, ${toId})`) as { id: string }[];
    const ids = new Set(existing.map((row) => row.id));
    if (!ids.has(fromId)) return 'missing';
    if (ids.has(toId)) return 'conflict';

    // The foreign key has no ON UPDATE CASCADE, so the new parent row is
    // created first, the updates are repointed, and only then does the old row
    // go. All three in one transaction: a crash cannot strand the updates.
    // A racing creation of the same target makes the insert fail and the whole
    // transaction roll back, which is the safe outcome.
    await this.sql.transaction([
      this.sql`
        INSERT INTO documents (id, kind, name, markdown, owner_id, visibility, created_at, updated_at)
        SELECT ${toId}, kind, ${newName}, markdown, owner_id, visibility, created_at, now()
        FROM documents WHERE id = ${fromId}
      `,
      this.sql`UPDATE document_updates SET document_id = ${toId} WHERE document_id = ${fromId}`,
      this.sql`DELETE FROM documents WHERE id = ${fromId}`,
    ]);
    return 'renamed';
  }

  async appendUpdate(id: string, update: Uint8Array) {
    await this.sql`
      WITH touched AS (
        UPDATE documents SET updated_at = now() WHERE id = ${id} RETURNING id
      )
      INSERT INTO document_updates (document_id, data)
      SELECT id, decode(${toHex(update)}, 'hex') FROM touched
    `;
  }

  async loadUpdates(id: string) {
    const rows = (await this.sql`
      SELECT id, encode(data, 'base64') AS data FROM document_updates
      WHERE document_id = ${id} ORDER BY id
    `) as { id: string | number; data: string }[];
    return {
      maxId: rows.length > 0 ? Number(rows[rows.length - 1].id) : 0,
      updates: rows.map((row) => fromBase64(row.data)),
    };
  }

  async replaceUpdates(id: string, maxId: number, merged: Uint8Array) {
    await this.sql.transaction([
      this.sql`INSERT INTO document_updates (document_id, data) VALUES (${id}, decode(${toHex(merged)}, 'hex'))`,
      this.sql`DELETE FROM document_updates WHERE document_id = ${id} AND id <= ${maxId}`,
    ]);
  }

  async listDocuments(kind: DocKind, viewerId: number): Promise<DocSummary[]> {
    const rows = (await this.sql`
      SELECT name, markdown, updated_at, visibility, owner_id FROM documents
      WHERE kind = ${kind} AND (visibility = 'collab' OR owner_id = ${viewerId})
      ORDER BY updated_at DESC
    `) as {
      name: string;
      markdown: string;
      updated_at: Date | string;
      visibility: Visibility;
      owner_id: string | number | null;
    }[];
    return rows.map((row) => ({
      name: row.name,
      markdown: row.markdown,
      updated_at: new Date(row.updated_at).toISOString(),
      visibility: row.visibility,
      ownerId: toId(row.owner_id),
    }));
  }

  async setMarkdown(id: string, markdown: string) {
    await this.sql`UPDATE documents SET markdown = ${markdown}, updated_at = now() WHERE id = ${id}`;
  }

  /** Test cleanup helper. */
  async deleteDocumentsWithNamePrefix(prefix: string) {
    await this.sql`DELETE FROM documents WHERE starts_with(name, ${prefix})`;
  }
}
