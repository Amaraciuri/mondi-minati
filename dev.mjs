// Local development: builds the site, serves dist/ and rebuilds when src/ or public/ change.
//   npm run dev   ->  http://localhost:5173
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const PORT = Number(process.env.PORT) || 5173;
const ROOT = path.resolve('dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};

function rebuild() {
  const r = spawnSync(process.execPath, ['build.mjs', 'site', '--dev'], { stdio: 'inherit' });
  if (r.status !== 0) console.error('Build failed, waiting for the next change.');
}

rebuild();
let timer = null;
for (const dir of ['src', 'public']) {
  fs.watch(dir, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(rebuild, 150);
  });
}

http
  .createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = path.join(ROOT, url);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end();
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  })
  .listen(PORT, () => console.log(`Mined Worlds: http://localhost:${PORT}  (Ctrl+C to stop)`));
