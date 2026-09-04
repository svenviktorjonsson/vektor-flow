import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createInlineRunner } from "../../web/inline-runner.mjs";
import { createInlineExampleController } from "../../web/inline-example-controller.mjs";
import { materializeVisualOutput } from "../../web/inline-result-packets.mjs";
import { renderInlineResult } from "../../web/inline-result-renderer.mjs";

test("inline runner fetches only fixed static artifacts and sends bytes to a worker", async () => {
  const requests = [];
  const messages = [];
  class WorkerStub {
    constructor(url, options) {
      this.url = url;
      this.options = options;
      WorkerStub.instances.push(this);
    }
    postMessage(message) {
      messages.push(message);
      queueMicrotask(() => this.onmessage({ data: { id: message.id, status: "ok", output: 42 } }));
    }
    terminate() { this.terminated = true; }
  }
  WorkerStub.instances = [];
  const runner = createInlineRunner({
    fetchImpl: async (url) => {
      requests.push(String(url));
      return String(url).endsWith(".wasm")
        ? { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }
        : { ok: true, json: async () => ({ schema: "test" }) };
    },
    WorkerClass: WorkerStub,
    timeoutMs: 100,
  });

  assert.deepEqual(await runner.run(":: 40 + 2"), { output: 42, packets: null });
  assert.equal(requests.length, 2);
  assert.ok(requests.every((url) => /vkf-browser-compiler\.(?:wasm|json)$/u.test(url)));
  assert.equal(messages[0].source, ":: 40 + 2");
  assert.ok(messages[0].wasm instanceof ArrayBuffer);
  assert.equal(messages[0].imports, undefined);
  assert.equal(WorkerStub.instances[0].terminated, true);
});

test("inline runner terminates an unresponsive worker", async () => {
  class WorkerStub {
    constructor() { WorkerStub.instance = this; }
    postMessage() {}
    terminate() { this.terminated = true; }
  }
  const runner = createInlineRunner({
    fetchImpl: async (url) => String(url).endsWith(".wasm")
      ? { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }
      : { ok: true, json: async () => ({ schema: "test" }) },
    WorkerClass: WorkerStub,
    timeoutMs: 5,
  });

  await assert.rejects(() => runner.run(":: while true"), /timed out; worker terminated/u);
  assert.equal(WorkerStub.instance.terminated, true);
});

test("worker materializes only validated WASM visual packets as typed buffers", () => {
  const output = materializeVisualOutput({
    kind: "visual",
    packet_records: [
      { magic: 1447773767, version: 1, color: [0.01, 0.02, 0.03, 1] },
      {
        magic: 1447773768, version: 1, pos: [4, -5, 3],
        target: [0, 0, 0], up: [0, 0, 1], fov: 42,
      },
      {
        magic: 1447773769, version: 1, pos: [2, -3, 5], target: [0, 0, 0],
        color: [1, 0.8, 0.6, 1], intensity: 24, range: 18,
        casts_shadow: true, source_radius: 0,
      },
      {
        magic: 1447773766, version: 5, rows: 1, columns: 1,
        color: [0.1, 0.2, 0.3, 1], x: [[2]], y: [[3]], z: [[4]],
        receives_lighting: true, casts_shadow: true,
        receives_shadow: false, roughness: 0.4, specular_strength: 0.7,
        texture: {
          magic: 1447773770, version: 1, kind: "checker", scale: [7, 6],
          color_a: [0.03, 0.05, 0.09, 1], color_b: [0.28, 0.55, 0.9, 1],
          roughness: 1, blade_length: 0, clump_density: 0, micro_shadow: 0,
        },
      },
    ],
  });

  assert.equal(output.kind, "visual");
  assert.equal(output.packet_values, undefined);
  assert.equal(output.packets.length, 4);
  assert.ok(output.packets[3] instanceof Float64Array);
  assert.deepEqual([...output.packets[0]], [1447773767, 1, 0.01, 0.02, 0.03, 1]);
  assert.deepEqual([...output.packets[1]], [
    1447773768, 1, 4, -5, 3, 0, 0, 0, 0, 0, 1, 42,
  ]);
  assert.deepEqual([...output.packets[3]], [
    1447773766, 5, 1, 1, 0.1, 0.2, 0.3, 1, 1, 1, 0, 0.4, 0.7,
    1, 7, 6, 0.03, 0.05, 0.09, 1, 0.28, 0.55, 0.9, 1, 1, 0, 0, 0,
    2, 3, 4,
  ]);
  assert.throws(
    () => materializeVisualOutput({
      kind: "visual",
      packet_records: [{
        magic: 1447773766, version: 5, rows: 1, columns: 1,
        color: [0, 0, 0, 1], x: [[NaN]], y: [[0]], z: [[0]],
        receives_lighting: false, casts_shadow: false,
        receives_shadow: false, roughness: 1, specular_strength: 0,
      }],
    }),
    /invalid visual packet/u,
  );
});

