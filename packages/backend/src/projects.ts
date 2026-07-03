import { Router } from 'express';
import * as Y from 'yjs';
import { db } from './db.js';

db.run(`
  CREATE TABLE IF NOT EXISTS projects (
    name TEXT PRIMARY KEY,
    ydoc BLOB,
    markdown TEXT DEFAULT '',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);

/** Persist a project room's Yjs binary state. */
export function saveProjectToDb(docName: string, ydoc: Y.Doc) {
  const state = Y.encodeStateAsUpdate(ydoc);
  db.prepare(`
    INSERT INTO projects (name, ydoc, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(name) DO UPDATE SET
      ydoc = excluded.ydoc,
      updated_at = CURRENT_TIMESTAMP
  `).run(docName, Buffer.from(state));
  console.log(`[Database] Saved binary state for project "${docName}". Size: ${state.byteLength} bytes.`);
}

/** Load a project room's stored Yjs state, creating the row on first visit. */
export function bindProjectDoc(docName: string, ydoc: Y.Doc) {
  const row = db.prepare('SELECT ydoc FROM projects WHERE name = ?').get(docName) as { ydoc: Buffer } | undefined;

  if (row && row.ydoc) {
    Y.applyUpdate(ydoc, new Uint8Array(row.ydoc));
    console.log(`[Yjs Persistence] Loaded existing state for project "${docName}"`);
  } else {
    console.log(`[Yjs Persistence] No existing state found for project "${docName}". Starting fresh.`);
    db.prepare(`
      INSERT INTO projects (name, markdown, updated_at)
      VALUES (?, '', CURRENT_TIMESTAMP)
      ON CONFLICT(name) DO NOTHING
    `).run(docName);
  }
}

export const projectsRouter = Router();

projectsRouter.get('/projects', (_req, res) => {
  try {
    const rows = db.prepare('SELECT name, markdown, updated_at FROM projects ORDER BY updated_at DESC').all();
    res.json(rows);
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

projectsRouter.get('/project/:name', (req, res) => {
  const { name } = req.params;
  try {
    let row = db.prepare('SELECT name, markdown, updated_at FROM projects WHERE name = ?').get(name) as any;
    if (!row) {
      db.prepare(`
        INSERT INTO projects (name, markdown, updated_at)
        VALUES (?, '', CURRENT_TIMESTAMP)
      `).run(name);
      row = { name, markdown: '', updated_at: new Date().toISOString() };
      console.log(`[Database] Created new project entry: ${name}`);
    }
    res.json(row);
  } catch (error) {
    console.error(`Error fetching project ${name}:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

projectsRouter.put('/project/:name', (req, res) => {
  const { name } = req.params;
  const { markdown } = req.body;
  if (markdown === undefined) {
    return res.status(400).json({ error: 'Missing markdown field' });
  }
  try {
    db.prepare(`
      INSERT INTO projects (name, markdown, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(name) DO UPDATE SET
        markdown = excluded.markdown,
        updated_at = CURRENT_TIMESTAMP
    `).run(name, markdown);
    console.log(`[Database] Updated plain markdown for project "${name}" (${markdown.length} chars).`);
    res.json({ success: true });
  } catch (error) {
    console.error(`Error updating markdown for project ${name}:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
