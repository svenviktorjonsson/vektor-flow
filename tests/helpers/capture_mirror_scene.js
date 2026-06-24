const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const response = await fetch(url);
  return await response.json();
}

async function connectWs(url) {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = (event) => reject(event);
  });
}

async function sendCdp(ws, state, method, params) {
  return await new Promise((resolve, reject) => {
    const id = ++state.nextId;
    state.pending.set(id, (message) => {
      if (message.error) {
        reject(new Error(JSON.stringify(message.error)));
        return;
      }
      resolve(message.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function openScene(scenePath, port, frameId) {
  const edgePath = process.env.VF_EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  if (!fs.existsSync(edgePath)) {
    throw new Error(`edge missing at ${edgePath}`);
  }
  const sceneUrl = "file:///" + path.resolve(scenePath).replace(/\\/g, "/");
  const sceneUrlPrefix = sceneUrl.replace(/ /g, "%20");
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "vf-edge-"));
  const edge = spawn(edgePath, [
    `--user-data-dir=${userDir}`,
    `--remote-debugging-port=${port}`,
    "--allow-file-access-from-files",
    "--enable-unsafe-webgpu",
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1400,1000",
    sceneUrl,
  ], {
    stdio: "ignore",
  });

  let version = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      version = await fetchJson(`http://127.0.0.1:${port}/json/version`);
      break;
    } catch (_) {
      await delay(250);
    }
  }
  if (!version) {
    throw new Error("cdp not ready");
  }

  let pageTarget = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    pageTarget = targets.find((target) => String(target.url || "").startsWith(sceneUrlPrefix));
    if (pageTarget) {
      break;
    }
    await delay(250);
  }
  if (!pageTarget) {
    throw new Error("file target missing");
  }

  const pageWs = await connectWs(pageTarget.webSocketDebuggerUrl);
  const browserWs = await connectWs(version.webSocketDebuggerUrl);
  const pageState = { nextId: 0, pending: new Map() };
  const browserState = { nextId: 0, pending: new Map() };

  pageWs.onmessage = (event) => {
    const message = JSON.parse(event.data.toString());
    if (message.id && pageState.pending.has(message.id)) {
      pageState.pending.get(message.id)(message);
      pageState.pending.delete(message.id);
    }
  };
  browserWs.onmessage = (event) => {
    const message = JSON.parse(event.data.toString());
    if (message.id && browserState.pending.has(message.id)) {
      browserState.pending.get(message.id)(message);
      browserState.pending.delete(message.id);
    }
  };

  await sendCdp(pageWs, pageState, "Page.enable");
  await sendCdp(pageWs, pageState, "Runtime.enable");

  let lastReadiness = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const readiness = await sendCdp(pageWs, pageState, "Runtime.evaluate", {
      expression: `(() => ({
        status: window.VfDisplay && window.VfDisplay.geomFrameStatus ? window.VfDisplay.geomFrameStatus(${JSON.stringify(frameId)}) : null,
        error: window.__vfLastError || null,
        fatal: document.getElementById("vf-native-scene-fatal") ? document.getElementById("vf-native-scene-fatal").textContent : null
      }))()`,
      returnByValue: true
    });
    lastReadiness = readiness.result.value || null;
    if (lastReadiness && lastReadiness.status && lastReadiness.status.runningRenderers > 0) {
      return { edge, pageWs, pageState, browserWs, browserState };
    }
    if (lastReadiness && (lastReadiness.error || lastReadiness.fatal)) {
      throw new Error(`renderer failed before ready: ${JSON.stringify(lastReadiness)}`);
    }
    await delay(250);
  }
  throw new Error(`renderer never became ready: ${JSON.stringify(lastReadiness)}`);
}

async function closeScene(browserWs, browserState, edge) {
  try {
    await sendCdp(browserWs, browserState, "Browser.close");
  } catch (_) {}
  await delay(500);
  try {
    edge.kill();
  } catch (_) {}
}

