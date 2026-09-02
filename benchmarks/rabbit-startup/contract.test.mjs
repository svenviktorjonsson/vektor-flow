import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import {
  BUDGET_MS,
  dependencyClosure,
  edgeCommandLineOwnsBenchmark,
  edgeArgs,
  parseHostTrace,
  probeExpression,
  probeReady,
  sampleFromProbe,
  summarize,
  terminateOwnedEdgeProcessTree,
} from "./harness.mjs";

function sample(ms, complete = true) {
  return {
    processToUiRevealMs: ms,
    fullyRendered: complete,
    monotonic: complete,
    gatePass: complete && ms <= BUDGET_MS,
    dependencyClosure: { complete },
  };
}

test("Edge measurement is always offscreen and hidden", () => {
  const args = edgeArgs({
    profile: "C:\\temp\\profile",
    port: 9237,
    sceneUrl: "file:///C:/scene/vkf-scene.html",
  });
  assert.ok(args.includes("--headless=new"));
  assert.ok(args.includes("--enable-unsafe-webgpu"));
  assert.ok(args.includes("--disable-renderer-backgrounding"));
  assert.ok(args.includes("--disable-background-mode"));
  assert.equal(
    args.some((argument) => argument.includes("Vulkan")),
    false,
    "Windows hardware WebGPU should use its native backend without forced Vulkan startup",
  );
  assert.equal(args.some((argument) => argument.startsWith("--app=")), false);
  assert.equal(args.some((argument) => argument.startsWith("--start-maximized")), false);
});

test("browser probe observes compiled canvas, arenas, dependencies, and reflection plan", () => {
  const canvas = {
    getBoundingClientRect: () => ({ width: 900, height: 700 }),
  };
  const probe = runInNewContext(probeExpression("material_gallery_frame"), {
    URL,
    window: {
      __vfStartupTimeline: [],
      __vfRuntimeShellConfig: {
        compiledScriptDeps: ["vf-compiled-runtime-bridge.js"],
        sceneStyleDeps: [{ href: "vf-frame.css" }, { href: "vf-chess.css" }],
        compiledWasmUrl: "vkf-program.wasm",
        compiledWasmManifestUrl: "vkf-program.wasm-manifest.json",
        compiledWgslUrl: "vkf-render.wgsl",
        compiledWebGpuManifestUrl: "vkf-render.webgpu-manifest.json",
      },
      __vfCompiledRuntime: {
        presented: true,
        arenaBytes: new Uint8Array(64),
        parameterBytes: new Uint8Array(32),
        parameterDescriptor: {
          draw_lists: [
            { id: "reflection_visible_2" },
            { id: "reflection_visible_1" },
          ],
        },
        passes: [
          {
            kind: "planar_reflection",
            surface_id: "studio_floor",
            reflection_depth: 2,
            draw_list_id: "reflection_visible_2",
          },
        ],
      },
      __vfCompiledArtifacts: {
        wasm: { instance: {} },
        arena: { bytes: new Uint8Array(64) },
        parameters: { bytes: new Uint8Array(32) },
        render: { wgsl: "@vertex fn main() {}", manifest: {} },
      },
      VfStartupGate: { snapshot: () => ({ revealed: true }) },
    },
    performance: {
      timeOrigin: 1000,
      now: () => 100,
      getEntriesByType: (kind) => kind === "navigation" ? [{}] : [],
    },
    document: {
      documentElement: { getAttribute: () => null },
      querySelector: (selector) =>
        selector === "canvas[data-vf-compiled-scene]" ? canvas : null,
      querySelectorAll: () => [],
    },
  });

  assert.equal(probe.canvasVisible, true);
  assert.deepEqual([...probe.dependencies.scripts], ["vf-compiled-runtime-bridge.js"]);
  assert.deepEqual([...probe.dependencies.styles], ["vf-frame.css"]);
  assert.deepEqual([...probe.dependencies.artifacts], [
    "vkf-program.wasm",
    "vkf-program.wasm-manifest.json",
    "vkf-render.wgsl",
    "vkf-render.webgpu-manifest.json",
  ]);
  assert.equal(probe.compiledRuntime.presented, true);
  assert.equal(probe.compiledRuntime.arenaBytes, 64);
  assert.equal(probe.compiledRuntime.parameterBytes, 32);
  assert.equal(probe.compiledRuntime.artifactsReady, true);
  assert.deepEqual([...probe.compiledRuntime.drawListIds], [
    "reflection_visible_2",
    "reflection_visible_1",
  ]);
  assert.deepEqual(probe.compiledRuntime.reflectionPasses.map((pass) => ({
    surfaceId: pass.surfaceId,
    reflectionDepth: pass.reflectionDepth,
    drawListId: pass.drawListId,
  })), [{
    surfaceId: "studio_floor",
    reflectionDepth: 2,
    drawListId: "reflection_visible_2",
  }]);
});

