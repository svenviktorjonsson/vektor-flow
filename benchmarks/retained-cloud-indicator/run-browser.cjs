const { spawn, spawnSync } = require('node:child_process');
const { createServer } = require('node:http');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { edgeLaunchArgs } = require('../../tests/helpers/large_scene_edge_launch.js');

const ASSETS = new Map([
  ['/browser.html', ['browser.html', 'text/html; charset=utf-8']],
  ['/retained-cloud-bundle.mjs', ['retained-cloud-bundle.mjs', 'text/javascript; charset=utf-8']],
  ['/vf-geom-math.js', ['vf-geom-math.js', 'text/javascript; charset=utf-8']],
  ['/vf-geom-wgpu.js', ['vf-geom-wgpu.js', 'text/javascript; charset=utf-8']],
  ['/assets/fonts/NotoSans-Regular-chess-sdf.png', ['NotoSans-Regular-chess-sdf.png', 'image/png']],
]);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startOrigin(directory) {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    const asset = ASSETS.get(pathname);
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
      response.setHeader('Content-Type', asset[1]);
      response.end(fs.readFileSync(path.join(directory, asset[0])));
    } catch (error) {
      response.statusCode = 500;
      response.end(String(error?.message ?? error));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections?.();
    }),
  };
}

async function connectWebSocket(url) {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.onopen = () => resolve(socket);
    socket.onerror = reject;
  });
}

async function cdp(socket, state, method, params = {}) {
  return await new Promise((resolve, reject) => {
    const id = ++state.id;
    state.pending.set(id, (message) => message.error
      ? reject(new Error(JSON.stringify(message.error)))
      : resolve(message.result));
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function fetchJson(url) {
  const response = await fetch(url);
  return await response.json();
}

async function terminate(child) {
  if (child.exitCode !== null) return;
  if (process.platform === 'win32') {
    const taskkill = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
    spawnSync(taskkill, ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    child.kill('SIGKILL');
  }
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const ownedRoot = path.join(repoRoot, '.test-tmp');
  const directory = path.join(ownedRoot, `retained-cloud-${process.pid}`);
  const profile = path.join(directory, 'edge-profile');
  if (!directory.startsWith(`${ownedRoot}${path.sep}`)) throw new Error('temporary directory escaped its owner');
  fs.mkdirSync(profile, { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'browser-entry.mjs')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'chrome140',
    outfile: path.join(directory, 'retained-cloud-bundle.mjs'),
    logLevel: 'warning',
  });
  for (const file of ['browser.html']) fs.copyFileSync(path.join(__dirname, file), path.join(directory, file));
  for (const file of ['vf-geom-math.js', 'vf-geom-wgpu.js']) {
    fs.copyFileSync(path.join(repoRoot, 'web', 'vf-ui', 'geom', file), path.join(directory, file));
  }
  fs.copyFileSync(
    path.join(repoRoot, 'web', 'vf-ui', 'assets', 'fonts', 'NotoSans-Regular-chess-sdf.png'),
    path.join(directory, 'NotoSans-Regular-chess-sdf.png'),
  );
  const origin = await startOrigin(directory);
  const port = Number(process.env.VF_RETAINED_CLOUD_CDP_PORT || await freePort());
  const query = new URLSearchParams({
    mode: process.env.VF_RETAINED_CLOUD_MODE || 'smoke',
    pointCount: process.env.VF_RETAINED_CLOUD_POINTS || '10000',
    pointSizePx: process.env.VF_RETAINED_CLOUD_POINT_SIZE || '4',
    implementation: process.env.VF_RETAINED_CLOUD_IMPLEMENTATION || 'vkf',
  });
  const url = `${origin.url}/browser.html?${query}`;
  const edgePath = process.env.VF_EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const args = edgeLaunchArgs({
    profile,
    port,
    url,
    gpuMode: process.env.VF_RETAINED_CLOUD_GPU_MODE || 'hardware',
  });
  args.splice(args.length - 1, 0, '--enable-unsafe-webgpu');
  const edge = spawn(edgePath, args, { stdio: 'ignore', windowsHide: true });
  let browserSocket;
  let pageSocket;
  try {
    let version;
    for (let attempt = 0; attempt < 240; attempt += 1) {
      try { version = await fetchJson(`http://127.0.0.1:${port}/json/version`); break; } catch (_) { await delay(250); }
    }
    if (!version) throw new Error('hidden Edge WebGPU did not start');
    let target;
    for (let attempt = 0; attempt < 240; attempt += 1) {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      target = targets.find((entry) => String(entry.url).includes('browser.html'));
      if (target) break;
      await delay(250);
    }
    if (!target) throw new Error('retained-cloud browser target missing');
    browserSocket = await connectWebSocket(version.webSocketDebuggerUrl);
    pageSocket = await connectWebSocket(target.webSocketDebuggerUrl);
    const browserState = { id: 0, pending: new Map() };
    const pageState = { id: 0, pending: new Map() };
    for (const [socket, state] of [[browserSocket, browserState], [pageSocket, pageState]]) {
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data.toString());
        const callback = state.pending.get(message.id);
        if (callback) { state.pending.delete(message.id); callback(message); }
      };
    }
    await cdp(pageSocket, pageState, 'Runtime.enable');
    let result;
    for (let attempt = 0; attempt < 7200; attempt += 1) {
      const evaluated = await cdp(pageSocket, pageState, 'Runtime.evaluate', {
        expression: 'globalThis.__vfRetainedCloudResult || null',
        returnByValue: true,
      });
      result = evaluated.result.value;
      if (result) break;
      await delay(250);
    }
    if (!result) throw new Error('retained-cloud browser run timed out');
    result.environment = {
      operatingSystem: `${os.type()} ${os.release()}`,
      architecture: os.arch(),
      cpu: os.cpus()[0]?.model ?? 'unknown',
      browser: 'Microsoft Edge',
      hidden: true,
      viewport: [1280, 720],
      devicePixelRatio: 1,
    };
    process.stdout.write(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
    try { await cdp(browserSocket, browserState, 'Browser.close'); } catch (_) {}
  } finally {
    try { pageSocket?.close(); } catch (_) {}
    try { browserSocket?.close(); } catch (_) {}
    await terminate(edge);
    await origin.close();
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch (_) {}
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
