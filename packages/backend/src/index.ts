import http from 'http';
import { WebSocketServer } from 'ws';
import express from 'express';
import cors from 'cors';
import path from 'path';
import * as Y from 'yjs';
import { setupWSConnection, setPersistence } from './yjs-utils.js';
import { assets } from './frontend-assets.js';
import { boardNameFromRoom, isBoardRoom } from './board-doc.js';

const DEFAULT_PORT = 3001;

function printUsage() {
  console.log(`Usage: collab-editor-app [options]

Options:
  -h, --help           Show this help message and exit.
  --port <port>        Port to serve HTTP and WebSocket traffic on.
  --port=<port>        Port to serve HTTP and WebSocket traffic on.

Environment:
  PORT                 Fallback port when --port is not provided.

Defaults:
  port                 ${DEFAULT_PORT}
`);
}

function parsePort(value: string | undefined, source: string): number | undefined {
  if (value === undefined) return undefined;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`Invalid ${source}: "${value}". Expected an integer from 1 to 65535.`);
    process.exit(1);
  }

  return port;
}

function hasHelpArg(argv: string[]): boolean {
  return argv.includes('-h') || argv.includes('--help');
}

function parsePortArg(argv: string[]): number | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--port') {
      if (argv[index + 1] === undefined) {
        console.error('Invalid --port: missing value. Expected an integer from 1 to 65535.');
        process.exit(1);
      }
      return parsePort(argv[index + 1], '--port');
    }

    if (arg.startsWith('--port=')) {
      return parsePort(arg.slice('--port='.length), '--port');
    }
  }

  return undefined;
}

const argv = process.argv.slice(2);

if (hasHelpArg(argv)) {
  printUsage();
  process.exit(0);
}

const PORT = parsePortArg(argv) ?? parsePort(process.env.PORT, 'PORT') ?? DEFAULT_PORT;

// Importing the domain modules opens the SQLite database and creates their
// tables, so load them only after `--help` and port validation have passed.
const [
  { bindProjectDoc, projectsRouter, saveProjectToDb },
  { bindBoardDoc, boardsRouter, saveBoardToDb },
] = await Promise.all([import('./projects.js'), import('./boards.js')]);

// Yjs persistence: project rooms live in the projects table, board rooms
// (named `board/<name>`) in the boards table.
const saveDebounceTimers = new Map<string, Timer>();

function bindDocToDb(docName: string, ydoc: Y.Doc) {
  if (isBoardRoom(docName)) {
    bindBoardDoc(boardNameFromRoom(docName), ydoc);
  } else {
    bindProjectDoc(docName, ydoc);
  }
}

function saveDocToDb(docName: string, ydoc: Y.Doc) {
  if (isBoardRoom(docName)) {
    saveBoardToDb(boardNameFromRoom(docName), ydoc);
  } else {
    saveProjectToDb(docName, ydoc);
  }
}

setPersistence({
  bindState: async (docName: string, ydoc: Y.Doc) => {
    console.log(`[Yjs Persistence] Binding state for room: ${docName}`);
    bindDocToDb(docName, ydoc);

    ydoc.on('update', () => {
      const existing = saveDebounceTimers.get(docName);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        saveDocToDb(docName, ydoc);
        saveDebounceTimers.delete(docName);
      }, 2000);
      saveDebounceTimers.set(docName, timer);
    });
  },

  writeState: async (docName: string, ydoc: Y.Doc) => {
    console.log(`[Yjs Persistence] Writing final state for room: ${docName}`);
    const existing = saveDebounceTimers.get(docName);
    if (existing) {
      clearTimeout(existing);
      saveDebounceTimers.delete(docName);
    }
    saveDocToDb(docName, ydoc);
  },
});

const isCompiled = assets.size > 0;

if (isCompiled) {
  console.log(`[VFS] Server compiled with ${assets.size} embedded static assets.`);
}

const app = express();
app.use(cors());
app.use(express.json());

// Serve embedded assets in compiled mode
app.use((req, res, next) => {
  if (!isCompiled) return next();

  const reqPath = req.path;
  const lookupPath = reqPath === '/' ? '/index.html' : reqPath;
  const asset = assets.get(lookupPath);

  if (asset) {
    res.setHeader('Content-Type', asset.mime);
    if (!lookupPath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
    res.send(asset.data);
    return;
  }

  // SPA fallback for non-API routes
  if (!reqPath.startsWith('/api') && !reqPath.startsWith('/ws')) {
    const index = assets.get('/index.html');
    if (index) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(index.data);
      return;
    }
  }

  next();
});

// Serve static files in local development mode
const staticPath = path.join(import.meta.dir, '../../frontend/dist');
app.use(express.static(staticPath));

// REST API
app.use('/api', projectsRouter);
app.use('/api', boardsRouter);

// SPA fallback in local development mode
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
  res.sendFile(path.join(staticPath, 'index.html'), (err) => {
    if (err) next();
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', (ws, req) => {
  console.log(`[WebSocket] New client connection: ${req.url}`);
  setupWSConnection(ws, req);
});

server.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`  Collaborative Editor Backend is running:     `);
  console.log(`  - HTTP API: http://localhost:${PORT}        `);
  console.log(`  - WebSocket Server: ws://localhost:${PORT}  `);
  console.log(`===============================================`);
});
