-- Collab Editor schema for Neon Postgres. Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,               -- "<kind>/<name>"
  kind        TEXT NOT NULL CHECK (kind IN ('board', 'project')),
  name        TEXT NOT NULL,
  markdown    TEXT NOT NULL DEFAULT '',       -- project plain text for the dashboard
  owner_id    BIGINT,                         -- GitHub user id of the creator; null for rows from before ownership
  visibility  TEXT NOT NULL DEFAULT 'collab', -- 'collab' = every signed-in user, 'personal' = owner only
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Upgrade path for databases created before ownership existed. Their rows keep
-- owner_id NULL and default to 'collab', so nothing becomes unreachable.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS owner_id BIGINT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'collab';

-- Stated as drop-then-add (rather than a DO block) so each statement stays
-- independent: the migration script executes one statement at a time.
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_visibility_check;
ALTER TABLE documents ADD CONSTRAINT documents_visibility_check CHECK (visibility IN ('personal', 'collab'));

CREATE INDEX IF NOT EXISTS documents_kind_updated_at ON documents (kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS documents_visibility ON documents (kind, visibility, owner_id);

-- Append-only Yjs updates; periodically compacted into a single merged row.
CREATE TABLE IF NOT EXISTS document_updates (
  id           BIGSERIAL PRIMARY KEY,
  document_id  TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  data         BYTEA NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_updates_document_id ON document_updates (document_id, id);

-- Uploaded attachments (images, PDFs, etc.), one row per file. Metadata about
-- each file also lives in the owning document's Yjs state so the UI can list
-- attachments without a round trip; this table holds only the bytes.
CREATE TABLE IF NOT EXISTS files (
  id           TEXT PRIMARY KEY,
  document_id  TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  mime_type    TEXT NOT NULL,
  size         INTEGER NOT NULL,
  data         BYTEA NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS files_document_id ON files (document_id);
