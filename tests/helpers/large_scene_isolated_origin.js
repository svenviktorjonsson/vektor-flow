const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const OWNED_ASSETS = new Map([
  ['/benchmark.html', { file: 'benchmark.html', contentType: 'text/html; charset=utf-8' }],
  ['/large-scene-peer-bundle.mjs', { file: 'large-scene-peer-bundle.mjs', contentType: 'text/javascript; charset=utf-8' }],
]);

async function startLargeSceneIsolatedOrigin(directory) {
  const root = path.resolve(directory);
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    const asset = OWNED_ASSETS.get(pathname);
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('Cache-Control', 'no-store');
    if (!asset) {
      response.statusCode = 404;
      response.end('not found');
      return;
    }
    try {
      const body = await readFile(path.join(root, asset.file));
      response.setHeader('Content-Type', asset.contentType);
      response.end(body);
    } catch (error) {
      response.statusCode = 500;
      response.end(String(error?.message ?? error));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections?.();
    }),
  };
}

module.exports = { startLargeSceneIsolatedOrigin };