test("sampling stops on compiled presentation and retains legacy presentation fallback", () => {
  const gate = { readyAttribute: "1", startup: { revealed: true } };
  assert.equal(probeReady({
    ...gate,
    compiledRuntime: { presented: true },
    renderer: null,
  }), true);
  assert.equal(probeReady({
    ...gate,
    compiledRuntime: null,
    renderer: { presentedFirstFrame: true },
  }), true);
  assert.equal(probeReady({
    ...gate,
    compiledRuntime: { presented: false },
    renderer: { presentedFirstFrame: true },
  }), false);
});

test("cleanup tree-kills only a PID verified against this harness profile and port", async () => {
  const inspected = [];
  const treeKills = [];
  const alive = new Set([4101, 4102]);
  let directKills = 0;
  const profile = "C:\\temp\\vf-rabbit-startup-owned";
  await terminateOwnedEdgeProcessTree({
    edge: {
      pid: 4101,
      exitCode: null,
      kill() { directKills += 1; },
    },
    browserPid: 4102,
    profile,
    port: 9237,
    platform: "win32",
    inspectOwnedPid({ pid, profile: candidateProfile, port: candidatePort }) {
      inspected.push({ pid, profile: candidateProfile, port: candidatePort });
      return pid === 4101 && candidateProfile === profile && candidatePort === 9237;
    },
    killTree(pid) { treeKills.push(pid); alive.delete(pid); },
    isAlive: (pid) => alive.has(pid),
    sleepFn: async () => {},
    gracefulWaitMs: 0,
    maxWaitMs: 0,
  });

  assert.deepEqual(inspected, [
    { pid: 4101, profile, port: 9237 },
    { pid: 4102, profile, port: 9237 },
    { pid: 4101, profile, port: 9237 },
  ]);
  assert.deepEqual(treeKills, [4101]);
  assert.equal(directKills, 0);
});

test("cleanup lets Browser.close finish before forcing an owned Edge tree", async () => {
  const treeKills = [];
  const alive = new Set([4101]);
  await terminateOwnedEdgeProcessTree({
    edge: { pid: 4101, exitCode: null, kill() {} },
    profile: "C:\\temp\\vf-rabbit-startup-owned",
    port: 9237,
    platform: "win32",
    inspectOwnedPid: () => true,
    killTree(pid) { treeKills.push(pid); },
    isAlive: (pid) => alive.has(pid),
    sleepFn: async () => alive.clear(),
    gracefulWaitMs: 100,
    maxWaitMs: 0,
  });

  assert.deepEqual(treeKills, []);
});

test("cleanup preserves the exact 8.3 profile spelling used to launch Edge", () => {
  const profile = "C:\\Users\\VIKTOR~1.JON\\AppData\\Local\\Temp\\vf-rabbit-startup-Ab12Cd";
  const commandLine = [
    '"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"',
    `--user-data-dir=${profile}`,
    "--remote-debugging-port=61941",
    "--headless=new",
  ].join(" ");

  assert.equal(edgeCommandLineOwnsBenchmark({ commandLine, profile, port: 61941 }), true);
  assert.equal(edgeCommandLineOwnsBenchmark({ commandLine, profile, port: 61942 }), false);
  assert.equal(edgeCommandLineOwnsBenchmark({
    commandLine,
    profile: "C:\\Users\\viktor.jonsson\\AppData\\Local\\Temp\\vf-rabbit-startup-Ab12Cd",
    port: 61941,
  }), false);
});

