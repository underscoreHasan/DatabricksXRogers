import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoResponse } from './examples/demo-response.mjs';
import { isFutureDate } from './js/data.js';
const root = fileURLToPath(new URL('.', import.meta.url));
const demo = process.argv.includes('--demo');
const port = Number(process.env.PORT || 8080);
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    if (url.pathname === '/api/forecast') {
      const date = url.searchParams.get('date');
      const status = !demo ? 404 : !isFutureDate(date) ? 400 : 200;
      const body = status === 200 ? demoResponse(date) : { error: !demo ? 'Implement /api/forecast or change js/config.js.' : 'Choose a future date.' };
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(req.method === 'HEAD' ? undefined : JSON.stringify(body));
    }
    const path = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) { res.writeHead(403); return res.end(); }
    const bytes = await readFile(path);
    res.writeHead(200, { 'Content-Type': `${types[extname(path)] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`http://localhost:${port} · ${demo ? 'ILLUSTRATIVE DEMO DATA' : 'backend endpoint required'}`));
