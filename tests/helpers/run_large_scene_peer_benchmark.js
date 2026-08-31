const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    child.once('exit', () => { clearTimeout(timeout); resolve(); });
  });
}

async function removeOwnedDirectory(directory, ownedRoot) {
  if (!directory.startsWith(`${ownedRoot}${path.sep}`)) throw new Error('test directory escaped its root');
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
      if (!fs.existsSync(directory)) return;
    } catch (error) {
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(error?.code)) throw error;
    }
    await delay(250);
  }
  throw new Error(`owned benchmark directory remained locked: ${directory}`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  return await response.json();
}

async function connectWs(url) {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.onopen = () => resolve(socket);
    socket.onerror = reject;
  });
}

async function sendCdp(socket, state, method, params = {}) {
  return await new Promise((resolve, reject) => {
    const id = ++state.nextId;
    state.pending.set(id, (message) => {
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function buildFixture(repoRoot, directory) {
  const entry = path.resolve(repoRoot, 'tests', 'fixtures', 'large_scene_peer_benchmark.mjs');
  const bundle = path.resolve(directory, 'large-scene-peer-bundle.mjs');
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'chrome140',
    outfile: bundle,
    sourcemap: false,
    logLevel: 'warning',
  });
  const template = fs.readFileSync(
    path.resolve(repoRoot, 'tests', 'fixtures', 'large_scene_peer_benchmark.html'),
    'utf8',
  );
  fs.writeFileSync(path.resolve(directory, 'benchmark.html'), template);
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const implementation = process.env.VF_LARGE_SCENE_IMPLEMENTATION || 'deck-gl';
  const workload = process.env.VF_LARGE_SCENE_WORKLOAD || 'orthographic-points-100k-static';
  const warmups = Number(process.env.VF_LARGE_SCENE_WARMUPS || 1);
  const measured = Number(process.env.VF_LARGE_SCENE_MEASURED || 1);
  const correctnessOnly = process.env.VF_LARGE_SCENE_CORRECTNESS_ONLY !== '0';
  const edgePath = process.env.VF_EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  if (!fs.existsSync(edgePath)) throw new Error(`edge missing at ${edgePath}`);
  const port = Number(process.env.VF_LARGE_SCENE_CDP_PORT || 9353);
  const ownedRoot = path.resolve(repoRoot, '.test-tmp');
  const directory = path.resolve(ownedRoot, `large-scene-peer-${process.pid}`);
  const profile = path.resolve(directory, 'edge-profile');
  if (!directory.startsWith(`${repoRoot}${path.sep}`)) throw new Error('test directory escaped the repository');
  fs.mkdirSync(profile, { recursive: true });
  await buildFixture(repoRoot, directory);
  const query = new URLSearchParams({ implementation, workload, warmups, measured, correctnessOnly });
  const url = `file:///${path.resolve(directory, 'benchmark.html').replace(/\\/g, '/')}?${query}`;
  const edge = spawn(edgePath, [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    '--headless=new',
    '--allow-file-access-from-files',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--use-angle=swiftshader',
    '--force-device-scale-factor=1',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--no-first-run',
    '--no-default-browser-check',
    url,
  ], { stdio: 'ignore', windowsHide: true });

  let browserSocket;
  let pageSocket;
  let finalResult;
  let cleanupError = null;
  try {
    let version;
    for (let attempt = 0; attempt < 160; attempt += 1) {
      try { version = await fetchJson(`http://127.0.0.1:${port}/json/version`); break; } catch (_) { await delay(250); }
    }
    if (!version) throw new Error('headless Edge CDP did not start');
    let target;
    for (let attempt = 0; attempt < 160; attempt += 1) {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      target = targets.find((entry) => String(entry.url).includes('benchmark.html'));
      if (target) break;
      await delay(250);
    }
    if (!target) throw new Error('large-scene benchmark target missing');
    browserSocket = await connectWs(version.webSocketDebuggerUrl);
    pageSocket = await connectWs(target.webSocketDebuggerUrl);
    const browserState = { nextId: 0, pending: new Map() };
    const pageState = { nextId: 0, pending: new Map() };
    for (const [socket, state] of [[browserSocket, browserState], [pageSocket, pageState]]) {
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data.toString());
        if (message.id && state.pending.has(message.id)) {
          state.pending.get(message.id)(message);
          state.pending.delete(message.id);
        }
      };
    }
    await sendCdp(pageSocket, pageState, 'Runtime.enable');
    for (let attempt = 0; attempt < 7200; attempt += 1) {
      const evaluated = await sendCdp(pageSocket, pageState, 'Runtime.evaluate', {
        expression: 'window.__vfLargeScenePeerResult || null',
        returnByValue: true,
      });
      finalResult = evaluated.result.value;
      if (finalResult) break;
      await delay(250);
    }
    if (!finalResult) throw new Error('large-scene benchmark timed out');
    await sendCdp(browserSocket, browserState, 'Browser.close');
  } finally {
    try { pageSocket?.close(); } catch (_) {}
    try { browserSocket?.close(); } catch (_) {}
    await waitForExit(edge, 5000);
    if (edge.exitCode === null) {
      try { edge.kill(); } catch (_) {}
      await waitForExit(edge, 5000);
    }
    try {
      await removeOwnedDirectory(directory, ownedRoot);
      if (fs.existsSync(ownedRoot) && fs.readdirSync(ownedRoot).length === 0) fs.rmdirSync(ownedRoot);
    } catch (error) {
      cleanupError = error;
    }
  }
  if (cleanupError) {
    finalResult = {
      ...(finalResult ?? {}),
      ok: false,
      cleanupError: String(cleanupError?.stack ?? cleanupError),
    };
  }
  process.stdout.write(JSON.stringify(finalResult));
  if (!finalResult?.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
