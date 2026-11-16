'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const port = Number(process.env.PORT || 4173);
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.webp':'image/webp', '.png':'image/png', '.gif':'image/gif', '.avif':'image/avif', '.ttf':'font/ttf', '.otf':'font/otf', '.woff2':'font/woff2', '.json':'application/json; charset=utf-8', '.pdf':'application/pdf', '.wasm':'application/wasm', '.bcmap':'application/octet-stream', '.pfb':'application/octet-stream', '.icc':'application/octet-stream', '.bin':'application/octet-stream', '.txt':'text/plain; charset=utf-8' };
http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, {Allow:'GET, HEAD'}); res.end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); res.end('Bad request'); return; }
  if (pathname.includes('\0')) { res.writeHead(400); res.end('Bad request'); return; }
  const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
  if (!Object.hasOwn(types, path.extname(file))) { res.writeHead(404); res.end('Not found'); return; }
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    const headers = { 'Content-Type': types[path.extname(file)], 'Content-Length': stat.size, 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges':'bytes', 'Cache-Control': /\.(webp|woff2|ttf|svg|pdf|wasm)$/.test(file) ? 'public, max-age=86400' : 'no-cache' };
    if (path.extname(file) === '.pdf') headers['Content-Disposition'] = "attachment; filename=booklet-israel-portnoy.pdf; filename*=UTF-8''" + encodeURIComponent(path.basename(file));
    let start = 0, end = stat.size - 1, status = 200;
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!match || (!match[1] && !match[2])) { res.writeHead(416, {'Content-Range':`bytes */${stat.size}`}); res.end(); return; }
      if (!match[1]) start = Math.max(0, stat.size - Number(match[2]));
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
      if (start > end || start >= stat.size || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) { res.writeHead(416, {'Content-Range':`bytes */${stat.size}`}); res.end(); return; }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
      headers['Content-Length'] = end - start + 1;
    }
    res.writeHead(status, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file, {start,end}).on('error', () => res.destroy()).pipe(res);
  });
}).listen(port, '127.0.0.1', () => console.log(`Local preview: http://127.0.0.1:${port}`));