test("worker rejects texture packets with fields outside the versioned contract", () => {
  assert.throws(() => materializeVisualOutput({
    kind: "visual",
    packet_records: [{
      magic: 1447773766, version: 5, rows: 1, columns: 1,
      color: [1, 1, 1, 1], x: [[0]], y: [[0]], z: [[0]],
      receives_lighting: false, casts_shadow: false, receives_shadow: false,
      roughness: 1, specular_strength: 0,
      texture: {
        magic: 1447773770, version: 1, kind: "checker", scale: [7, 6],
        color_a: [0, 0, 0, 1], color_b: [1, 1, 1, 1], roughness: 1,
        blade_length: 0, clump_density: 0, micro_shadow: 0, seed: 4,
      },
    }],
  }), /invalid texture packet/u);
});

test("worker materializes a strictly versioned transparent optical buffer", () => {
  const output = materializeVisualOutput({
    kind: "visual",
    packet_records: [{
      magic: 1447773766, version: 5, rows: 1, columns: 1,
      color: [0.08, 0.78, 0.96, 0.52], x: [[1]], y: [[2]], z: [[3]],
      receives_lighting: true, casts_shadow: true, receives_shadow: false,
      roughness: 0.1, specular_strength: 0.84, texture: [],
      optical: {
        magic: 1447773771, version: 1, alpha: 0.52,
        transparent: true, depth_write: false, reflectivity: 0.28,
      },
    }],
  });
  assert.deepEqual([...output.packets[0]], [
    1447773766, 6, 1, 1, 0.08, 0.78, 0.96, 0.52,
    1, 1, 0, 0.1, 0.84, 0.52, 1, 0, 0.28, 1, 2, 3,
  ]);
  assert.throws(() => materializeVisualOutput({
    kind: "visual",
    packet_records: [{
      magic: 1447773766, version: 5, rows: 1, columns: 1,
      color: [1, 1, 1, 1], x: [[0]], y: [[0]], z: [[0]],
      receives_lighting: false, casts_shadow: false, receives_shadow: false,
      roughness: 1, specular_strength: 0, texture: [],
      optical: {
        magic: 1447773771, version: 1, alpha: 0.5,
        transparent: true, depth_write: false, reflectivity: 0, ior: 1.5,
      },
    }],
  }), /invalid optical packet/u);
});

test("worker materializes a strictly versioned mirror surface buffer", () => {
  const record = {
    magic: 1447773766, version: 5, rows: 2, columns: 2,
    color: [0.72, 0.84, 1, 1],
    x: [[-3.2, 3.2], [-3.2, 3.2]],
    y: [[4.1, 4.1], [4.1, 4.1]], z: [[0.1, 0.1], [3.8, 3.8]],
    receives_lighting: true, casts_shadow: true, receives_shadow: true,
    roughness: 0.04, specular_strength: 0, texture: [],
    optical: {
      magic: 1447773771, version: 1, alpha: 1,
      transparent: true, depth_write: true, reflectivity: 0.9,
    },
    surface_system: {
      magic: 1447773773, version: 1, kind: "screen", reflectivity: 0.9,
      reverse_facing: true, flip_y: true, scale: [1, 1], camera_fov: 43,
      camera_up: [0, 0, 1], mirror_frame_id: "frame_0", mirror_mesh_id: "mirror",
      reflect_eye_only: true, lock_aperture_camera: true, controls_enabled: false,
    },
  };
  const output = materializeVisualOutput({ kind: "visual", packet_records: [record] });
  assert.deepEqual([...output.packets[0]], [
    1447773766, 7, 2, 2, 0.72, 0.84, 1, 1, 1, 1, 1, 0.04, 0,
    1, 1, 1, 0.9,
    1, 0.9, 1, 1, 1, 1, 43, 0, 0, 1, 3398114705, 801718722, 1, 1, 0,
    -3.2, 4.1, 0.1, 3.2, 4.1, 0.1, -3.2, 4.1, 3.8, 3.2, 4.1, 3.8,
  ]);
  assert.throws(() => materializeVisualOutput({
    kind: "visual",
    packet_records: [{
      ...record,
      surface_system: { ...record.surface_system, camera_mode: "legacy" },
    }],
  }), /invalid surface system packet/u);
});