test("one evaluated adapter bundle closes its verified source dependencies", () => {
  const sources = [
    { path: "vf-startup-gate.js", sha256: "a".repeat(64) },
    { path: "geom/vf-geom-wgpu.js", sha256: "b".repeat(64) },
  ];
  const inventorySha256 = createHash("sha256")
    .update(sources.map(({ path, sha256 }) => `${path}:${sha256}\n`).join(""), "utf8")
    .digest("hex");
  const closure = dependencyClosure({
    resources: [
      {
        name: "https://app.vkf.local/web/geom/vf-native-scene-adapters.js?v=1",
        responseEnd: 12,
      },
      {
        name: "https://app.vkf.local/web/scene.arena",
        responseEnd: 14,
        decodedBodySize: 1024,
      },
    ],
    dependencies: {
      scripts: sources.map(({ path }) => path),
      styles: [],
      domUrls: ["https://app.vkf.local/web/geom/vf-native-scene-adapters.js?v=1"],
      adapterBundle: "geom/vf-native-scene-adapters.js",
      adapterBundleManifest: {
        schema: "vektor-flow/runtime-adapter-bundle-v1",
        inventorySha256,
        sources,
      },
    },
    arenaUrl: "scene.arena",
    arenaHydrated: true,
    renderer: {
      surfacePassCount: 2,
      parts: ["studio_floor", "upright_mirror"].map((id) => ({
        id,
        surfaceTextureReady: true,
        runtimeTextureReady: true,
        projectiveTexture: true,
        surfaceWidth: 64,
        surfaceHeight: 64,
        hasSurfaceColorTexture: true,
      })),
    },
  });

  assert.equal(closure.complete, true);
  assert.equal(closure.loadedCount, 2);
  assert.deepEqual(closure.missing, []);
  assert.equal(closure.loaded.every((item) => item.source === "verified-adapter-bundle"), true);
});

test("an unverified bundle inventory cannot hide missing network dependencies", () => {
  const closure = dependencyClosure({
    resources: [{
      name: "https://app.vkf.local/web/geom/vf-native-scene-adapters.js",
      responseEnd: 12,
    }],
    dependencies: {
      scripts: ["vf-startup-gate.js"],
      styles: [],
      domUrls: [],
      adapterBundle: "geom/vf-native-scene-adapters.js",
      adapterBundleManifest: {
        schema: "vektor-flow/runtime-adapter-bundle-v1",
        inventorySha256: "0".repeat(64),
        sources: [{ path: "vf-startup-gate.js", sha256: "a".repeat(64) }],
      },
    },
    renderer: { parts: [] },
  });

  assert.equal(closure.adapterBundle.fetched, true);
  assert.equal(closure.adapterBundle.verified, false);
  assert.deepEqual(closure.missing, ["vf-startup-gate.js"]);
});

