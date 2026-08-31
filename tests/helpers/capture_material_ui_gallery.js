const fs = require("fs");
const crypto = require("crypto");
const { spawn } = require("child_process");
const os = require("os");
const path = require("path");

const views = ["view-lighting", "view-mirror", "view-glass", "view-all"];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function receiveCdp(state, event) {
  const message = JSON.parse(event.data.toString());
  const receive = message.id && state.pending.get(message.id);
  if (!receive) return;
  state.pending.delete(message.id);
  receive(message);
}

async function closeScene(runtime) {
  try {
    await sendCdp(runtime.browserWs, runtime.browserState, "Browser.close");
  } catch (_) {}
  await delay(500);
  try { runtime.edge.kill(); } catch (_) {}
}

async function openScene(scenePath, port, frameId) {
  const edgePath = process.env.VF_EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  if (!fs.existsSync(edgePath)) throw new Error(`edge missing at ${edgePath}`);
  const sceneUrl = `file:///${path.resolve(scenePath).replace(/\\/g, "/")}`;
  const sceneUrlPrefix = sceneUrl.replace(/ /g, "%20");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "vf-gallery-edge-"));
  const edge = spawn(edgePath, [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    "--allow-file-access-from-files",
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan,UseSkiaRenderer",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1400,1000",
    "--headless=new",
    sceneUrl,
  ], { stdio: "ignore", windowsHide: true });

  let version;
  for (let attempt = 0; attempt < 80 && !version; attempt += 1) {
    try { version = await fetchJson(`http://127.0.0.1:${port}/json/version`); } catch (_) {}
    if (!version) await delay(250);
  }
  if (!version) throw new Error("headless Edge CDP did not start");
  let target;
  for (let attempt = 0; attempt < 80 && !target; attempt += 1) {
    const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    target = targets.find((candidate) => String(candidate.url || "").startsWith(sceneUrlPrefix));
    if (!target) await delay(250);
  }
  if (!target) throw new Error("headless gallery target is missing");

  const [pageWs, browserWs] = await Promise.all([
    connectWs(target.webSocketDebuggerUrl), connectWs(version.webSocketDebuggerUrl),
  ]);
  const pageState = { nextId: 0, pending: new Map() };
  const browserState = { nextId: 0, pending: new Map() };
  pageWs.onmessage = (event) => receiveCdp(pageState, event);
  browserWs.onmessage = (event) => receiveCdp(browserState, event);
  const runtime = { edge, pageWs, pageState, browserWs, browserState };
  await sendCdp(pageWs, pageState, "Page.enable");
  await sendCdp(pageWs, pageState, "Runtime.enable");
  let readiness;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    readiness = await evaluate(runtime, `(() => ({
      status: window.VfDisplay && window.VfDisplay.geomFrameStatus
        ? window.VfDisplay.geomFrameStatus(${JSON.stringify(frameId)}) : null,
      loadError: window.__vfStaticHtmlLoadError ? String(window.__vfStaticHtmlLoadError) : null,
      controls: !!document.getElementById("view-all")
    }))()`);
    if (readiness && readiness.status && readiness.status.runningRenderers > 0 && readiness.controls) return runtime;
    if (readiness && readiness.loadError) {
      await closeScene(runtime);
      throw new Error(`static gallery failed: ${JSON.stringify(readiness)}`);
    }
    await delay(250);
  }
  await closeScene(runtime);
  throw new Error(`gallery did not become ready: ${JSON.stringify(readiness)}`);
}

async function evaluate(runtime, expression, awaitPromise = false) {
  const result = await sendCdp(runtime.pageWs, runtime.pageState, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise,
  });
  return result && result.result ? result.result.value : null;
}