test("trusted inline renderer projects and lights validated retained 3D packets", () => {
  const operations = [];
  const context = {
    beginPath: () => operations.push("begin"),
    clearRect: (...args) => operations.push(["clear", ...args]),
    fillRect: (...args) => operations.push(["fill", ...args]),
    lineTo: (...args) => operations.push(["line", ...args]),
    moveTo: (...args) => operations.push(["move", ...args]),
    stroke: () => operations.push("stroke"),
    set fillStyle(value) { operations.push(["fillStyle", value]); },
    set lineWidth(value) { operations.push(["lineWidth", value]); },
    set strokeStyle(value) { operations.push(["strokeStyle", value]); },
  };
  const canvas = { width: 320, height: 180, getContext: () => context };
  const camera = Float64Array.from([
    1447773768, 1, 4.2, -5.4, 3.5, 0, 0, 0.25, 0, 0, 1, 42,
  ]);
  const light = Float64Array.from([
    1447773769, 1, 2.8, -2.6, 5.2, 0, 0, 0,
    1, 0.88, 0.68, 1, 24, 18, 1, 0,
  ]);
  const packet = Float64Array.from([
    1447773766, 4, 1, 2, 0.1, 0.2, 0.3, 1, 1, 1, 0, 0.4, 0.7,
    1, 3, 5, 2, 4, 6,
  ]);
  const receiver = Float64Array.from([
    1447773766, 4, 1, 2, 0.3, 0.4, 0.5, 1, 1, 0, 1, 0.7, 0.2,
    -4, -2, 0, 4, 4, 0,
  ]);

  renderInlineResult(canvas, [camera, light, receiver, packet]);
  assert.ok(operations.some(([kind] = []) => kind === "fill"));
  assert.ok(operations.some(([kind, x, y] = []) => kind === "move"
    && Number.isFinite(x) && Number.isFinite(y)));
  assert.ok(operations.some(([kind] = []) => kind === "line"));
  assert.ok(operations.some(([kind, value] = []) => kind === "strokeStyle"
    && value !== "rgba(26, 51, 77, 1)"));
  assert.ok(operations.some(([kind, value] = []) => kind === "strokeStyle"
    && value.startsWith("rgba(0, 0, 0,")));
  assert.ok(operations.includes("stroke"));
});

test("trusted inline renderer draws source-scaled alternating checker cells", () => {
  const render = (scaleX, scaleY) => {
    const operations = [];
    const context = {
      beginPath: () => operations.push("begin"),
      closePath: () => operations.push("close"),
      clearRect: () => {}, fillRect: () => {},
      lineTo: (...args) => operations.push(["line", ...args]),
      moveTo: (...args) => operations.push(["move", ...args]),
      fill: () => operations.push("fill"), stroke: () => {},
      set fillStyle(value) { operations.push(["fillStyle", value]); },
      set lineWidth(_value) {}, set strokeStyle(_value) {},
    };
    const packet = Float64Array.from([
      1447773766, 5, 2, 2, 1, 1, 1, 1, 0, 0, 0, 1, 0,
      1, scaleX, scaleY,
      0.03, 0.05, 0.09, 1, 0.28, 0.55, 0.9, 1, 1, 0, 0, 0,
      -4, -2, 0, 4, -2, 0, -4, 4, 0, 4, 4, 0,
    ]);
    renderInlineResult({ width: 320, height: 180, getContext: () => context }, [packet]);
    return operations;
  };
  const large = render(7, 6);
  const changed = render(3, 4);
  assert.equal(large.filter((operation) => operation === "fill").length, 42);
  assert.equal(changed.filter((operation) => operation === "fill").length, 12);
  const colors = new Set(large.filter(([kind] = []) => kind === "fillStyle").map(([, value]) => value));
  assert.ok(colors.has("rgba(8, 13, 23, 1)"));
  assert.ok(colors.has("rgba(71, 140, 230, 1)"));
});

