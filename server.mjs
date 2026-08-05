import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { collectData } from './lib/scan.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 5555;
const ENV_PORT = process.env.PORT ? Number(process.env.PORT) : null;
const HOME = os.homedir();
const WATCH_DIRS = [
  path.join(HOME, '.claude', 'projects'),
  path.join(HOME, '.claude', 'sessions'),
  path.join(HOME, '.claude', 'jobs'),
];

const clients = new Set();
function broadcast() {
  for (const res of clients) res.write('event: update\ndata: {}\n\n');
}

let debounce = null;
for (const dir of WATCH_DIRS) {
  try {
    fs.watch(dir, { recursive: true }, () => {
      clearTimeout(debounce);
      debounce = setTimeout(broadcast, 300);
    });
  } catch (e) {
    console.error(`watch failed for ${dir}: ${e.message}`);
  }
}

const CONTENT_TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/data') {
    res.setHeader('content-type', 'application/json');
    try {
      res.end(JSON.stringify(collectData()));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (url.pathname === '/api/stream') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write('retry: 2000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  // Static files from public/, path-traversal guarded.
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const publicDir = path.join(__dirname, 'public');
  const fp = path.join(publicDir, rel);
  if (fp.startsWith(publicDir) && fs.existsSync(fp) && fs.statSync(fp).isFile()) {
    res.setHeader('content-type', CONTENT_TYPES[path.extname(fp)] || 'text/plain');
    res.end(fs.readFileSync(fp));
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.on('listening', () => {
  console.log(`Claude session timeline → http://localhost:${server.address().port}`);
});

// Bind to `port`. When `fallback` is set (no PORT env given), a busy port isn't
// fatal — we retry on port 0 so the OS hands us any free one. An explicit PORT
// env is treated as a hard requirement: if it's taken, we fail loudly.
function listen(port, fallback) {
  server.removeAllListeners('error');
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      if (fallback) {
        console.error(`port ${port} in use — falling back to a free port`);
        listen(0, false);
        return;
      }
      console.error(`port ${port} already in use — another instance is running. Exiting.`);
      process.exit(1);
    }
    throw e;
  });
  server.listen(port);
}

if (ENV_PORT) listen(ENV_PORT, false);
else listen(DEFAULT_PORT, true);
