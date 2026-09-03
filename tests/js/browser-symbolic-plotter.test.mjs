import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createSymbolicKernel } from "../../web/vf-ui/vf-symbolic-kernel-runtime.mjs";
import { createBrowserSymbolicPlotter } from "../../web/playground/vkf-browser-symbolic-plotter.mjs";

const artifacts = new URL("../../web/vf-ui/artifacts/", import.meta.url);

async function createPlotter() {
  const [wasm, manifest] = await Promise.all([
    readFile(new URL("vkf-symbolic-kernel.wasm", artifacts)),
    readFile(new URL("vkf-symbolic-kernel.json", artifacts), "utf8").then(JSON.parse),
  ]);
  const { instance } = await WebAssembly.instantiate(wasm);
  return createBrowserSymbolicPlotter(createSymbolicKernel({ instance, manifest }));
}

test("browser plotter batches each 3D surface through one WASM plot call", () => {
  let plotCalls = 0;
  const kernel = {
    createWorkspace: () => ({ handle: "workspace" }),
    compile: () => ({ handle: "program", value: { context: {} } }),
    plot: () => {
      plotCalls += 1;
      return {
        count: 3,
        stride: 24,
        data: new Float32Array([
          -1, -1, 0, 0, 0, 0.5,
          1, -1, 0, 0, 0, 0.5,
          0, 1, 0, 0, 0, 0.5,
        ]),
      };
    },
    evaluateAt: () => assert.fail("surface sampling must remain inside the WASM batch"),
  };
  const plotter = createBrowserSymbolicPlotter(kernel);

  const surface = plotter.surface(kernel.compile("x+y"));

  assert.equal(plotCalls, 1);
  assert.equal(surface.count, 3);
  assert.deepEqual([...surface.data], [-1, -1, 0, 1, -1, 0, 0, 1, 0]);
});

test("browser plotter compiles and evaluates a static curve inside WASM", async () => {
  const plotter = await createPlotter();
  const program = plotter.compile("sin(x)");
  const plot = plotter.plot(program, { t: 0 });
  assert.equal(plot.stride, 24);
  assert.ok(plot.count >= 129);
  const center = Math.floor(plot.count / 2) * 6;
  assert.ok(Math.abs(plot.data[center]) < 0.1);
  assert.ok(Math.abs(plot.data[center + 1]) < 0.1);
});

test("browser plotter recomputes temporal curves from t in WASM", async () => {
  const plotter = await createPlotter();
  const program = plotter.compile("sin(x-t)");
  const atZero = plotter.plot(program, { t: 0 });
  const atOne = plotter.plot(program, { t: 1 });
  const center = Math.floor(atZero.count / 2) * 6 + 1;
  assert.ok(Math.abs(atZero.data[center]) < 0.1);
  assert.ok(atOne.data[center] < -0.7);
});

test("browser plotter samples a 3D surface inside WASM", async () => {
  const plotter = await createPlotter();
  const program = plotter.compile("sin(x)*cos(y)");
  const surface = plotter.surface(program, { t: 0 });

  assert.equal(surface.stride, 12);
  assert.equal(surface.count, (surface.xSteps - 1) * (surface.ySteps - 1) * 6);
  let center = 0;
  for (let offset = 0; offset < surface.data.length; offset += 3) {
    if (
      Math.abs(surface.data[offset]) + Math.abs(surface.data[offset + 1])
      < Math.abs(surface.data[center]) + Math.abs(surface.data[center + 1])
    ) center = offset;
  }
  assert.ok(Math.abs(surface.data[center]) < 0.001);
  assert.ok(Math.abs(surface.data[center + 1]) < 0.001);
  assert.ok(Math.abs(surface.data[center + 2]) < 0.001);
});

test("browser plotter recomputes temporal 3D surfaces from t in WASM", async () => {
  const plotter = await createPlotter();
  const program = plotter.compile("sin(x-t)+cos(y)");
  const atZero = plotter.surface(program, { t: 0 });
  const atQuarterTurn = plotter.surface(program, { t: Math.PI / 2 });
  let center = 0;
  for (let offset = 0; offset < atZero.data.length; offset += 3) {
    if (
      Math.abs(atZero.data[offset]) + Math.abs(atZero.data[offset + 1])
      < Math.abs(atZero.data[center]) + Math.abs(atZero.data[center + 1])
    ) center = offset;
  }
  center += 2;

  assert.ok(Math.abs(atZero.data[center] - 1) < 0.001);
  assert.ok(Math.abs(atQuarterTurn.data[center]) < 0.001);
});