test("trusted inline renderer modulates grass from the validated material parameters", () => {
  const fillColors = [];
  const context = {
    beginPath: () => {}, closePath: () => {}, clearRect: () => {}, fillRect: () => {},
    lineTo: () => {}, moveTo: () => {}, fill: () => {}, stroke: () => {},
    set fillStyle(value) { fillColors.push(value); },
    set lineWidth(_value) {}, set strokeStyle(_value) {},
  };
  const packet = Float64Array.from([
    1447773766, 5, 2, 2, 1, 1, 1, 1, 1, 1, 1, 0.99, 0,
    2, 7, 7,
    0.025, 0.13, 0.02, 1, 0.28, 0.54, 0.09, 1, 0.99, 1.1, 1.2, 0.52,
    -9, -2, 0, 9, -2, 0, -9, 14, 0, 9, 14, 0,
  ]);
  renderInlineResult({ width: 320, height: 180, getContext: () => context }, [packet]);
  const grassColors = new Set(fillColors.slice(1));
  assert.equal(fillColors.slice(1).length, 49);
  assert.ok(grassColors.size > 8, "grass must be spatially modulated, not a two-color checker");
});

test("trusted inline renderer applies source alpha and reflectivity", () => {
  const render = (alpha, reflectivity) => {
    const strokes = [];
    const context = {
      beginPath: () => {}, clearRect: () => {}, fillRect: () => {},
      lineTo: () => {}, moveTo: () => {}, stroke: () => {},
      set fillStyle(_value) {}, set lineWidth(_value) {},
      set strokeStyle(value) { strokes.push(value); },
    };
    const packet = Float64Array.from([
      1447773766, 6, 1, 2, 0.08, 0.78, 0.96, 0.52,
      0, 0, 0, 0.1, 0.84, alpha, 1, 0, reflectivity,
      -1, 0, 0, 1, 0, 0,
    ]);
    renderInlineResult({ width: 320, height: 180, getContext: () => context }, [packet]);
    return strokes.at(-1);
  };
  assert.match(render(0.52, 0.28), /, 0\.52\)$/u);
  assert.match(render(0.22, 0.28), /, 0\.22\)$/u);
  assert.notEqual(render(0.52, 0.28), render(0.52, 0.48));
});

test("trusted inline renderer clips source-derived geometry into the mirror camera", () => {
  const render = (reflectivity, fov) => {
    const operations = [];
    const context = {
      beginPath: () => operations.push("begin"),
      closePath: () => operations.push("close"),
      clearRect: () => operations.push("clear"),
      fillRect: (...args) => operations.push(["fill", ...args]),
      lineTo: (...args) => operations.push(["line", ...args]),
      moveTo: (...args) => operations.push(["move", ...args]),
      stroke: () => operations.push("stroke"),
      save: () => operations.push("save"),
      clip: () => operations.push("clip"),
      restore: () => operations.push("restore"),
      set fillStyle(value) { operations.push(["fillStyle", value]); },
      set lineWidth(value) { operations.push(["lineWidth", value]); },
      set strokeStyle(value) { operations.push(["strokeStyle", value]); },
    };
    const background = Float64Array.from([1447773767, 1, 0.01, 0.015, 0.03, 1]);
    const camera = Float64Array.from([
      1447773768, 1, 5.2, -7.4, 4.2, 0, 1.2, 1.1, 0, 0, 1, 43,
    ]);
    const sculpture = Float64Array.from([
      1447773766, 4, 2, 2, 0.96, 0.22, 0.08, 1, 1, 1, 0, 0.24, 0.78,
      -1.5, 0.3, 0.2, 0.4, 1, 0.5, -1.1, 0.3, 2.7, 0.8, 1, 3,
    ]);
    const mirror = Float64Array.from([
      1447773766, 7, 2, 2, 0.72, 0.84, 1, 1, 1, 1, 1, 0.04, 0,
      1, 1, 1, 0.9,
      1, reflectivity, 1, 1, 1, 1, fov, 0, 0, 1,
      3398114705, 801718722, 1, 1, 0,
      -3.2, 4.1, 0.1, 3.2, 4.1, 0.1, -3.2, 4.1, 3.8, 3.2, 4.1, 3.8,
    ]);
    renderInlineResult(
      { width: 640, height: 360, getContext: () => context },
      [background, camera, sculpture, mirror],
    );
    return operations;
  };
  const initial = render(0.9, 43);
  const clip = initial.indexOf("clip");
  const restore = initial.indexOf("restore");
  assert.ok(clip > 0 && restore > clip);
  const clipped = initial.slice(clip, restore);
  const mirrorBackground = clipped.findIndex(([kind] = []) => kind === "fill");
  const reflectedStroke = clipped.indexOf("stroke");
  assert.ok(mirrorBackground >= 0 && reflectedStroke > mirrorBackground,
    "mirror background must be composited before reflected geometry");
  assert.ok(initial.slice(restore + 1).includes("stroke"), "mirror surface must draw after its reflection");
  const reflectedMove = (operations) => {
    const start = operations.indexOf("clip");
    const end = operations.indexOf("restore");
    return operations.slice(start, end).find(([kind] = []) => kind === "move");
  };
  const reflectedStyle = (operations) => {
    const start = operations.indexOf("clip");
    const end = operations.indexOf("restore");
    return operations.slice(start, end).find(([kind] = []) => kind === "strokeStyle");
  };
  assert.notDeepEqual(reflectedMove(initial), reflectedMove(render(0.9, 50)));
  assert.notDeepEqual(reflectedStyle(initial), reflectedStyle(render(0.6, 43)));
});