async function main() {
  const scenePath = process.argv[2];
  const screenshotPath = process.argv[3];
  const zoomSteps = Number(process.argv[4] || "0") || 0;
  const port = Number(process.argv[5] || "9229") || 9229;
  const frameId = process.argv[6] || "random_hull_color_orbit_frame";
  if (!scenePath || !screenshotPath) {
    throw new Error("usage: node capture_mirror_scene.js <scenePath> <screenshotPath> [zoomSteps] [port] [frameId]");
  }
  const runtime = await openScene(scenePath, port, frameId);
  try {
    await delay(1500);
    await sendCdp(runtime.pageWs, runtime.pageState, "Runtime.evaluate", {
      expression: `(() => {
        if (window.VfDisplay && typeof window.VfDisplay.redrawVisibleGeomFrames === "function") {
          window.VfDisplay.redrawVisibleGeomFrames();
          return true;
        }
        return false;
      })()`,
      returnByValue: true
    });
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const ready = await sendCdp(runtime.pageWs, runtime.pageState, "Runtime.evaluate", {
        expression: `(() => {
          const captureState = window.VfDisplay && window.VfDisplay.__test && window.VfDisplay.__test.debugGeomFrameCaptureState
            ? window.VfDisplay.__test.debugGeomFrameCaptureState(${JSON.stringify(frameId)})
            : [];
          const dynamicState = window.VfDisplay && window.VfDisplay.__test && window.VfDisplay.__test.debugDynamicGeomFrameState
            ? window.VfDisplay.__test.debugDynamicGeomFrameState(${JSON.stringify(frameId)})
            : null;
          const renderer = dynamicState && dynamicState.renderer || null;
          const firstCapture = Array.isArray(captureState) && captureState.length ? captureState[0] : null;
          return {
            captureState,
            dynamicState,
            ready: !!(
              renderer &&
              renderer.partCount > 0 &&
              renderer.renderPending !== true &&
              firstCapture &&
              firstCapture.hasFrameTextureRef &&
              firstCapture.frameWidth > 0 &&
              firstCapture.frameHeight > 0
            )
          };
        })()`,
        returnByValue: true
      });
      const value = ready && ready.result ? ready.result.value : null;
      if (value && value.ready) {
        break;
      }
      if (attempt === 79) {
        throw new Error(`renderer frame texture never became ready: ${JSON.stringify(value)}`);
      }
      if (attempt % 4 === 0) {
        await sendCdp(runtime.pageWs, runtime.pageState, "Runtime.evaluate", {
          expression: `(() => {
            if (window.VfDisplay && typeof window.VfDisplay.redrawVisibleGeomFrames === "function") {
              return window.VfDisplay.redrawVisibleGeomFrames();
            }
            return false;
          })()`,
          returnByValue: true
        });
      }
      await delay(250);
    }
    if (zoomSteps !== 0) {
      const deltaY = zoomSteps > 0 ? 100 : -100;
      const count = Math.abs(zoomSteps);
      await sendCdp(runtime.pageWs, runtime.pageState, "Runtime.evaluate", {
        expression: `(() => {
          const body = document.querySelector('.vf-frame[data-vf-frame-id=${JSON.stringify(frameId)}] .vf-frame__body');
          if (!body) return "no-body";
          for (let i = 0; i < ${count}; i += 1) {
            body.dispatchEvent(new WheelEvent("wheel", { deltaY: ${deltaY}, bubbles: true, cancelable: true }));
          }
          return "ok";
        })()`,
        returnByValue: true
      });
      await delay(2000);
    }
    const framePng = await sendCdp(runtime.pageWs, runtime.pageState, "Runtime.evaluate", {
      expression: `(async () => {
        const api = !!(window.VfDisplay && window.VfDisplay.__test);
        const fn = !!(api && window.VfDisplay.__test.captureGeomFrameDataUrl);
        if (!fn) {
          return { ok: false, api, fn, reason: "captureGeomFrameDataUrl unavailable" };
        }
        try {
          const dataUrl = await window.VfDisplay.__test.captureGeomFrameDataUrl(${JSON.stringify(frameId)});
          return {
            ok: typeof dataUrl === "string" && dataUrl.startsWith("data:image/png;base64,"),
            api,
            fn,
            type: typeof dataUrl,
            length: typeof dataUrl === "string" ? dataUrl.length : 0,
            value: dataUrl
          };
        } catch (error) {
          return {
            ok: false,
            api,
            fn,
            reason: String(error && error.stack || error)
          };
        }
      })()`,
      returnByValue: true,
      awaitPromise: true
    });
    const captureDebug = framePng && framePng.result ? framePng.result.value : null;
    const frameDataUrl = captureDebug && typeof captureDebug.value === "string" ? captureDebug.value : null;
    if (!captureDebug || !captureDebug.ok || typeof frameDataUrl !== "string" || !frameDataUrl.startsWith("data:image/png;base64,")) {
      throw new Error(`frame capture failed: ${JSON.stringify(captureDebug)}`);
    }
    const captureMode = "frame";
    fs.writeFileSync(screenshotPath, Buffer.from(frameDataUrl.slice("data:image/png;base64,".length), "base64"));
    const status = await sendCdp(runtime.pageWs, runtime.pageState, "Runtime.evaluate", {
      expression: `({
        status: window.VfDisplay && window.VfDisplay.geomFrameStatus ? window.VfDisplay.geomFrameStatus(${JSON.stringify(frameId)}) : null,
        captureState: window.VfDisplay && window.VfDisplay.__test && window.VfDisplay.__test.debugGeomFrameCaptureState
          ? window.VfDisplay.__test.debugGeomFrameCaptureState(${JSON.stringify(frameId)})
          : null,
        dynamicState: window.VfDisplay && window.VfDisplay.__test && window.VfDisplay.__test.debugDynamicGeomFrameState
          ? window.VfDisplay.__test.debugDynamicGeomFrameState(${JSON.stringify(frameId)})
          : null,
        logs: (window.__vfGeomWgpuLog || []).slice(-24),
        canvasRect: (() => {
          const canvas = document.querySelector('.vf-frame[data-vf-frame-id=${JSON.stringify(frameId)}] canvas.vf-geom-canvas');
          if (!canvas) return null;
          const rect = canvas.getBoundingClientRect();
          return {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            clientWidth: canvas.clientWidth,
            clientHeight: canvas.clientHeight,
            pixelWidth: canvas.width,
            pixelHeight: canvas.height,
          };
        })()
      })`,
      returnByValue: true
    });
    const surfaceDebug = await sendCdp(runtime.pageWs, runtime.pageState, "Runtime.evaluate", {
      expression: `(async () => {
        if (!window.VfDisplay || !window.VfDisplay.__test || !window.VfDisplay.__test.analyzeSurfaceTextures) {
          return null;
        }
        return {
          threshold32: await window.VfDisplay.__test.analyzeSurfaceTextures(${JSON.stringify(frameId)}, 32),
          threshold50: await window.VfDisplay.__test.analyzeSurfaceTextures(${JSON.stringify(frameId)}, 50),
          threshold70: await window.VfDisplay.__test.analyzeSurfaceTextures(${JSON.stringify(frameId)}, 70),
          threshold90: await window.VfDisplay.__test.analyzeSurfaceTextures(${JSON.stringify(frameId)}, 90),
        };
      })()`,
      returnByValue: true,
      awaitPromise: true
    });
    const payload = status.result.value || {};
    payload.captureMode = captureMode;
    payload.captureDebug = captureDebug;
    payload.surfaceDebug = surfaceDebug.result ? surfaceDebug.result.value : null;
    process.stdout.write(JSON.stringify(payload));
  } finally {
    await closeScene(runtime.browserWs, runtime.browserState, runtime.edge);
  }
}

main().catch((error) => {
  console.error(String(error && error.stack || error));
  process.exit(1);
});
