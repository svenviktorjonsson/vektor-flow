import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";

export const SCHEMA = "vektor-flow/rabbit-startup-benchmark-v1";
export const BUDGET_MS = 500;
export const FRAME_ID = "material_gallery_frame";
export const REQUIRED_MIRROR_MESHES = Object.freeze(["studio_floor", "upright_mirror"]);

const DEFAULT_EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

function sleep(ms) {
  return new Promise((accept) => setTimeout(accept, ms));
}

async function freePort() {
  return await new Promise((accept, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : accept(port));
    });
  });
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return await response.json();
}

async function waitForJson(url, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  let lastError = null;
  while (performance.now() < deadline) {
    try {
      return await fetchJson(url);
    } catch (error) {
      lastError = error;
      await sleep(10);
    }
  }
  throw new Error(`timed out waiting for ${url}: ${lastError || "no response"}`);
}

async function connectWs(url) {
  return await new Promise((accept, reject) => {
    const socket = new WebSocket(url);
    socket.onopen = () => accept(socket);
    socket.onerror = reject;
  });
}

function attachReceiver(socket) {
  const state = { id: 0, pending: new Map() };
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data.toString());
    const pending = message.id && state.pending.get(message.id);
    if (!pending) return;
    state.pending.delete(message.id);
    if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
    else pending.accept(message.result);
  };
  return state;
}

