import { Database } from 'bun:sqlite';

// Single shared handle; each domain module (projects.ts, boards.ts) creates
// its own tables on import.
export const db = new Database('collab.sqlite');

console.log('SQLite database initialized successfully.');