test("compiled dependency closure proves WASM, WGSL, arenas, and reflected passes", () => {
  const scripts = [
    "vf-startup-gate.js",
    "vf-compiled-runtime-bridge.js",
    "vf-compiled-webgpu-adapter.js",
  ];
  const styles = ["vf-frame.css", "vf-chess.css"];
  const artifacts = [
    "vkf-program.wasm",
    "vkf-program.wasm-manifest.json",
    "vkf-render.wgsl",
    "vkf-render.webgpu-manifest.json",
  ];
  const resources = [...scripts, ...styles, ...artifacts].map((name, index) => ({
    name: `https://app.vkf.local/web/${name}`,
    responseEnd: 10 + index,
    decodedBodySize: 100 + index,
  }));
  const reflectionPasses = [2, 1].flatMap((depth) =>
    ["studio_floor", "upright_mirror"].map((surfaceId) => ({
      surfaceId,
      reflectionDepth: depth,
      drawListId: `reflection_visible_${surfaceId}_${depth}`,
    })),
  );
  const compiledProbe = {
    resources,
    dependencies: {
      scripts,
      styles,
      artifacts,
      domUrls: [...scripts, ...styles].map((name) =>
        `https://app.vkf.local/web/${name}`
      ),
    },
    compiledRuntime: {
      presented: true,
      arenaBytes: 1_438_168,
      parameterBytes: 512,
      drawListIds: [
        "shadow_casters",
        "reflection_visible_studio_floor_2",
        "reflection_visible_upright_mirror_2",
        "reflection_visible_studio_floor_1",
        "reflection_visible_upright_mirror_1",
        "scene_visible",
      ],
      reflectionPasses,
    },
  };
  const closure = dependencyClosure(compiledProbe);

  assert.equal(closure.mode, "compiled-wasm-wgsl");
  assert.equal(closure.complete, true);
  assert.deepEqual(closure.missing, []);
  assert.equal(closure.compiledArtifacts.complete, true);
  assert.equal(closure.compiledArena.complete, true);
  assert.equal(closure.reflections.complete, true);
  assert.equal(closure.reflections.passes.length, 4);
  const fileUrlClosure = dependencyClosure({
    ...compiledProbe,
    resources: resources.filter((entry) =>
      !artifacts.some((artifact) => entry.name.endsWith(`/${artifact}`))
    ),
    compiledRuntime: {
      ...compiledProbe.compiledRuntime,
      artifactsReady: true,
    },
  });
  assert.equal(fileUrlClosure.complete, true);
  assert.equal(
    fileUrlClosure.compiledArtifacts.entries.every((item) =>
      item.source === "compiled-runtime"
    ),
    true,
  );
  const polluted = dependencyClosure({
    ...compiledProbe,
    resources: [...resources, {
      name: "https://app.vkf.local/web/vf-native-scene.js",
      responseEnd: 99,
    }],
  });
  assert.equal(polluted.complete, false);
  assert.deepEqual(polluted.forbiddenLegacy, ["vf-native-scene.js"]);
});

test("each sample preserves browser startup evidence and derives phase durations", () => {
  const timeline = [
    { name: "dependencies:start", t: 10, detail: { scripts: 1 } },
    { name: "dependencies:ready", t: 30, detail: { scripts: 1 } },
    { name: "scene:buildSceneState:start", t: 45, detail: { frame_id: "frame" } },
    { name: "scene:afterRenderPayload", t: 80, detail: { frame_id: "frame" } },
    { name: "gpu:first-work-done", t: 120, detail: { frame_id: "frame" } },
    { name: "ui:revealed", t: 125, detail: null },
  ];
  const result = sampleFromProbe({
    probe: {
      timeline,
      timeOrigin: 1000,
      navigation: { responseEnd: 1 },
      resources: [],
      dependencies: { scripts: [], styles: [], domUrls: [] },
      renderer: { parts: [], presentedFirstFrame: false },
    },
    processSpawnEpochMs: 900,
    processToProbeMs: 130,
    screenshotSha256: "f".repeat(64),
    screenshotBytes: 32,
    cacheState: "cold-profile",
  });

  assert.deepEqual(result.browserStartupTimeline, timeline);
  assert.deepEqual(result.derivedDurationsMs, {
    dependencyLoad: 20,
    arenaHydration: 15,
    sceneMount: 35,
    gpuWorkAndMirrorClosure: 40,
    reveal: 5,
  });
});