async function cdp(socket, state, method, params = {}) {
  return await new Promise((accept, reject) => {
    const id = ++state.id;
    state.pending.set(id, { accept, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(runtime, expression, awaitPromise = false) {
  const result = await cdp(runtime.pageSocket, runtime.pageState, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
  }
  return result.result ? result.result.value : undefined;
}

export function edgeArgs({ profile, port, sceneUrl, gpuMode = "hardware" }) {
  if (!profile || !Number.isInteger(port) || !sceneUrl) {
    throw new TypeError("profile, integer port and sceneUrl are required");
  }
  if (gpuMode !== "hardware" && gpuMode !== "swiftshader") {
    throw new RangeError(`GPU mode must be hardware or swiftshader, got ${gpuMode}`);
  }
  const args = [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    "--headless=new",
    "--window-size=1400,1000",
    "--allow-file-access-from-files",
    "--enable-unsafe-webgpu",
    "--enable-features=UseSkiaRenderer",
    "--ignore-gpu-blocklist",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-background-mode",
    "--no-service-autorun",
    "--disable-breakpad",
    "--disable-crash-reporter",
    "--edge-skip-compat-layer-relaunch",
    "--no-first-run",
    "--no-default-browser-check",
  ];
  if (gpuMode === "swiftshader") args.push("--use-angle=swiftshader");
  args.push(sceneUrl);
  return args;
}

export function probeExpression(frameId) {
  return `(() => {
    const timeline = Array.isArray(window.__vfStartupTimeline)
      ? window.__vfStartupTimeline.map((item) => ({
          name: String(item && item.name || ""),
          t: Number(item && item.t),
          detail: item && item.detail || null
        }))
      : [];
    const resources = performance.getEntriesByType("resource").map((entry) => ({
      name: String(entry.name || ""),
      initiatorType: String(entry.initiatorType || ""),
      startTime: Number(entry.startTime || 0),
      responseEnd: Number(entry.responseEnd || 0),
      duration: Number(entry.duration || 0),
      transferSize: Number(entry.transferSize || 0),
      decodedBodySize: Number(entry.decodedBodySize || 0)
    }));
    const nav = performance.getEntriesByType("navigation")[0];
    const config = window.__vfRuntimeShellConfig || {};
    const compiledArtifactUrls = [
      config.compiledWasmUrl,
      config.compiledWasmManifestUrl,
      config.compiledWgslUrl,
      config.compiledWebGpuManifestUrl
    ].filter(Boolean).map(String);
    const compiledMode = compiledArtifactUrls.length === 4;
    const compiledRuntime = window.__vfCompiledRuntime || null;
    const compiledArtifacts = window.__vfCompiledArtifacts || null;
    const compiledPasses = compiledRuntime && Array.isArray(compiledRuntime.passes)
      ? compiledRuntime.passes : [];
    const compiledDrawLists = compiledRuntime && compiledRuntime.parameterDescriptor &&
      Array.isArray(compiledRuntime.parameterDescriptor.draw_lists)
      ? compiledRuntime.parameterDescriptor.draw_lists : [];
    const adapterBundleManifest = window.__vfRuntimeAdapterBundleManifest;
    const nativeConfig = window.__vfNativeSceneConfig &&
      (window.__vfNativeSceneConfig.scene_ir || window.__vfNativeSceneConfig);
    const nativeMeshes = nativeConfig && Array.isArray(nativeConfig.meshes) ? nativeConfig.meshes : [];
    const bunny = nativeMeshes.find((mesh) => String(mesh && mesh.id || "") === "stanford_bunny");
    const bunnyProperties = bunny && bunny.properties || {};
    const renderer = window.__vfFrameRenderers && window.__vfFrameRenderers[${JSON.stringify(frameId)}];
    const parts = renderer && Array.isArray(renderer._parts) ? renderer._parts.map((part) => {
      const mesh = part && part.mesh || {};
      const surface = mesh.surface_system && typeof mesh.surface_system === "object"
        ? mesh.surface_system : null;
      return {
        id: String(mesh.id || mesh.mesh_id || ""),
        surfaceKind: String(surface && surface.kind || ""),
        surfaceTextureReady: mesh._surfaceTextureReady === true,
        runtimeTextureReady: surface ? surface._runtime_texture_ready === true : false,
        projectiveTexture: surface ? surface._projective_texture === true : false,
        surfaceWidth: Number(part && part.surfaceW || 0),
        surfaceHeight: Number(part && part.surfaceH || 0),
        hasSurfaceColorTexture: !!(part && part.surfaceColorTex)
      };
    }) : [];
    const dynamic = window.VfDisplay && window.VfDisplay.__test &&
      typeof window.VfDisplay.__test.debugDynamicGeomFrameState === "function"
      ? window.VfDisplay.__test.debugDynamicGeomFrameState(${JSON.stringify(frameId)}) : null;
    const root = document.documentElement;
    return {
      timeOrigin: Number(performance.timeOrigin),
      now: Number(performance.now()),
      navigation: nav ? {
        startTime: Number(nav.startTime || 0),
        responseEnd: Number(nav.responseEnd || 0),
        domInteractive: Number(nav.domInteractive || 0),
        domContentLoadedEventEnd: Number(nav.domContentLoadedEventEnd || 0),
        loadEventEnd: Number(nav.loadEventEnd || 0)
      } : null,
      timeline,
      resources,
      dependencies: {
        scripts: Array.isArray(config.compiledScriptDeps)
          ? config.compiledScriptDeps.slice()
          : (Array.isArray(config.sceneScriptDeps) ? config.sceneScriptDeps.slice() : []),
        styles: Array.isArray(config.compiledStyleDeps)
          ? config.compiledStyleDeps.map((item) => String(item && item.href || item || ""))
          : (compiledMode ? ["vf-frame.css"] : (Array.isArray(config.sceneStyleDeps)
            ? config.sceneStyleDeps.map((item) => String(item && item.href || item || "")) : [])),
        artifacts: compiledArtifactUrls,
        adapterBundle: String(config.sceneAdapterBundle || ""),
        adapterBundleManifest: adapterBundleManifest && typeof adapterBundleManifest === "object" ? {
          schema: String(adapterBundleManifest.schema || ""),
          inventorySha256: String(adapterBundleManifest.inventorySha256 || ""),
          sources: Array.isArray(adapterBundleManifest.sources)
            ? adapterBundleManifest.sources.map((item) => ({
                path: String(item && item.path || ""),
                sha256: String(item && item.sha256 || "")
              }))
            : []
        } : null,
        domUrls: [
          ...Array.from(document.querySelectorAll("script[src]"), (node) => String(node.src || "")),
          ...Array.from(document.querySelectorAll('link[rel="stylesheet"][href]'), (node) => String(node.href || ""))
        ]
      },
      arenaUrl: String(window.__vfNativeSceneArenaUrl || ""),
      arenaHydrated: ArrayBuffer.isView(bunnyProperties.vertices) &&
        ArrayBuffer.isView(bunnyProperties.indices) &&
        Number(bunnyProperties.vertices.length || 0) === 359470 &&
        Number(bunnyProperties.indices.length || 0) === 208353,
      compiledRuntime: compiledRuntime ? {
        presented: compiledRuntime.presented === true,
        artifactsReady: !!(compiledArtifacts && compiledArtifacts.wasm &&
          compiledArtifacts.arena && compiledArtifacts.arena.bytes &&
          compiledArtifacts.parameters && compiledArtifacts.parameters.bytes &&
          compiledArtifacts.render && compiledArtifacts.render.wgsl &&
          compiledArtifacts.render.manifest),
        arenaBytes: Number(compiledRuntime.arenaBytes && compiledRuntime.arenaBytes.byteLength || 0),
        parameterBytes: Number(compiledRuntime.parameterBytes && compiledRuntime.parameterBytes.byteLength || 0),
        drawListIds: compiledDrawLists.map((list) => String(list && list.id || "")),
        reflectionPasses: compiledPasses.filter((pass) =>
          String(pass && pass.kind || "") === "planar_reflection"
        ).map((pass) => ({
          surfaceId: String(pass && pass.surface_id || ""),
          reflectionDepth: Number(pass && pass.reflection_depth || 0),
          drawListId: String(pass && pass.draw_list_id || "")
        }))
      } : null,
      startup: window.VfStartupGate && typeof window.VfStartupGate.snapshot === "function"
        ? window.VfStartupGate.snapshot() : null,
      readyAttribute: root && root.getAttribute("data-vf-startup-ready"),
      pendingAttribute: root && root.getAttribute("data-vf-startup-pending"),
      startupError: root && root.getAttribute("data-vf-startup-error"),
      loadError: window.__vfStaticHtmlLoadError ? String(window.__vfStaticHtmlLoadError) : "",
      lastError: window.__vfLastError ? String(window.__vfLastError) : "",
      titleVisible: Array.from(document.querySelectorAll(".vf-frame__title"))
        .some((node) => /Stanford Bunny/u.test(node.textContent || "") &&
          node.getBoundingClientRect().width > 0),
      canvasVisible: (() => {
        const canvas = document.querySelector("canvas[data-vf-compiled-scene]") ||
          document.querySelector("canvas.vf-geom-canvas");
        if (!canvas) return false;
        const rect = canvas.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })(),
      dynamic,
      renderer: renderer ? {
        presentedFirstFrame: renderer._presentedFirstFrame === true,
        running: renderer._running === true,
        surfacePassCount: Number(renderer._lastSurfacePassCount || 0),
        evidence: typeof renderer._debugRenderEvidence === "function"
          ? renderer._debugRenderEvidence() : null,
        parts
      } : null
    };
  })()`;
}

export function probeReady(probe) {
  if (!probe || probe.readyAttribute !== "1" || probe.startup?.revealed !== true) {
    return false;
  }
  return probe.compiledRuntime
    ? probe.compiledRuntime.presented === true
    : probe.renderer?.presentedFirstFrame === true;
}

function lastMark(timeline, name) {
  const marks = timeline.filter((item) => item.name === name && Number.isFinite(item.t));
  return marks.length ? marks.at(-1).t : null;
}

function firstMark(timeline, name) {
  const mark = timeline.find((item) => item.name === name && Number.isFinite(item.t));
  return mark ? mark.t : null;
}

export function dependencyClosure(probe) {
  const resources = probe.resources || [];
  const domUrls = probe.dependencies?.domUrls || [];
  const compiled = probe.compiledRuntime || null;
  const dependencyWanted = [
    ...(probe.dependencies?.scripts || []),
    ...(probe.dependencies?.styles || []),
  ]
    .filter(Boolean);
  const artifactWanted = compiled
    ? [...(probe.dependencies?.artifacts || [])].filter(Boolean)
    : [];
  const wanted = [...dependencyWanted, ...artifactWanted];
  const normalizedSuffix = (dependency) => `/${String(dependency).replaceAll("\\", "/")}`;
  const resourceMatch = (dependency) => resources.find((entry) => {
    try {
      return decodeURIComponent(new URL(entry.name).pathname).replaceAll("\\", "/")
        .endsWith(normalizedSuffix(dependency));
    } catch (_) {
      return entry.name.replaceAll("\\", "/").endsWith(normalizedSuffix(dependency));
    }
  });
  const domMatch = (dependency) => domUrls.find((url) => {
    try { return decodeURIComponent(new URL(url).pathname).replaceAll("\\", "/").endsWith(normalizedSuffix(dependency)); }
    catch (_) { return String(url).replaceAll("\\", "/").endsWith(normalizedSuffix(dependency)); }
  });
  const bundleDependency = String(probe.dependencies?.adapterBundle || "");
  const bundleResource = bundleDependency ? resourceMatch(bundleDependency) : null;
  const bundleDomUrl = bundleDependency ? domMatch(bundleDependency) : null;
  const bundleManifest = probe.dependencies?.adapterBundleManifest;
  const manifestSources = Array.isArray(bundleManifest?.sources) ? bundleManifest.sources : [];
  const manifestInventory = manifestSources.map((item) =>
    `${String(item?.path || "")}:${String(item?.sha256 || "")}\n`).join("");
  const manifestDigest = createHash("sha256").update(manifestInventory, "utf8").digest("hex");
  const manifestSourcePaths = new Set(manifestSources.map((item) => String(item?.path || "")));
  const bundleVerified = !!bundleDependency && (!!bundleResource || !!bundleDomUrl) &&
    bundleManifest?.schema === "vektor-flow/runtime-adapter-bundle-v1" &&
    /^[0-9a-f]{64}$/u.test(String(bundleManifest?.inventorySha256 || "")) &&
    manifestDigest === bundleManifest.inventorySha256 &&
    manifestSources.length > 0 && manifestSources.every((item) =>
      !!item.path && /^[0-9a-f]{64}$/u.test(String(item.sha256 || "")));
  const bundleContains = (dependency) => bundleVerified && manifestSourcePaths.has(String(dependency));
  const missing = wanted.filter((dependency) => {
    if (compiled?.artifactsReady === true && artifactWanted.includes(dependency)) {
      return false;
    }
    return !resourceMatch(dependency) && !domMatch(dependency) && !bundleContains(dependency);
  });
  const loaded = wanted.map((dependency) => ({
    dependency,
    source: resourceMatch(dependency) ? "resource-timing"
      : (domMatch(dependency) ? "loaded-dom-element"
        : (bundleContains(dependency) ? "verified-adapter-bundle"
          : (compiled?.artifactsReady === true && artifactWanted.includes(dependency)
            ? "compiled-runtime" : null))),
    responseEndMs: resourceMatch(dependency)?.responseEnd ??
      (bundleContains(dependency) ? bundleResource?.responseEnd ?? null : null),
  }));
  const arena = resources.find((entry) => probe.arenaUrl &&
    entry.name.replaceAll("\\", "/").endsWith(`/${probe.arenaUrl.replaceAll("\\", "/")}`));
  const wasm = resources.filter((entry) => /\.wasm(?:$|[?#])/iu.test(entry.name));
  const parts = probe.renderer?.parts || [];
  const mirrors = REQUIRED_MIRROR_MESHES.map((meshId) => {
    const part = parts.find((candidate) => candidate.id === meshId);
    return {
      meshId,
      present: !!part,
      surfaceTextureReady: part?.surfaceTextureReady === true,
      runtimeTextureReady: part?.runtimeTextureReady === true,
      projectiveTexture: part?.projectiveTexture === true,
      dimensions: part ? [part.surfaceWidth, part.surfaceHeight] : [0, 0],
      hasSurfaceColorTexture: part?.hasSurfaceColorTexture === true,
    };
  });
  const mirrorComplete = mirrors.every((item) => item.present && item.surfaceTextureReady &&
    item.runtimeTextureReady && item.projectiveTexture && item.hasSurfaceColorTexture &&
    item.dimensions[0] > 0 && item.dimensions[1] > 0);
  const compiledArtifactEntries = artifactWanted.map((artifact) => ({
    artifact,
    fetched: !!resourceMatch(artifact) || compiled?.artifactsReady === true,
    source: resourceMatch(artifact) ? "resource-timing"
      : (compiled?.artifactsReady === true ? "compiled-runtime" : null),
    responseEndMs: resourceMatch(artifact)?.responseEnd ?? null,
    decodedBodySize: resourceMatch(artifact)?.decodedBodySize ?? null,
  }));
  const compiledArena = compiled ? {
    arenaBytes: Number(compiled.arenaBytes || 0),
    parameterBytes: Number(compiled.parameterBytes || 0),
    drawListIds: Array.isArray(compiled.drawListIds) ? compiled.drawListIds.slice() : [],
  } : null;
  if (compiledArena) {
    compiledArena.complete = compiledArena.arenaBytes > 0 && compiledArena.parameterBytes > 0 &&
      ["shadow_casters", "scene_visible"]
        .every((id) => compiledArena.drawListIds.includes(id));
  }
  const compiledPasses = compiled && Array.isArray(compiled.reflectionPasses)
    ? compiled.reflectionPasses.map((pass) => ({
        surfaceId: String(pass.surfaceId || ""),
        reflectionDepth: Number(pass.reflectionDepth || 0),
        drawListId: String(pass.drawListId || ""),
      }))
    : [];
  const requiredReflectionKeys = [2, 1].flatMap((depth) =>
    REQUIRED_MIRROR_MESHES.map((surfaceId) =>
      `${surfaceId}:${depth}`
    )
  );
  const compiledReflectionKeys = new Set(compiledPasses.map((pass) =>
    `${pass.surfaceId}:${pass.reflectionDepth}`
  ));
  const reflections = compiled ? {
    passes: compiledPasses,
    complete: requiredReflectionKeys.every((key) => compiledReflectionKeys.has(key)) &&
      compiledPasses.every((pass) => !!pass.drawListId &&
        compiledArena?.drawListIds.includes(pass.drawListId)),
  } : null;
  if (compiledArena) {
    compiledArena.complete = compiledArena.complete && reflections.complete;
  }
  const compiledArtifacts = compiled ? {
    entries: compiledArtifactEntries,
    complete: artifactWanted.length === 4 && compiledArtifactEntries.every((item) => item.fetched),
  } : null;
  const forbiddenLegacyPattern = /(?:^|\/)(?:vf-native-scene(?:-adapters)?\.js|vf-gpu-runtime\.js|vf-axis3d-[^/]*|vf-geom-[^/]*)$/u;
  const forbiddenLegacy = compiled ? [...new Set(resources.map((entry) => {
    try { return decodeURIComponent(new URL(entry.name).pathname).replaceAll("\\", "/"); }
    catch (_) { return String(entry.name || "").replaceAll("\\", "/"); }
  }).filter((resourcePath) => forbiddenLegacyPattern.test(resourcePath))
    .map((resourcePath) => basename(resourcePath)))] : [];
  const compiledComplete = !!compiled && compiled.presented === true &&
    compiledArtifacts.complete && compiledArena.complete && reflections.complete &&
    forbiddenLegacy.length === 0;
  return {
    mode: compiled ? "compiled-wasm-wgsl" : "legacy-native-scene",
    expectedCount: wanted.length,
    loadedCount: wanted.length - missing.length,
    missing,
    loaded,
    adapterBundle: bundleDependency ? {
      name: bundleDependency,
      fetched: !!bundleResource || !!bundleDomUrl,
      evaluated: !!bundleManifest,
      verified: bundleVerified,
      inventorySha256: bundleManifest?.inventorySha256 || null,
      sourceCount: manifestSources.length,
    } : null,
    arena: arena ? {
      name: basename(new URL(arena.name).pathname),
      responseEndMs: arena.responseEnd,
      decodedBodySize: arena.decodedBodySize,
      hydrated: probe.arenaHydrated === true,
    } : (probe.arenaUrl ? {
      name: probe.arenaUrl,
      responseEndMs: null,
      decodedBodySize: null,
      hydrated: probe.arenaHydrated === true,
    } : null),
    wasm: wasm.map((entry) => ({ name: basename(new URL(entry.name).pathname), responseEndMs: entry.responseEnd })),
    mirrors,
    mirrorComplete,
    compiledArtifacts,
    compiledArena,
    reflections,
    forbiddenLegacy,
    complete: missing.length === 0 && (compiled
      ? compiledComplete
      : !!probe.arenaUrl && probe.arenaHydrated === true && mirrorComplete &&
        Number(probe.renderer?.surfacePassCount || 0) >= REQUIRED_MIRROR_MESHES.length),
  };
}

function durationBetween(start, end) {
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
}

function emptyDerivedDurations() {
  return {
    dependencyLoad: null,
    arenaHydration: null,
    sceneMount: null,
    gpuWorkAndMirrorClosure: null,
    reveal: null,
  };
}

export function sampleFromProbe({ probe, processSpawnEpochMs, processToProbeMs, screenshotSha256, screenshotBytes, cacheState }) {
  const timeline = probe.timeline || [];
  const closure = dependencyClosure(probe);
  const dependenciesStart = firstMark(timeline, "compiled-dependencies:start") ??
    firstMark(timeline, "dependencies:start");
  const dependenciesReady = lastMark(timeline, "compiled-dependencies:ready") ??
    lastMark(timeline, "dependencies:ready");
  const arenaOrWasmReady = lastMark(timeline, "compiled-artifacts:ready") ??
    firstMark(timeline, "scene:buildSceneState:start");
  const sceneReady = lastMark(timeline, "compiled-scene:mount") ??
    lastMark(timeline, "scene:afterRenderPayload") ??
    lastMark(timeline, "frame:interactive");
  const gpuDone = lastMark(timeline, "gpu:first-work-done");
  const uiReveal = lastMark(timeline, "ui:revealed");
  const derivedDurationsMs = {
    dependencyLoad: durationBetween(dependenciesStart, dependenciesReady),
    arenaHydration: durationBetween(dependenciesReady, arenaOrWasmReady),
    sceneMount: durationBetween(arenaOrWasmReady, sceneReady),
    gpuWorkAndMirrorClosure: durationBetween(sceneReady, gpuDone),
    reveal: durationBetween(gpuDone, uiReveal),
  };
  const navigationStartFromProcessMs = probe.timeOrigin - processSpawnEpochMs;
  const processToUiRevealMs = Number.isFinite(uiReveal)
    ? navigationStartFromProcessMs + uiReveal : null;
  const stages = {
    processStartMs: 0,
    navigationStartMs: navigationStartFromProcessMs,
    navigationResponseEndMs: navigationStartFromProcessMs + Number(probe.navigation?.responseEnd || 0),
    dependenciesReadyMs: Number.isFinite(dependenciesReady)
      ? navigationStartFromProcessMs + dependenciesReady : null,
    arenaOrWasmReadyMs: Number.isFinite(arenaOrWasmReady)
      ? navigationStartFromProcessMs + arenaOrWasmReady : null,
    sceneReadyMs: Number.isFinite(sceneReady) ? navigationStartFromProcessMs + sceneReady : null,
    firstFullyCompositedGpuWorkDoneMs: Number.isFinite(gpuDone)
      ? navigationStartFromProcessMs + gpuDone : null,
    uiRevealMs: processToUiRevealMs,
    probeObservedMs: processToProbeMs,
  };
  const ordered = [
    stages.processStartMs,
    stages.navigationStartMs,
    stages.dependenciesReadyMs,
    stages.arenaOrWasmReadyMs,
    stages.sceneReadyMs,
    stages.firstFullyCompositedGpuWorkDoneMs,
    stages.uiRevealMs,
  ];
  const stageComplete = ordered.every(Number.isFinite);
  const monotonic = stageComplete && ordered.every((value, index) => index === 0 || value >= ordered[index - 1] - 1);
  const presented = probe.compiledRuntime
    ? probe.compiledRuntime.presented === true
    : probe.renderer?.presentedFirstFrame === true;
  const fullyRendered = probe.readyAttribute === "1" && probe.pendingAttribute === null &&
    probe.startup?.revealed === true && presented &&
    probe.titleVisible === true && probe.canvasVisible === true && closure.complete;
  const rendererEvidence = probe.compiledRuntime ? {
    mode: "compiled-wasm-wgsl",
    presented: probe.compiledRuntime.presented === true,
    arenaBytes: closure.compiledArena?.arenaBytes ?? 0,
    parameterBytes: closure.compiledArena?.parameterBytes ?? 0,
    drawListIds: closure.compiledArena?.drawListIds ?? [],
    reflectionPasses: closure.reflections?.passes ?? [],
  } : probe.renderer?.evidence || null;
  return {
    cacheState,
    browserStartupTimeline: timeline,
    derivedDurationsMs,
    stages,
    processToUiRevealMs,
    stageComplete,
    monotonic,
    fullyRendered,
    gatePass: fullyRendered && monotonic && processToUiRevealMs <= BUDGET_MS,
    dependencyClosure: closure,
    rendererEvidence,
    screenshot: { sha256: screenshotSha256, bytes: screenshotBytes },
    errors: [probe.startupError, probe.loadError, probe.lastError].filter(Boolean),
    clock: {
      source: "renderer performance.timeOrigin bridged to harness Date.now at process spawn",
      resolutionMs: 1,
    },
  };
}

async function closeRuntime(runtime) {
  try {
    await Promise.race([
      cdp(runtime.browserSocket, runtime.browserState, "Browser.close"),
      sleep(1000),
    ]);
  } catch (_) {}
  try { runtime.pageSocket.close(); } catch (_) {}
  try { runtime.browserSocket.close(); } catch (_) {}
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (_) { return false; }
}

export function edgeCommandLineOwnsBenchmark({ commandLine, profile, port }) {
  if (!commandLine || !profile || !Number.isInteger(port)) return false;
  const value = String(commandLine);
  const profileValue = String(profile).replace(/[\\/]+$/u, "");
  const profileArguments = [
    `--user-data-dir=${profileValue}`,
    `--user-data-dir="${profileValue}"`,
  ];
  return value.includes(`--remote-debugging-port=${port}`) &&
    profileArguments.some((argument) => value.includes(argument)) &&
    !value.includes("--type=");
}

function parsePowerShellProcessJson(output) {
  const value = String(output || "").trim();
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (_) {
    return [];
  }
}

function windowsOwnedEdgePid({ pid, profile, port }) {
  if (!Number.isInteger(pid) || pid <= 0 || !profile || !Number.isInteger(port)) return false;
  const command = [
    "$candidate=Get-CimInstance Win32_Process -Filter ('ProcessId=' + [string]$env:VF_RABBIT_EDGE_PID);",
    "$candidate | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress",
  ].join(" ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      VF_RABBIT_EDGE_PID: String(pid),
    },
  });
  const candidate = parsePowerShellProcessJson(result.stdout)[0];
  return result.status === 0 && String(candidate?.Name || "").toLowerCase() === "msedge.exe" &&
    edgeCommandLineOwnsBenchmark({ commandLine: candidate?.CommandLine, profile, port });
}

function windowsKillProcessTree(pid) {
  return spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
}

export async function terminateOwnedEdgeProcessTree({
  edge,
  browserPid = null,
  profile,
  port,
  platform = process.platform,
  inspectOwnedPid = windowsOwnedEdgePid,
  killTree = windowsKillProcessTree,
  isAlive = processAlive,
  sleepFn = sleep,
  gracefulWaitMs = 30000,
  maxWaitMs = 5000,
}) {
  const candidates = [...new Set([edge?.pid, browserPid]
    .filter((pid) => Number.isInteger(pid) && pid > 0))];
  const owned = platform === "win32"
    ? candidates.filter((pid) => inspectOwnedPid({ pid, profile, port }) === true)
    : [];
  const gracefulDeadline = performance.now() + Math.max(0, Number(gracefulWaitMs) || 0);
  while (owned.some(isAlive) && performance.now() < gracefulDeadline) await sleepFn(25);
  const forceable = owned.filter((pid) => isAlive(pid) &&
    inspectOwnedPid({ pid, profile, port }) === true);
  for (const pid of forceable) killTree(pid);
  if (edge && edge.exitCode === null && isAlive(edge.pid) && typeof edge.kill === "function") {
    try { edge.kill(); } catch (_) {}
  }
  const deadline = performance.now() + Math.max(0, Number(maxWaitMs) || 0);
  while (forceable.some(isAlive) && performance.now() < deadline) await sleepFn(25);
  for (const pid of forceable.filter(isAlive)) {
    if (inspectOwnedPid({ pid, profile, port }) === true) killTree(pid);
  }
  return { candidatePids: candidates, ownedPids: owned };
}

function edgeBrowserPid(port, profile) {
  if (process.platform !== "win32") return null;
  const command = [
    "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" |",
    "Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress",
  ].join(" ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
  });
  const match = parsePowerShellProcessJson(result.stdout).find((candidate) =>
    edgeCommandLineOwnsBenchmark({ commandLine: candidate?.CommandLine, profile, port }));
  const pid = Number(match?.ProcessId);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

export async function runSample({
  edgePath = DEFAULT_EDGE,
  scenePath,
  profile,
  gpuMode = "hardware",
  cacheState,
  screenshotPath = "",
}) {
  if (!existsSync(edgePath)) throw new Error(`Edge missing at ${edgePath}`);
  if (!existsSync(scenePath)) throw new Error(`staged rabbit scene missing at ${scenePath}`);
  const port = await freePort();
  const sceneUrl = pathToFileURL(resolve(scenePath)).href;
  const args = edgeArgs({ profile, port, sceneUrl, gpuMode });
  if (!args.includes("--headless=new")) throw new Error("benchmark refuses a visible Edge launch");
  const processSpawnEpochMs = Date.now();
  const processSpawnMonoMs = performance.now();
  const edge = spawn(edgePath, args, { stdio: "ignore", windowsHide: true });
  edge.once("error", () => {});
  let runtime = null;
  try {
    const version = await waitForJson(`http://127.0.0.1:${port}/json/version`, 15000);
    const targetDeadline = performance.now() + 15000;
    let target = null;
    while (!target && performance.now() < targetDeadline) {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      target = targets.find((candidate) => decodeURIComponent(String(candidate.url || "")) === decodeURIComponent(sceneUrl));
      if (!target) await sleep(10);
    }
    if (!target) throw new Error("headless Edge rabbit target is missing");
    const [pageSocket, browserSocket] = await Promise.all([
      connectWs(target.webSocketDebuggerUrl),
      connectWs(version.webSocketDebuggerUrl),
    ]);
    runtime = {
      edge,
      browserPid: edgeBrowserPid(port, profile),
      pageSocket,
      pageState: attachReceiver(pageSocket),
      browserSocket,
      browserState: attachReceiver(browserSocket),
    };
    await Promise.all([
      cdp(pageSocket, runtime.pageState, "Runtime.enable"),
      cdp(pageSocket, runtime.pageState, "Page.enable"),
    ]);
    const deadline = performance.now() + 20000;
    let probe = null;
    while (performance.now() < deadline) {
      probe = await evaluate(runtime, probeExpression(FRAME_ID));
      if (probe?.startupError || probe?.loadError || probe?.lastError) break;
      if (probeReady(probe)) break;
      await sleep(5);
    }
    if (!probe) throw new Error("rabbit startup probe returned no state");
    const screenshot = await cdp(pageSocket, runtime.pageState, "Page.captureScreenshot", {
      format: "png", fromSurface: true, captureBeyondViewport: false, optimizeForSpeed: true,
    });
    const screenshotBytes = Buffer.from(screenshot.data || "", "base64");
    const screenshotSha256 = createHash("sha256").update(screenshotBytes).digest("hex");
    if (screenshotPath) {
      const resolvedScreenshot = resolve(screenshotPath);
      mkdirSync(dirname(resolvedScreenshot), { recursive: true });
      writeFileSync(resolvedScreenshot, screenshotBytes);
    }
    return sampleFromProbe({
      probe,
      processSpawnEpochMs,
      processToProbeMs: performance.now() - processSpawnMonoMs,
      screenshotSha256,
      screenshotBytes: screenshotBytes.length,
      cacheState,
    });
  } finally {
    if (runtime) await closeRuntime(runtime);
    await terminateOwnedEdgeProcessTree({
      edge,
      browserPid: runtime?.browserPid ?? edgeBrowserPid(port, profile),
      profile,
      port,
    });
  }
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function stats(samples) {
  const values = samples.map((sample) => sample.processToUiRevealMs).filter(Number.isFinite);
  return {
    count: samples.length,
    minMs: values.length ? Math.min(...values) : null,
    medianMs: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: values.length ? Math.max(...values) : null,
    allFullyRendered: samples.every((sample) => sample.fullyRendered),
    allDependencyClosuresComplete: samples.every((sample) => sample.dependencyClosure.complete),
    allWithinBudget: samples.every((sample) => sample.gatePass),
  };
}

function failedSample(cacheState, error) {
  return {
    cacheState,
    browserStartupTimeline: [],
    derivedDurationsMs: emptyDerivedDurations(),
    stages: {},
    processToUiRevealMs: null,
    stageComplete: false,
    monotonic: false,
    fullyRendered: false,
    gatePass: false,
    dependencyClosure: {
      complete: false,
      mirrorComplete: false,
      missing: [],
      failure: "startup could not be observed",
    },
    rendererEvidence: null,
    screenshot: null,
    errors: [String(error && error.stack || error)],
  };
}

export function parseHostTrace(tracePath) {
  if (!tracePath) return { available: false, reason: "no --host-trace supplied" };
  if (!existsSync(tracePath)) return { available: false, reason: `trace missing: ${tracePath}` };
  const entries = readFileSync(tracePath, "utf8").split(/\r?\n/u).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`invalid host trace JSON at line ${index + 1}: ${error.message}`); }
  });
  const stages = Object.fromEntries(entries.map((entry) => [entry.stage, Number(entry.elapsed_ms)]));
  return {
    available: true,
    path: resolve(tracePath),
    entries,
    stages,
    processToRevealMs: Number.isFinite(stages.content_revealed) ? stages.content_revealed : null,
    gatePass: Number.isFinite(stages.content_revealed) && stages.content_revealed <= BUDGET_MS,
  };
}

export function summarize({ coldSamples, warmSamples, scenePath, edgePath, gpuMode, hostTrace }) {
  const cold = stats(coldSamples);
  const warm = stats(warmSamples);
  const hardwareComparable = gpuMode === "hardware";
  const gatePass = hardwareComparable && cold.allWithinBudget && warm.allWithinBudget &&
    (!hostTrace.available || hostTrace.gatePass);
  return {
    schema: SCHEMA,
    generatedAt: new Date().toISOString(),
    contract: {
      budgetMs: BUDGET_MS,
      metric: "process start to atomic UI reveal after first fully composited GPU work completes",
      coldDefinition: "new Edge user-data directory; operating-system file cache is not flushed",
      warmDefinition: "new Edge process reusing the immediately preceding cold sample user-data directory",
      visibleLaunchMode: "atomic reveal semantics exercised offscreen by --headless=new",
      gateRequires: ["hardware WebGPU", "all cold samples <= 500 ms", "all warm samples <= 500 ms", "mirror dependency closure"],
    },
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      edgePath: resolve(edgePath),
      gpuMode,
      headless: true,
      windowsHide: true,
    },
    artifact: { scenePath: resolve(scenePath) },
    cold: { ...cold, samples: coldSamples },
    warm: { ...warm, samples: warmSamples },
    hostTrace,
    gate: {
      pass: gatePass,
      budgetMs: BUDGET_MS,
      hardwareComparable,
      failures: [
        ...(!hardwareComparable ? ["SwiftShader is correctness-only and cannot pass the performance gate"] : []),
        ...(!cold.allWithinBudget ? [`cold-profile launch exceeds ${BUDGET_MS} ms or is incomplete`] : []),
        ...(!warm.allWithinBudget ? [`warm-profile launch exceeds ${BUDGET_MS} ms or is incomplete`] : []),
        ...(hostTrace.available && !hostTrace.gatePass ? [`native host trace exceeds ${BUDGET_MS} ms or lacks content_revealed`] : []),
      ],
    },
  };
}

export async function runBenchmark({
  edgePath = DEFAULT_EDGE,
  scenePath,
  gpuMode = "hardware",
  pairs = 3,
  hostTracePath = "",
  screenshotPath = "",
}) {
  const coldSamples = [];
  const warmSamples = [];
  const cleanupWarnings = [];
  for (let index = 0; index < pairs; index += 1) {
    const profile = mkdtempSync(join(tmpdir(), "vf-rabbit-startup-"));
    try {
      try {
        coldSamples.push(await runSample({
          edgePath,
          scenePath,
          profile,
          gpuMode,
          cacheState: "cold-profile",
          screenshotPath: index === 0 ? screenshotPath : "",
        }));
      } catch (error) {
        coldSamples.push(failedSample("cold-profile", error));
      }
      try {
        warmSamples.push(await runSample({ edgePath, scenePath, profile, gpuMode, cacheState: "warm-profile" }));
      } catch (error) {
        warmSamples.push(failedSample("warm-profile", error));
      }
    } finally {
      const resolvedProfile = resolve(profile);
      const resolvedTemp = resolve(tmpdir());
      if (!resolvedProfile.startsWith(resolvedTemp + "\\") && !resolvedProfile.startsWith(resolvedTemp + "/")) {
        throw new Error(`refusing to remove profile outside temp: ${resolvedProfile}`);
      }
      let removed = false;
      let cleanupError = null;
      for (let attempt = 0; attempt < 20 && !removed; attempt += 1) {
        try {
          rmSync(resolvedProfile, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
          removed = true;
        } catch (error) {
          cleanupError = error;
          await sleep(250);
        }
      }
      if (!removed) {
        cleanupWarnings.push({ profile: resolvedProfile, error: String(cleanupError) });
      }
    }
  }
  const result = summarize({
    coldSamples,
    warmSamples,
    scenePath,
    edgePath,
    gpuMode,
    hostTrace: parseHostTrace(hostTracePath),
  });
  result.cleanupWarnings = cleanupWarnings;
  return result;
}

export function defaultScenePath(root = process.cwd()) {
  return resolve(root, ".w", "startup-fast", "web", "sessions", "app", "vkf-scene.html");
}

export function outputDirectoryFor(outputPath) {
  return dirname(resolve(outputPath));
}
