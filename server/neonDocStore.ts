import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import type { DocKind, DocStore, DocSummary } from './docStore.js';

// Binary data crosses the driver as hex in and base64 out, so behaviour does
// not depend on how the HTTP driver serialises bytea parameters.
const toHex = (data: Uint8Array) => Buffer.from(data).toString('hex');
const fromBase64 = (data: string) => new Uint8Array(Buffer.from(data, 'base64'));

export class NeonDocStore implements DocStore {
  private sql: NeonQueryFunction<false, false>;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  async ensureDocument(id: string, kind: DocKind, name: string, seed: Uint8Array | null) {
    const seedHex = seed ? toHex(seed) : null;
    // One statement: the seed row is inserted only if this call inserted the document.
    await this.sql`
      WITH inserted AS (
        INSERT INTO documents (id, kind, name) VALUES (${id}, ${kind}, ${name})
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      )
      INSERT INTO document_updates (document_id, data)
      SELECT id, decode(${seedHex}::text, 'hex') FROM inserted WHERE ${seedHex}::text IS NOT NULL
    `;
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

  async listDocuments(kind: DocKind): Promise<DocSummary[]> {
    const rows = (await this.sql`
      SELECT name, markdown, updated_at FROM documents WHERE kind = ${kind} ORDER BY updated_at DESC
    `) as { name: string; markdown: string; updated_at: Date | string }[];
    return rows.map((row) => ({ name: row.name, markdown: row.markdown, updated_at: new Date(row.updated_at).toISOString() }));
  }

  async setMarkdown(id: string, markdown: string) {
    await this.sql`UPDATE documents SET markdown = ${markdown}, updated_at = now() WHERE id = ${id}`;
  }

  /** Test cleanup helper. */
  async deleteDocumentsWithNamePrefix(prefix: string) {
    await this.sql`DELETE FROM documents WHERE starts_with(name, ${prefix})`;
  }
}
