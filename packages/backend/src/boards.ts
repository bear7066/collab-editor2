import { Router } from 'express';
import * as Y from 'yjs';
import { db } from './db.js';
import {
  applyBoardStateToDoc,
  boardStateFromDoc,
  createDefaultBoardState,
  parseBoardState,
} from './board-doc.js';

db.run(`
  CREATE TABLE IF NOT EXISTS boards (
    name TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    ydoc BLOB,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);
// Databases created before realtime board sync are missing the ydoc column.
const boardsColumns = db.prepare('PRAGMA table_info(boards)').all() as { name: string }[];
if (!boardsColumns.some((column) => column.name === 'ydoc')) {
  db.run('ALTER TABLE boards ADD COLUMN ydoc BLOB');
}

/** Persist a board room's Yjs binary state. */
export function saveBoardToDb(boardName: string, ydoc: Y.Doc) {
  const update = Y.encodeStateAsUpdate(ydoc);
  // The JSON state is derived from the doc so the REST API and dashboard stay in sync.
  const state = JSON.stringify(boardStateFromDoc(ydoc));
  db.prepare(`
    INSERT INTO boards (name, state, ydoc, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(name) DO UPDATE SET
      state = excluded.state,
      ydoc = excluded.ydoc,
      updated_at = CURRENT_TIMESTAMP
  `).run(boardName, state, Buffer.from(update));
  console.log(`[Database] Saved binary state for board "${boardName}". Size: ${update.byteLength} bytes.`);
}

/** Load a board room's stored Yjs state, seeding new boards with a default section. */
export function bindBoardDoc(boardName: string, ydoc: Y.Doc) {
  const row = db.prepare('SELECT state, ydoc FROM boards WHERE name = ?').get(boardName) as
    | { state: string; ydoc: Buffer | null }
    | undefined;

  if (row?.ydoc) {
    Y.applyUpdate(ydoc, new Uint8Array(row.ydoc));
    console.log(`[Yjs Persistence] Loaded existing state for board "${boardName}"`);
  } else {
    // First realtime session: seed from the stored JSON state (row created via REST) or the default board.
    applyBoardStateToDoc(ydoc, parseBoardState(row?.state) ?? createDefaultBoardState());
    saveBoardToDb(boardName, ydoc);
    console.log(`[Yjs Persistence] Seeded state for board "${boardName}"`);
  }
}

export const boardsRouter = Router();

boardsRouter.get('/boards', (_req, res) => {
  try {
    const rows = db.prepare('SELECT name, updated_at FROM boards ORDER BY updated_at DESC').all();
    res.json(rows);
  } catch (error) {
    console.error('Error fetching boards:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

boardsRouter.get('/board/:name', (req, res) => {
  const { name } = req.params;
  try {
    let row = db.prepare('SELECT name, state, updated_at FROM boards WHERE name = ?').get(name) as any;
    if (!row) {
      const state = JSON.stringify(createDefaultBoardState());
      db.prepare(`
        INSERT INTO boards (name, state, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `).run(name, state);
      row = { name, state, updated_at: new Date().toISOString() };
      console.log(`[Database] Created new board entry: ${name}`);
    }
    res.json(row);
  } catch (error) {
    console.error(`Error fetching board ${name}:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
