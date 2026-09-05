import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createBrowserCompiler } from "../../web/playground/vkf-browser-compiler.mjs";

const artifacts = new URL("../../web/playground/artifacts/", import.meta.url);

test("packaged browser compiler has no host imports", async () => {
  const wasm = await readFile(new URL("vkf-browser-compiler.wasm", artifacts));
  const module = new WebAssembly.Module(wasm);

  assert.deepEqual(WebAssembly.Module.imports(module), []);
});

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

test("packaged browser compiler runs grouped VKF arithmetic inside WASM", async () => {
  const [wasm, manifest] = await Promise.all([
    readFile(new URL("vkf-browser-compiler.wasm", artifacts)),
    readFile(new URL("vkf-browser-compiler.json", artifacts), "utf8").then(JSON.parse),
  ]);
  const { instance } = await WebAssembly.instantiate(wasm);
  const compiler = createBrowserCompiler({ instance, manifest });

  assert.equal(
    compiler.run("value: 100\n:: (value - (20 + 4) * 2) // (3 + 1)"),
    13,
  );
});

test("packaged browser compiler runs the README native function example", async () => {
  const [wasm, manifest] = await Promise.all([
    readFile(new URL("vkf-browser-compiler.wasm", artifacts)),
    readFile(new URL("vkf-browser-compiler.json", artifacts), "utf8").then(JSON.parse),
  ]);
  const { instance } = await WebAssembly.instantiate(wasm);
  const compiler = createBrowserCompiler({ instance, manifest });
  const source = await readFile(
    new URL("../../examples/native_core/hello_native.vkf", import.meta.url),
    "utf8",
  );

  assert.equal(compiler.run(source), 42);
});

test("complex p coordinates become inferred 2D x and y channels", async () => {
  const [wasm, manifest] = await Promise.all([
    readFile(new URL("vkf-browser-compiler.wasm", artifacts)),
    readFile(new URL("vkf-browser-compiler.json", artifacts), "utf8").then(JSON.parse),
  ]);
  const { instance } = await WebAssembly.instantiate(wasm);
  const compiler = createBrowserCompiler({ instance, manifest });
  const output = compiler.run([
    ": .ui.display",
    "display: Display()",
    "frame: display.add_frame(pos:[0, 0], size:[1, 1])",
    "frame.add(p_u:[num(-3, -0.12), num(-2, -0.92), num(-1, -0.86), num(0, -0.03), num(1, 0.82), num(2, 0.88), num(3, 0.09)], id:\"complex-line\", color:[0.12, 0.72, 1, 1])",
  ].join("\n"));

  assert.equal(output.kind, "visual");
  assert.equal(output.packet_records.length, 1);
  const packet = output.packet_records[0];
  assert.equal(packet.version, 6);
  assert.equal(packet.dimension, 2);
  assert.equal(packet.rows, 1);
  assert.equal(packet.columns, 7);
  assert.deepEqual(packet.x, [[-3, -2, -1, 0, 1, 2, 3]]);
  assert.deepEqual(packet.y, [[-0.12, -0.92, -0.86, -0.03, 0.82, 0.88, 0.09]]);
  assert.deepEqual(packet.x_axes, ["u"]);
  assert.deepEqual(packet.y_axes, ["u"]);
  assert.equal("z" in packet, false);
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

test("browser compiler rejects unavailable host capabilities before execution", async () => {
  const [wasm, manifest] = await Promise.all([
    readFile(new URL("vkf-browser-compiler.wasm", artifacts)),
    readFile(new URL("vkf-browser-compiler.json", artifacts), "utf8").then(JSON.parse),
  ]);
  const { instance } = await WebAssembly.instantiate(wasm);
  const compiler = createBrowserCompiler({ instance, manifest });

  assert.throws(
    () => compiler.run(':: fetch("https://example.com")'),
    /browser runtime does not expose network capability/u,
  );
  assert.throws(
    () => compiler.run(':: filesystem.read("secret")'),
    /browser runtime does not expose filesystem capability/u,
  );
});
