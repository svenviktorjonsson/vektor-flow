const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect(url) {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.onopen = () => resolve(socket);
    socket.onerror = reject;
  });
}

async function cdp(socket, state, method, params = {}) {
  return await new Promise((resolve, reject) => {
    const id = ++state.nextId;
    state.pending.set(id, (message) => message.error
      ? reject(new Error(JSON.stringify(message.error)))
      : resolve(message.result));
    socket.send(JSON.stringify({ id, method, params }));
  });
}

function receive(state, event) {
  const message = JSON.parse(event.data.toString());
  const handler = message.id && state.pending.get(message.id);
  if (!handler) return;
  state.pending.delete(message.id);
  handler(message);
}

function serveOverlay(scenePath, port) {
  const overlayRoot = path.resolve(path.dirname(scenePath), "../..");
  const relativeScene = path.relative(overlayRoot, scenePath).replaceAll(path.sep, "/");
  const mime = new Map([
    [".bin", "application/octet-stream"], [".css", "text/css"], [".html", "text/html"],
    [".js", "text/javascript"], [".json", "application/json"], [".mjs", "text/javascript"],
    [".wasm", "application/wasm"], [".wgsl", "text/plain"],
  ]);
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, `http://127.0.0.1:${port}`).pathname).replace(/^\/+/, "");
    const target = path.resolve(overlayRoot, ...pathname.split("/"));
    if (target !== overlayRoot && !target.startsWith(`${overlayRoot}${path.sep}`)) {
      response.writeHead(403).end();
      return;
    }
    fs.readFile(target, (error, bytes) => {
      if (error) {
        response.writeHead(error.code === "ENOENT" ? 404 : 500).end();
        return;
      }
      response.writeHead(200, { "Content-Type": mime.get(path.extname(target)) || "application/octet-stream" });
      response.end(bytes);
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve({
      server,
      url: `http://127.0.0.1:${port}/${relativeScene}`,
    }));
  });
}

async function main() {
  const scenePath = path.resolve(process.argv[2] || "");
  const frameId = process.argv[3] || "";
  const requireRenderer = process.argv[4] !== "frame-only";
  const cdpPort = Number(process.argv[5] || "9480");
  const compositeOutputPath = process.argv[6] ? path.resolve(process.argv[6]) : "";
  if (!process.argv[2] || !frameId) {
    throw new Error("usage: node run_staged_ui_example.js <scene> <frame-id> [renderer|frame-only] [cdp-port] [composite-output.png]");
  }
  const edgePath = process.env.VF_EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  if (!fs.existsSync(edgePath)) throw new Error(`edge missing at ${edgePath}`);
  const served = await serveOverlay(scenePath, cdpPort + 1000);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "vf-shipped-ui-"));
  const edge = spawn(edgePath, [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${cdpPort}`,
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan,UseSkiaRenderer",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1400,1000",
    "--headless=new",
    served.url,
  ], { stdio: "ignore", windowsHide: true });
  try {
    let version;
    for (let attempt = 0; attempt < 100 && !version; attempt += 1) {
      try { version = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then((response) => response.json()); } catch (_) {}
      if (!version) await delay(200);
    }
    if (!version) throw new Error("hidden Edge CDP did not start");
    let target;
    for (let attempt = 0; attempt < 100 && !target; attempt += 1) {
      const targets = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then((response) => response.json());
      target = targets.find((candidate) => candidate.url === served.url);
      if (!target) await delay(200);
    }
    if (!target) throw new Error("hidden page target is missing");
    const page = await connect(target.webSocketDebuggerUrl);
    const browser = await connect(version.webSocketDebuggerUrl);
    const pageState = { nextId: 0, pending: new Map() };
    const browserState = { nextId: 0, pending: new Map() };
    page.onmessage = (event) => receive(pageState, event);
    browser.onmessage = (event) => receive(browserState, event);
    await cdp(page, pageState, "Page.enable");
    await cdp(page, pageState, "Runtime.enable");
    let evidence;
    for (let attempt = 0; attempt < 180; attempt += 1) {
      const result = await cdp(page, pageState, "Runtime.evaluate", {
        returnByValue: true,
        expression: `(() => {
          const frame = document.querySelector('.vf-frame[data-vf-frame-id=${JSON.stringify(frameId)}]');
          const status = window.VfDisplay && window.VfDisplay.geomFrameStatus
            ? window.VfDisplay.geomFrameStatus(${JSON.stringify(frameId)}) : null;
          return {
            frame: !!frame,
            frameChrome: !!(frame && frame.querySelector('.vf-frame__header')),
            canvas: !!(frame && frame.querySelector('canvas')),
            status,
            error: window.__vfLastError || null,
            fatal: window.__vfNativeSceneFatal || null,
          };
        })()`,
      });
      evidence = result.result.value;
      if (evidence.error || evidence.fatal || (evidence.status && (evidence.status.initFailures.length || evidence.status.runtimeFailures.length))) {
        throw new Error(`staged UI failed: ${JSON.stringify(evidence)}`);
      }
      if (evidence.frame && (!requireRenderer || (evidence.status && evidence.status.runningRenderers > 0))) break;
      await delay(250);
    }
    if (!evidence.frame || (requireRenderer && !(evidence.status && evidence.status.runningRenderers > 0))) {
      throw new Error(`staged UI never became ready: ${JSON.stringify(evidence)}`);
    }
    await delay(1000);
    const screenshot = await cdp(page, pageState, "Page.captureScreenshot", { format: "png", fromSurface: true });
    const screenshotBytes = Buffer.from(screenshot.data, "base64");
    evidence.composite_sha256 = crypto.createHash("sha256").update(screenshotBytes).digest("hex");
    if (compositeOutputPath) {
      fs.mkdirSync(path.dirname(compositeOutputPath), { recursive: true });
      fs.writeFileSync(compositeOutputPath, screenshotBytes);
      evidence.composite_path = compositeOutputPath;
    }
    evidence.hidden = true;
    console.log(JSON.stringify(evidence));
    try { await cdp(browser, browserState, "Browser.close"); } catch (_) {}
  } finally {
    try { edge.kill(); } catch (_) {}
    await new Promise((resolve) => served.server.close(resolve));
    await delay(500);
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch (_) {}
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
