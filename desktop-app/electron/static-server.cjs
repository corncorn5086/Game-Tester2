/**
 * Tiny static file server for the packaged v3 design.
 *
 * The design's runtime does `fetch(location.href)` to re-read itself and
 * resolve its inlined resources. That fetch is blocked under the file://
 * protocol, which makes the UI break right after the first paint — so we
 * serve the standalone/ folder over http://127.0.0.1 instead.
 */
const { createServer } = require('node:http');
const { readFile } = require('node:fs');
const { join, normalize, extname, sep } = require('node:path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

/**
 * Serve `root` on a random loopback port.
 * @returns {Promise<{port:number, close:()=>void}>}
 */
function startStaticServer(root) {
  const base = normalize(root).replace(new RegExp(`\\${sep}$`), '');
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
      const filePath = normalize(join(base, urlPath));
      // Prevent path traversal outside the served root.
      if (filePath !== base && !filePath.startsWith(base + sep)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ port, close: () => server.close() });
    });
  });
}

module.exports = { startStaticServer };
