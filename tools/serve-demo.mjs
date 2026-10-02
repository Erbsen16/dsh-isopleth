// 极简静态服务器：demo 页用了原生 ESM，file:// 下会被 CORS 挡住，所以需要一个 http 源。
// 只服务本仓库根目录，不做目录穿越。
//
//   node tools/serve-demo.mjs [port]      # 打开 http://127.0.0.1:<port>/examples/demo.html
//
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.css': 'text/css; charset=utf-8',
};

export function serve(port = 0) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    const file = join(ROOT, rel === '' ? 'examples/demo.html' : rel);

    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    let st;
    try {
      st = statSync(file);
    } catch {
      res.writeHead(404).end('not found');
      return;
    }
    if (st.isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok({ server, port: server.address().port, root: ROOT })));
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('serve-demo.mjs')) {
  const port = Number(process.argv[2] ?? 8787);
  const { port: p } = await serve(port);
  console.log(`hypsa-isopleth demo -> http://127.0.0.1:${p}/examples/demo.html`);
}
