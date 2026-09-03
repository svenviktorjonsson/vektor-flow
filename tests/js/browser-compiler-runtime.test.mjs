import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createBrowserCompiler } from "../../web/playground/vkf-browser-compiler.mjs";

const artifacts = new URL("../../web/playground/artifacts/", import.meta.url);

test("packaged browser compiler compiles source without a server", async () => {
  const [wasm, manifest] = await Promise.all([
    readFile(new URL("vkf-browser-compiler.wasm", artifacts)),
    readFile(new URL("vkf-browser-compiler.json", artifacts), "utf8").then(JSON.parse),
  ]);
  const { instance } = await WebAssembly.instantiate(wasm);
  const compiler = createBrowserCompiler({ instance, manifest });
  const result = compiler.compile(
    "base: 40\nfirst: base + 1\nsecond: first + 1\nsecond + 1",
  );
  assert.equal(result.name, "$entry");
  assert.deepEqual(result.opcodes, [1, 1, 2, 1, 2, 1, 2, 3]);
  assert.deepEqual(result.values, [40, 1, 0, 1, 0, 1, 0, 0]);
  assert.equal(result.max_stack, 2);
  assert.equal(compiler.run(
    "base: 40\nfirst: base + 1\nsecond: first + 1\nsecond + 1",
  ), 43);
});

test("browser compiler fails clearly on unsupported source", async () => {
  const [wasm, manifest] = await Promise.all([
    readFile(new URL("vkf-browser-compiler.wasm", artifacts)),
    readFile(new URL("vkf-browser-compiler.json", artifacts), "utf8").then(JSON.parse),
  ]);
  const { instance } = await WebAssembly.instantiate(wasm);
  const compiler = createBrowserCompiler({ instance, manifest });
  assert.throws(
    () => compiler.compile("not yet part of the tracer"),
    /browser compiler rejected the VKF source/u,
  );
});
