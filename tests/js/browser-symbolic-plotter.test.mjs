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
