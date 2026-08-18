const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

function findFfmpegPath() {
  if (process.env.FFMPEG_PATH) {
    return process.env.FFMPEG_PATH;
  }
  try {
    return require("@ffmpeg-installer/ffmpeg").path;
  } catch (_) {
    return "";
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function polygonsOverlapStrict(readback, epsilon = 1e-6) {
  if (!readback || !Array.isArray(readback.bodies) || !Array.isArray(readback.triangles)) return null;
  const bodies = readback.bodies;
  const tris = readback.triangles;
  const transform = (body, x, y) => {
    const a = body[2];
    const c = Math.cos(a), s = Math.sin(a);
    return [body[0] + c * x - s * y, body[1] + s * x + c * y];
  };
  const axes = (poly) => poly.map((p, i) => {
    const q = poly[(i + 1) % poly.length];
    const dx = q[0] - p[0], dy = q[1] - p[1];
    const n = Math.hypot(dx, dy) || 1;
    return [-dy / n, dx / n];
  });
  const overlaps = (a, b) => {
    for (const axis of axes(a).concat(axes(b))) {
      let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
      for (const p of a) { const d = p[0] * axis[0] + p[1] * axis[1]; amin = Math.min(amin, d); amax = Math.max(amax, d); }
      for (const p of b) { const d = p[0] * axis[0] + p[1] * axis[1]; bmin = Math.min(bmin, d); bmax = Math.max(bmax, d); }
      if (Math.min(amax, bmax) - Math.max(amin, bmin) <= epsilon) return false;
    }
    return true;
  };
  const windingInside = (point, boundary) => {
    let winding = 0;
    for (const edge of boundary) {
      const ax = edge[0][0] - point[0], ay = edge[0][1] - point[1];
      const bx = edge[1][0] - point[0], by = edge[1][1] - point[1];
      const cross = ax * by - ay * bx;
      const dot = ax * bx + ay * by;
      winding += Math.atan2(cross, dot);
    }
    return Math.abs(winding) > Math.PI;
  };
  const count = tris.length / 8;
  const boundaries = new Map();
  for (let i = 0; i < count; i += 1) {
    const ti = i * 8, bi = Math.round(tris[ti + 6]), mask = Math.round(tris[ti + 7]);
    const body = bodies.slice(bi * 20, bi * 20 + 20);
    const tri = [transform(body, tris[ti], tris[ti + 1]), transform(body, tris[ti + 2], tris[ti + 3]), transform(body, tris[ti + 4], tris[ti + 5])];
    if (!boundaries.has(bi)) boundaries.set(bi, []);
    for (let e = 0; e < 3; e += 1) if ((mask & (1 << e)) !== 0) boundaries.get(bi).push([tri[e], tri[(e + 1) % 3]]);
  }
  for (let i = 0; i < count; i += 1) {
    const ti = i * 8, bi = Math.round(tris[ti + 6]);
    const pa = [transform(bodies.slice(bi * 20, bi * 20 + 20), tris[ti], tris[ti + 1]), transform(bodies.slice(bi * 20, bi * 20 + 20), tris[ti + 2], tris[ti + 3]), transform(bodies.slice(bi * 20, bi * 20 + 20), tris[ti + 4], tris[ti + 5])];
    for (let j = i + 1; j < count; j += 1) {
      const tj = j * 8, bj = Math.round(tris[tj + 6]);
      if (bi === bj) continue;
      const pb = [transform(bodies.slice(bj * 16, bj * 16 + 16), tris[tj], tris[tj + 1]), transform(bodies.slice(bj * 16, bj * 16 + 16), tris[tj + 2], tris[tj + 3]), transform(bodies.slice(bj * 16, bj * 16 + 16), tris[tj + 4], tris[tj + 5])];
      if (overlaps(pa, pb)) return { triangleA: i, triangleB: j, bodyA: bi, bodyB: bj };
      if (windingInside(pa[0], boundaries.get(bj) || []) || windingInside(pb[0], boundaries.get(bi) || [])) {
        return { containment: true, triangleA: i, triangleB: j, bodyA: bi, bodyB: bj };
      }
    }
  }
  return null;
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
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "vf-edge-gpu-video-"));
  const windowSize = process.env.VF_RECORD_WINDOW || "720,520";
  const args = [
    `--user-data-dir=${userDir}`,
    `--remote-debugging-port=${port}`,
    "--allow-file-access-from-files",
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan,UseSkiaRenderer",
    "--no-first-run",
    "--no-default-browser-check",
    "--autoplay-policy=no-user-gesture-required",
    `--window-size=${windowSize}`,
    sceneUrl,
  ];
  if (process.env.VF_RECORD_HEADLESS !== "0") {
    args.splice(5, 0, "--headless=new");
  }
  const edge = spawn(edgePath, args, { stdio: "ignore" });

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
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const readiness = await sendCdp(pageWs, pageState, "Runtime.evaluate", {
      expression: `(() => ({
        status: window.VfDisplay && window.VfDisplay.geomFrameStatus ? window.VfDisplay.geomFrameStatus(${JSON.stringify(frameId)}) : null,
        dynamicState: window.VfDisplay && window.VfDisplay.__test && window.VfDisplay.__test.debugDynamicGeomFrameState
          ? window.VfDisplay.__test.debugDynamicGeomFrameState(${JSON.stringify(frameId)})
          : null,
        error: window.__vfLastError || null,
        fatal: document.getElementById("vf-native-scene-fatal") ? document.getElementById("vf-native-scene-fatal").textContent : null,
        gpuRuntime: !!window.VfGpuRuntime,
        gpuScript: Array.from(document.scripts).filter((s) => /vf-gpu-runtime/.test(s.src)).map((s) => ({ src: s.src, ready: s.getAttribute("data-vf-runtime-ready") }))
      }))()`,
      returnByValue: true
    });
    lastReadiness = readiness.result.value || null;
    const renderer = lastReadiness && lastReadiness.dynamicState && lastReadiness.dynamicState.renderer;
    if (lastReadiness && lastReadiness.status && lastReadiness.status.runningRenderers > 0 && renderer && renderer.partCount > 0) {
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

async function runProcess(command, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${command} exited ${code}\n${stdout}\n${stderr}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function captureFrameSequenceVideo(runtime, frameId, outputPath, seconds, fps) {
  const ffmpegPath = findFfmpegPath();
  if (!ffmpegPath) {
    throw new Error("ffmpeg unavailable; set FFMPEG_PATH or install @ffmpeg-installer/ffmpeg");
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vf-gpu-video-frames-"));
  const framePaths = [];
  const frameTimes = [];
  const forcedFrameCount = Math.max(0, Number(process.env.VF_FRAME_SEQUENCE_COUNT || "0") | 0);
  const captureFixedDt = Math.max(0, Number(process.env.VF_CAPTURE_FIXED_DT || "0") || 0);
  const targetFrames = forcedFrameCount > 0 ? forcedFrameCount : Math.max(2, Math.ceil(seconds * Math.max(1, fps)));
  const frameDuration = 1 / Math.max(1, fps);
  const targetInterval = 1000 / Math.max(1, fps);
  const started = Date.now();
  let nextAt = started;
  let index = 0;
  while (index < targetFrames) {
    const wait = forcedFrameCount > 0 ? 0 : nextAt - Date.now();
    if (wait > 0) {
      await delay(wait);
    }
    const stateResult = await sendCdp(runtime.pageWs, runtime.pageState, "Runtime.evaluate", {
      expression: `(async () => {
        const frameId = ${JSON.stringify(frameId)};
        if (${JSON.stringify(captureFixedDt)} > 0) {
          window.__vfCaptureFixedPhysicsDt = ${JSON.stringify(captureFixedDt)};
        }
        const renderer = window.__vfFrameRenderers && window.__vfFrameRenderers[String(frameId)];
        if (${JSON.stringify(captureFixedDt)} > 0 && renderer && typeof renderer._renderContent === "function") {
          if (renderer.__vfDeterministicCaptureStopped !== true) {
            if (typeof renderer.stop === "function") {
              renderer.stop();
            }
            renderer.__vfDeterministicCaptureStopped = true;
            if (renderer._device && renderer._device.queue && typeof renderer._device.queue.onSubmittedWorkDone === "function") {
              await renderer._device.queue.onSubmittedWorkDone();
            }
          }
          window.__vfCapturePhysicsStepRequested = true;
          renderer._renderPending = false;
          renderer._renderContent(performance.now());
          if (renderer._device && renderer._device.queue && typeof renderer._device.queue.onSubmittedWorkDone === "function") {
            await renderer._device.queue.onSubmittedWorkDone();
          }
        } else if (${JSON.stringify(captureFixedDt)} > 0 && renderer && typeof renderer.requestFrame === "function") {
          window.__vfCapturePhysicsStepRequested = true;
          renderer.requestFrame();
          await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        } else if (window.VfDisplay && typeof window.VfDisplay.redrawVisibleGeomFrames === "function") {
          window.VfDisplay.redrawVisibleGeomFrames();
        }
        const state = window.VfDisplay.__test.debugDynamicGeomFrameState
          ? window.VfDisplay.__test.debugDynamicGeomFrameState(frameId)
          : null;
        const rigidRenderer = window.__vfFrameRenderers && window.__vfFrameRenderers[String(frameId)];
        const rigidBodies = rigidRenderer && typeof rigidRenderer._debugReadRigidPolygonBodies === "function"
          ? await rigidRenderer._debugReadRigidPolygonBodies()
          : null;
        return { ok: true, state, rigidBodies };
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    const stateValue = stateResult && stateResult.result ? stateResult.result.value : null;
    if (!stateValue || !stateValue.ok) {
      throw new Error(`frame redraw failed: ${JSON.stringify(stateValue)}`);
    }
    const overlap = polygonsOverlapStrict(stateValue.rigidBodies);
    if (overlap) {
      throw new Error(`strict non-overlap invariant failed at frame ${index}: ${JSON.stringify(overlap)}`);
    }
    const capture = await sendCdp(runtime.pageWs, runtime.pageState, "Runtime.evaluate", {
      expression: `(async () => {
        const api = window.VfDisplay && window.VfDisplay.__test;
        const fn = api && api.captureGeomFrameDataUrl;
        if (!fn) {
          return { ok: false, reason: "captureGeomFrameDataUrl unavailable" };
        }
        const dataUrl = await fn(${JSON.stringify(frameId)});
        return {
          ok: typeof dataUrl === "string" && dataUrl.startsWith("data:image/png;base64,"),
          dataUrl
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    const captureValue = capture && capture.result ? capture.result.value : null;
    if (!captureValue || !captureValue.ok || typeof captureValue.dataUrl !== "string") {
      throw new Error(`frame texture capture failed: ${JSON.stringify(captureValue)}`);
    }
    const comma = captureValue.dataUrl.indexOf(",");
    const file = path.join(tempDir, `frame_${String(index).padStart(5, "0")}.png`);
    fs.writeFileSync(file, Buffer.from(captureValue.dataUrl.slice(comma + 1), "base64"));
    framePaths.push(file);
    frameTimes.push(forcedFrameCount > 0 ? index * frameDuration : (Date.now() - started) / 1000);
    index += 1;
    nextAt += targetInterval;
    if (forcedFrameCount <= 0 && Date.now() - started >= seconds * 1000) {
      break;
    }
  }
  if (framePaths.length < 2) {
    throw new Error(`not enough captured frames: ${framePaths.length}`);
  }
  if (forcedFrameCount > 0) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    await runProcess(ffmpegPath, [
      "-y",
      "-framerate", String(Math.max(1, Math.round(fps))),
      "-i", path.join(tempDir, "frame_%05d.png"),
      "-frames:v", String(framePaths.length),
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-r", String(Math.max(1, Math.round(fps))),
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      outputPath
    ]);
    return {
      ok: true,
      mode: "frame_sequence_ffmpeg",
      frames: framePaths.length,
      seconds,
      bytes: fs.statSync(outputPath).size,
      tempDir
    };
  }
  const concatPath = path.join(tempDir, "frames.txt");
  const lines = [];
  for (let i = 0; i < framePaths.length - 1; i += 1) {
    const duration = Math.max(0.001, frameTimes[i + 1] - frameTimes[i]);
    lines.push(`file '${framePaths[i].replace(/\\/g, "/").replace(/'/g, "'\\''")}'`);
    lines.push(`duration ${duration.toFixed(6)}`);
  }
  lines.push(`file '${framePaths[framePaths.length - 1].replace(/\\/g, "/").replace(/'/g, "'\\''")}'`);
  lines.push(`duration ${Math.max(0.001, forcedFrameCount > 0 ? frameDuration : seconds - frameTimes[frameTimes.length - 1]).toFixed(6)}`);
  lines.push(`file '${framePaths[framePaths.length - 1].replace(/\\/g, "/").replace(/'/g, "'\\''")}'`);
  fs.writeFileSync(concatPath, lines.join("\n") + "\n", "utf8");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await runProcess(ffmpegPath, [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", concatPath,
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-r", String(Math.max(1, Math.round(fps))),
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputPath
  ]);
  return {
    ok: true,
    mode: "frame_sequence_ffmpeg",
    frames: framePaths.length,
    seconds,
    bytes: fs.statSync(outputPath).size,
    tempDir
  };
}

async function main() {
  const scenePath = process.argv[2];
  const outputPath = process.argv[3];
  const frameId = process.argv[4] || "physics_hard_sphere_gpu_frame";
  const seconds = Math.max(0.25, Number(process.argv[5] || "10") || 10);
  const port = Number(process.argv[6] || "9231") || 9231;
  if (!scenePath || !outputPath) {
    throw new Error("usage: node record_gpu_scene_video.js <scenePath> <outputPath.webm> [frameId] [seconds] [port]");
  }

  const runtime = await openScene(scenePath, port, frameId);
  try {
    await delay(1000);
    if (process.env.VF_FORCE_FRAME_SEQUENCE === "1") {
      const fallbackFps = Math.max(1, Number(process.env.VF_FRAME_SEQUENCE_FPS || "30") || 30);
      const mp4Path = outputPath.replace(/\.[^.]+$/, ".mp4");
      const fallback = await captureFrameSequenceVideo(runtime, frameId, mp4Path, seconds, fallbackFps);
      process.stdout.write(JSON.stringify({ forcedFrameSequence: true, fallback }, null, 2));
      return;
    }
    const result = await sendCdp(runtime.pageWs, runtime.pageState, "Runtime.evaluate", {
      expression: `(async () => {
        const frameId = ${JSON.stringify(frameId)};
        const canvas = document.querySelector('.vf-frame[data-vf-frame-id=' + JSON.stringify(frameId) + '] canvas.vf-geom-canvas');
        if (!canvas) {
          return { ok: false, reason: "canvas missing" };
        }
        const dynamicState = window.VfDisplay && window.VfDisplay.__test && window.VfDisplay.__test.debugDynamicGeomFrameState
          ? window.VfDisplay.__test.debugDynamicGeomFrameState(frameId)
          : null;
        const samplePixels = async () => {
          const api = window.VfDisplay && window.VfDisplay.__test;
          const fn = api && api.captureGeomFrameDataUrl;
          if (!fn) {
            return { pixels: 0, coloredRatio: 0, brightRatio: 0, whiteRatio: 0, meanLuma: 0, reason: "captureGeomFrameDataUrl unavailable" };
          }
          const dataUrl = await fn(frameId);
          if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,")) {
            return { pixels: 0, coloredRatio: 0, brightRatio: 0, whiteRatio: 0, meanLuma: 0, reason: "frame texture data url unavailable" };
          }
          const img = new Image();
          img.decoding = "sync";
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = dataUrl;
          });
          const sample = document.createElement("canvas");
          sample.width = Math.min(240, Math.max(1, img.naturalWidth || img.width));
          sample.height = Math.min(160, Math.max(1, img.naturalHeight || img.height));
          const ctx = sample.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, sample.width, sample.height);
          const data = ctx.getImageData(0, 0, sample.width, sample.height).data;
          let colored = 0;
          let bright = 0;
          let whiteish = 0;
          let totalLuma = 0;
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i] / 255;
            const g = data[i + 1] / 255;
            const b = data[i + 2] / 255;
            const luma = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
            totalLuma += luma;
            if (Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b)) > 0.08 && luma > 0.08) {
              colored += 1;
            }
            if (luma > 0.18) {
              bright += 1;
            }
            if (r > 0.95 && g > 0.95 && b > 0.95) {
              whiteish += 1;
            }
          }
          const pixels = data.length / 4;
          return {
            pixels,
            coloredRatio: colored / Math.max(1, pixels),
            brightRatio: bright / Math.max(1, pixels),
            whiteRatio: whiteish / Math.max(1, pixels),
            meanLuma: totalLuma / Math.max(1, pixels)
          };
        };
        let initialPixelStats = null;
        for (let warmup = 0; warmup < 8; warmup += 1) {
          if (window.VfDisplay && typeof window.VfDisplay.redrawVisibleGeomFrames === "function") {
            window.VfDisplay.redrawVisibleGeomFrames();
          }
          await new Promise((resolve) => setTimeout(resolve, 1000 / 60));
          initialPixelStats = await samplePixels();
          if (initialPixelStats.coloredRatio > 0.001 || initialPixelStats.brightRatio > 0.01) {
            break;
          }
        }
        if (!initialPixelStats || initialPixelStats.whiteRatio > 0.90 || (initialPixelStats.coloredRatio <= 0.0005 && initialPixelStats.brightRatio <= 0.005)) {
          return { ok: false, reason: "blank_or_white_canvas", pixelStats: initialPixelStats, dynamicState };
        }
        const runtimeProof = dynamicState && dynamicState.renderer && Array.isArray(dynamicState.renderer.partDetails)
          ? dynamicState.renderer.partDetails
          : [];
        const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
          ? "video/webm;codecs=vp9"
          : "video/webm";
        const captureFps = Math.max(0, Number(${JSON.stringify(process.env.VF_CAPTURE_STREAM_FPS || "0")}) || 0);
        const stream = canvas.captureStream(captureFps > 0 ? captureFps : 0);
        const videoTrack = stream.getVideoTracks()[0] || null;
        const chunks = [];
        const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8000000 });
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            chunks.push(event.data);
          }
        };
        const stopped = new Promise((resolve) => {
          recorder.onstop = resolve;
        });
        recorder.start(250);
        const start = performance.now();
        let frames = 0;
        while (performance.now() - start < ${seconds * 1000}) {
          if (window.VfDisplay && typeof window.VfDisplay.redrawVisibleGeomFrames === "function") {
            window.VfDisplay.redrawVisibleGeomFrames();
          }
          if (videoTrack && typeof videoTrack.requestFrame === "function") {
            videoTrack.requestFrame();
          }
          frames += 1;
          await new Promise((resolve) => setTimeout(resolve, 1000 / 60));
        }
        if (videoTrack && typeof videoTrack.requestFrame === "function") {
          videoTrack.requestFrame();
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
        recorder.stop();
        await stopped;
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks, { type: mime });
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(reader.error || new Error("video read failed"));
          reader.readAsDataURL(blob);
        });
        return {
          ok: dataUrl.startsWith("data:video/webm"),
          mime,
          bytes: blob.size,
          frames,
          width: canvas.width,
          height: canvas.height,
          pixelStats: initialPixelStats,
          dynamicState,
          runtimeProof,
          dataUrl
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    const payload = result && result.result ? result.result.value : null;
    if (!payload || !payload.ok || typeof payload.dataUrl !== "string") {
      throw new Error(`record failed: ${JSON.stringify(payload)}`);
    }
    const prefix = "data:video/webm";
    const comma = payload.dataUrl.indexOf(",");
    if (!payload.dataUrl.startsWith(prefix) || comma < 0) {
      throw new Error("record returned non-webm data");
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    if (payload.bytes > 0) {
      fs.writeFileSync(outputPath, Buffer.from(payload.dataUrl.slice(comma + 1), "base64"));
      delete payload.dataUrl;
      process.stdout.write(JSON.stringify(payload, null, 2));
    } else {
      delete payload.dataUrl;
      const mp4Path = outputPath.replace(/\.[^.]+$/, ".mp4");
      const fallbackFps = Math.max(1, Number(process.env.VF_FRAME_SEQUENCE_FPS || "5") || 5);
      const fallback = await captureFrameSequenceVideo(runtime, frameId, mp4Path, seconds, fallbackFps);
      process.stdout.write(JSON.stringify({ mediaRecorder: payload, fallback }, null, 2));
    }
  } finally {
    await closeScene(runtime.browserWs, runtime.browserState, runtime.edge);
  }
}

main().catch((error) => {
  console.error(String(error && error.stack || error));
  process.exit(1);
});
