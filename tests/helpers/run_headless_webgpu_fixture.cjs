const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchJson(url) {
  const response = await fetch(url);
  return response.json();
}

async function connectWebSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.onopen = () => resolve(socket);
    socket.onerror = reject;
  });
}

async function evaluate(socket, state, expression) {
  return new Promise((resolve, reject) => {
    const id = ++state.nextId;
    state.pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true },
    }));
  });
}

async function main() {
  const fixturePath = process.argv[2];
  const evidenceExpression = process.argv[3];
  const port = Number(process.argv[4] || 9371);
  if (!fixturePath || !evidenceExpression) {
    throw new Error('usage: run_headless_webgpu_fixture.cjs <fixture> <evidence-expression> [port]');
  }
  const edgePath = process.env.VF_EDGE_PATH
    || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  if (!fs.existsSync(edgePath)) {
    throw new Error(`Edge missing at ${edgePath}`);
  }
  const absoluteFixture = path.resolve(fixturePath);
  const fixtureUrl = `file:///${absoluteFixture.replace(/\\/g, '/')}`;
  const fixturePrefix = fixtureUrl.replace(/ /g, '%20');
  const userDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-headless-webgpu-'));
  const edge = spawn(edgePath, [
    `--user-data-dir=${userDataDirectory}`,
    `--remote-debugging-port=${port}`,
    '--allow-file-access-from-files',
    '--enable-unsafe-webgpu',
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    fixtureUrl,
  ], { stdio: 'ignore' });
  let browserSocket;
  try {
    let version;
    for (let attempt = 0; attempt < 80 && !version; attempt += 1) {
      try {
        version = await fetchJson(`http://127.0.0.1:${port}/json/version`);
      } catch (_) {
        await delay(250);
      }
    }
    if (!version) throw new Error('headless Edge CDP did not start');
    let pageTarget;
    for (let attempt = 0; attempt < 80 && !pageTarget; attempt += 1) {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      pageTarget = targets.find((target) => String(target.url || '').startsWith(fixturePrefix));
      if (!pageTarget) await delay(250);
    }
    if (!pageTarget) throw new Error('headless fixture target missing');
    const pageSocket = await connectWebSocket(pageTarget.webSocketDebuggerUrl);
    const pageState = { nextId: 0, pending: new Map() };
    pageSocket.onmessage = (event) => {
      const message = JSON.parse(event.data.toString());
      const pending = pageState.pending.get(message.id);
      if (!pending) return;
      pageState.pending.delete(message.id);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result?.result?.value);
    };
    let evidence;
    for (let attempt = 0; attempt < 120 && evidence == null; attempt += 1) {
      evidence = await evaluate(pageSocket, pageState, evidenceExpression);
      if (evidence == null) await delay(250);
    }
    pageSocket.close();
    if (evidence == null) throw new Error('headless fixture did not publish evidence');
    if (evidence.outcome !== 'pass') {
      throw new Error(`headless fixture failed: ${JSON.stringify(evidence)}`);
    }
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
    browserSocket = await connectWebSocket(version.webSocketDebuggerUrl);
    browserSocket.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
  } finally {
    if (browserSocket) browserSocket.close();
    if (process.platform === 'win32' && edge.pid) {
      spawnSync('taskkill', ['/pid', String(edge.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      try { edge.kill(); } catch (_) {}
    }
    await delay(2000);
    const resolvedTemp = path.resolve(os.tmpdir());
    const resolvedUserData = path.resolve(userDataDirectory);
    if (
      path.dirname(resolvedUserData) === resolvedTemp
      && path.basename(resolvedUserData).startsWith('vf-headless-webgpu-')
    ) {
      try {
        fs.rmSync(resolvedUserData, {
          recursive: true,
          force: true,
          maxRetries: 20,
          retryDelay: 200,
        });
      } catch (cleanupError) {
        process.stderr.write(`headless profile cleanup deferred: ${cleanupError.message}\n`);
      }
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