test("terminal always appears below the editor and Result appears only for validated visual output", async () => {
  const events = [];
  const view = {
    start: () => events.push("start"),
    showTerminal: (value) => events.push(["terminal", value]),
    hideResult: () => events.push("hide-result"),
    showResult: (packets) => events.push(["result", packets]),
    finish: () => events.push("finish"),
  };
  const consoleController = createInlineExampleController({
    runner: { run: async () => ({ output: 42, packets: null }) },
    view,
  });
  await consoleController.run(":: 40 + 2");
  assert.deepEqual(events, ["start", ["terminal", "42"], "hide-result", "finish"]);

  events.length = 0;
  const packets = [new Uint8Array([1, 2, 3])];
  const visualController = createInlineExampleController({
    runner: { run: async () => ({ output: { packets }, packets }) },
    view,
  });
  await visualController.run(": .ui.display");
  assert.deepEqual(events, ["start", ["terminal", "Program emitted UI output."], ["result", packets], "finish"]);
});

test("terminal renders VKF console values as one output line per emitted value", async () => {
  const terminal = [];
  const controller = createInlineExampleController({
    runner: {
      run: async () => ({
        output: { kind: "console", values: [[2, 4, 6], [[2, 4], [6, 8]]] },
        packets: null,
      }),
    },
    view: {
      start: () => {},
      showTerminal: (value) => terminal.push(value),
      hideResult: () => {},
      showResult: () => {},
      finish: () => {},
    },
  });

  await controller.run("complete README vector example");
  assert.deepEqual(terminal, ["[2,4,6]\n[[2,4],[6,8]]"]);
});

test("unsupported execution reports failure without a fallback Result", async () => {
  const events = [];
  const controller = createInlineExampleController({
    runner: { run: async () => { throw new Error("unsupported source"); } },
    view: {
      start: () => {},
      showTerminal: (value) => events.push(value),
      hideResult: () => events.push("hide-result"),
      showResult: () => events.push("result"),
      finish: () => {},
    },
  });

  await controller.run("not supported");
  assert.deepEqual(events, ["unsupported source. No fallback result was rendered.", "hide-result"]);
});

test("worker exposes no host capability imports or networking path", async () => {
  const worker = await readFile(new URL("../../web/inline-runner-worker.mjs", import.meta.url), "utf8");

  assert.match(worker, /WebAssembly\.Module\.imports\(module\)/u);
  assert.match(worker, /Object\.freeze\(\{\}\)/u);
  assert.match(worker, /materializeVisualOutput\(compiler\.run\(data\.source\)\)/u);
  assert.match(worker, /output\.packets\.map\(\(packet\) => packet\.buffer\)/u);
  assert.doesNotMatch(worker, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|process|localhost)\b/u);
  assert.doesNotMatch(worker, /\b(?:window|document|navigator)\b/u);
});