test("compiled sample times artifact readiness through reflected GPU presentation", () => {
  const scripts = [
    "vf-startup-gate.js",
    "vf-compiled-runtime-bridge.js",
    "vf-compiled-webgpu-adapter.js",
  ];
  const styles = ["vf-frame.css", "vf-chess.css"];
  const artifacts = [
    "vkf-program.wasm",
    "vkf-program.wasm-manifest.json",
    "vkf-render.wgsl",
    "vkf-render.webgpu-manifest.json",
  ];
  const timeline = [
    { name: "compiled-dependencies:start", t: 10 },
    { name: "compiled-dependencies:ready", t: 20 },
    { name: "compiled-artifacts:ready", t: 40 },
    { name: "compiled-scene:mount", t: 50 },
    { name: "gpu:first-work-done", t: 90 },
    { name: "ui:revealed", t: 95 },
  ];
  const result = sampleFromProbe({
    probe: {
      timeline,
      timeOrigin: 1000,
      navigation: { responseEnd: 1 },
      resources: [...scripts, ...styles, ...artifacts].map((name, index) => ({
        name: `https://app.vkf.local/web/${name}`,
        responseEnd: 10 + index,
      })),
      dependencies: { scripts, styles, artifacts, domUrls: [] },
      compiledRuntime: {
        presented: true,
        arenaBytes: 1_438_168,
        parameterBytes: 512,
        drawListIds: [
          "shadow_casters",
          "reflection_visible_studio_floor_2",
          "reflection_visible_upright_mirror_2",
          "reflection_visible_studio_floor_1",
          "reflection_visible_upright_mirror_1",
          "scene_visible",
        ],
        reflectionPasses: [2, 1].flatMap((depth) =>
          ["studio_floor", "upright_mirror"].map((surfaceId) => ({
            surfaceId,
            reflectionDepth: depth,
            drawListId: `reflection_visible_${surfaceId}_${depth}`,
          })),
        ),
      },
      startup: { revealed: true },
      readyAttribute: "1",
      pendingAttribute: null,
      titleVisible: true,
      canvasVisible: true,
    },
    processSpawnEpochMs: 900,
    processToProbeMs: 100,
    screenshotSha256: "e".repeat(64),
    screenshotBytes: 64,
    cacheState: "warm-profile",
  });

  assert.deepEqual(result.derivedDurationsMs, {
    dependencyLoad: 10,
    arenaHydration: 20,
    sceneMount: 10,
    gpuWorkAndMirrorClosure: 40,
    reveal: 5,
  });
  assert.equal(result.fullyRendered, true);
  assert.equal(result.stageComplete, true);
  assert.equal(result.rendererEvidence.mode, "compiled-wasm-wgsl");
});

test("500 ms ratchet rejects a single slow or incomplete cold/warm sample", () => {
  const common = {
    scenePath: "C:\\scene\\vkf-scene.html",
    edgePath: "C:\\edge\\msedge.exe",
    gpuMode: "hardware",
    hostTrace: { available: false },
  };
  assert.equal(summarize({ ...common, coldSamples: [sample(499)], warmSamples: [sample(500)] }).gate.pass, true);
  assert.equal(summarize({ ...common, coldSamples: [sample(501)], warmSamples: [sample(300)] }).gate.pass, false);
  assert.equal(summarize({ ...common, coldSamples: [sample(300, false)], warmSamples: [sample(300)] }).gate.pass, false);
});

test("SwiftShader evidence is correctness-only and cannot claim the launch target", () => {
  const result = summarize({
    scenePath: "C:\\scene\\vkf-scene.html",
    edgePath: "C:\\edge\\msedge.exe",
    gpuMode: "swiftshader",
    hostTrace: { available: false },
    coldSamples: [sample(100)],
    warmSamples: [sample(100)],
  });
  assert.equal(result.gate.pass, false);
  assert.match(result.gate.failures.join(" "), /correctness-only/u);
});

test("native host JSONL is incorporated when supplied", () => {
  const directory = mkdtempSync(join(tmpdir(), "vf-host-trace-test-"));
  const trace = join(directory, "trace.jsonl");
  try {
    writeFileSync(trace, [
      JSON.stringify({ schema: "vektor-flow/startup-trace-v1", stage: "process_start", elapsed_ms: 0 }),
      JSON.stringify({ schema: "vektor-flow/startup-trace-v1", stage: "content_revealed", elapsed_ms: 499.5 }),
      "",
    ].join("\n"));
    const parsed = parseHostTrace(trace);
    assert.equal(parsed.available, true);
    assert.equal(parsed.processToRevealMs, 499.5);
    assert.equal(parsed.gatePass, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
