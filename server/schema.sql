-- CollabEditor schema for Neon Postgres. Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,               -- "<kind>/<name>"
  kind        TEXT NOT NULL CHECK (kind IN ('board', 'project')),
  name        TEXT NOT NULL,
  markdown    TEXT NOT NULL DEFAULT '',       -- project plain text for the dashboard
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS documents_kind_updated_at ON documents (kind, updated_at DESC);

-- Append-only Yjs updates; periodically compacted into a single merged row.
CREATE TABLE IF NOT EXISTS document_updates (
  id           BIGSERIAL PRIMARY KEY,
  document_id  TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  data         BYTEA NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_updates_document_id ON document_updates (document_id, id);
