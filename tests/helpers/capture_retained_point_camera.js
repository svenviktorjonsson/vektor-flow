const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function removeOwnedProfile(profile, profileRoot) {
  if (!profile.startsWith(`${profileRoot}${path.sep}`)) throw new Error('test profile escaped its root');
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      fs.rmSync(profile, { recursive: true, force: true });
      if (!fs.existsSync(profile)) return;
    } catch (error) {
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(error?.code)) throw error;
    }
    await delay(250);
  }
  throw new Error(`owned Edge profile remained locked: ${profile}`);
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

async function main() {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const fixture = path.resolve(repoRoot, 'tests', 'fixtures', 'retained_point_camera_capture.html');
  const edgePath = process.env.VF_EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  if (!fs.existsSync(edgePath)) throw new Error(`edge missing at ${edgePath}`);
  const port = Number(process.env.VF_POINT_CAMERA_CDP_PORT || 9347);
  const profileRoot = path.resolve(repoRoot, '.test-tmp');
  const profile = path.resolve(profileRoot, `retained-point-camera-${process.pid}`);
  if (!profile.startsWith(`${repoRoot}${path.sep}`)) throw new Error('test profile escaped the repository');
  fs.mkdirSync(profile, { recursive: true });
  const url = `file:///${fixture.replace(/\\/g, '/')}`;
  const edge = spawn(edgePath, [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    '--headless=new',
    '--allow-file-access-from-files',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--use-angle=swiftshader',
    '--no-first-run',
    '--no-default-browser-check',
    url,
  ], { stdio: 'ignore', windowsHide: true });

  let browserSocket;
  let pageSocket;
  let finalResult;
  try {
    let version;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        version = await fetchJson(`http://127.0.0.1:${port}/json/version`);
        break;
      } catch (_) {
        await delay(250);
      }
    }
    if (!version) throw new Error('headless Edge CDP did not start');
    let target;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      target = targets.find((entry) => String(entry.url).startsWith('file:///')
        && String(entry.url).includes('retained_point_camera_capture.html'));
      if (target) break;
      await delay(250);
    }
    if (!target) throw new Error('retained point capture target missing');
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
    let result;
    for (let attempt = 0; attempt < 480; attempt += 1) {
      const evaluated = await sendCdp(pageSocket, pageState, 'Runtime.evaluate', {
        expression: 'window.__vfPointCameraResult || null',
        returnByValue: true,
      });
      result = evaluated.result.value;
      if (result) break;
      await delay(250);
    }
    if (!result) throw new Error('retained point capture timed out');
    if (!result.ok) throw new Error(result.error || 'retained point capture failed');
    if (result.mode !== 'headless-webgl2-correctness-only' || result.performanceClaim !== false) {
      throw new Error(`invalid capture mode ${JSON.stringify(result)}`);
    }
    if (result.million.bufferWrites !== 1
      || result.million.bufferAllocations !== 1
      || result.million.createdBuffers !== 1) {
      throw new Error(`million-point buffer was not retained: ${JSON.stringify(result.million)}`);
    }
    if (result.million.frame0Sha256 === result.million.frame60Sha256) {
      throw new Error('camera pan did not change the million-point framebuffer');
    }
    if (!result.oracle.frame0.passed || !result.oracle.frame60.passed || result.oracle.bufferWrites !== 1) {
      throw new Error(`frame oracle failed: ${JSON.stringify(result.oracle)}`);
    }
    finalResult = result;
    await sendCdp(browserSocket, browserState, 'Browser.close');
  } finally {
    try { pageSocket?.close(); } catch (_) {}
    try { browserSocket?.close(); } catch (_) {}
    await waitForExit(edge, 3000);
    if (edge.exitCode === null) {
      try { edge.kill(); } catch (_) {}
      await waitForExit(edge, 3000);
    }
    await removeOwnedProfile(profile, profileRoot);
    if (fs.existsSync(profileRoot) && fs.readdirSync(profileRoot).length === 0) fs.rmdirSync(profileRoot);
  }
  process.stdout.write(JSON.stringify(finalResult));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