async function captureFrame(runtime, frameId, outputPath) {
  const value = await evaluate(runtime, `(async () => {
    window.VfDisplay.redrawVisibleGeomFrames();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return window.VfDisplay.__test.captureGeomFrameDataUrl(${JSON.stringify(frameId)});
  })()`, true);
  if (typeof value !== "string" || !value.startsWith("data:image/png;base64,")) {
    throw new Error("VKF frame capture did not return PNG data");
  }
  fs.writeFileSync(outputPath, Buffer.from(value.slice("data:image/png;base64,".length), "base64"));
  return crypto.createHash("sha256").update(fs.readFileSync(outputPath)).digest("hex");
}

async function main() {
  const scenePath = process.argv[2];
  const outputDirectory = process.argv[3];
  const port = Number(process.argv[4] || "9237") || 9237;
  const frameId = process.argv[5] || "frame_0";
  if (!scenePath || !outputDirectory) {
    throw new Error("usage: node capture_material_ui_gallery.js <scenePath> <outputDirectory> [port] [frameId]");
  }
  fs.mkdirSync(outputDirectory, { recursive: true });
  const runtime = await openScene(scenePath, port, frameId);
  const states = [];
  try {
    await delay(1200);
    for (let index = 0; index < views.length; index += 1) {
      const viewId = views[index];
      const observed = await evaluate(runtime, `(async () => {
        const button = document.getElementById(${JSON.stringify(viewId)});
        if (!button) return { ok:false, reason:"button missing" };
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 240));
        if (window.__vfRetainedEventError) {
          return { ok:false, reason:String(window.__vfRetainedEventError.message || window.__vfRetainedEventError) };
        }
        const state = window.VfDisplay.__test.debugDynamicGeomFrameState(${JSON.stringify(frameId)});
        return { ok:true, meshCount:state && state.renderer ? state.renderer.partCount : 0 };
      })()`, true);
      if (!observed || !observed.ok) {
        throw new Error(`compiled gallery event failed for ${viewId}: ${JSON.stringify(observed)}`);
      }
      const outputPath = path.join(outputDirectory, `${String(index).padStart(2, "0")}-${viewId}.png`);
      const sha256 = await captureFrame(runtime, frameId, outputPath);
      states.push({ view: viewId, file: path.basename(outputPath), meshCount: observed.meshCount, sha256 });
    }

    const slider = await evaluate(runtime, `(async () => {
      const input = document.getElementById("glass-alpha");
      if (!input) return { ok:false, reason:"slider missing" };
      input.value = "0.72";
      input.dispatchEvent(new Event("input", { bubbles:true }));
      await new Promise((resolve) => setTimeout(resolve, 240));
      return { ok:!window.__vfRetainedEventError, value:Number(input.value) };
    })()`, true);
    if (!slider || !slider.ok || slider.value !== 0.72) {
      throw new Error(`compiled gallery slider failed: ${JSON.stringify(slider)}`);
    }
    const sliderPath = path.join(outputDirectory, "04-glass-alpha-072.png");
    await captureFrame(runtime, frameId, sliderPath);
    states.push({ view: "glass-alpha-072", file: path.basename(sliderPath), value: slider.value });
    if (new Set(states.slice(0, 4).map((state) => state.sha256)).size < 3) {
      throw new Error("compiled gallery buttons did not produce distinct rendered views");
    }

    const screenshot = await sendCdp(runtime.pageWs, runtime.pageState, "Page.captureScreenshot", {
      format: "png",
      omitBackground: false,
      captureBeyondViewport: false,
      fromSurface: true,
    });
    fs.writeFileSync(path.join(outputDirectory, "material-ui-gallery.png"), Buffer.from(screenshot.data, "base64"));
    process.stdout.write(JSON.stringify({
      captureApi: "VfDisplay.__test.captureGeomFrameDataUrl",
      execution: "headless",
      frameId,
      states,
      still: "material-ui-gallery.png",
    }));
  } finally {
    await closeScene(runtime);
  }
}

main().catch((error) => {
  console.error(String(error && error.stack || error));
  process.exit(1);
});
