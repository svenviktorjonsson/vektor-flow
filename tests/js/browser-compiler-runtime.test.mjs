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

test("procedural complex p coordinates retain at least 100 inferred 2D positions", async () => {
  const [wasm, manifest] = await Promise.all([
    readFile(new URL("vkf-browser-compiler.wasm", artifacts)),
    readFile(new URL("vkf-browser-compiler.json", artifacts), "utf8").then(JSON.parse),
  ]);
  const { instance } = await WebAssembly.instantiate(wasm);
  const compiler = createBrowserCompiler({ instance, manifest });
  const source = [
    ": .ui.display",
    ":.math",
    "display: Display()",
    "frame: display.add_frame(pos:[0, 0], size:[1, 1])",
    "frame.add(p_u:num([..512] / 256 - 1, 0.85 * sin(([..512] / 256 - 1) * pi)), id:\"complex-line\", color:[0.12, 0.72, 1, 1])",
  ].join("\n");
  const output = compiler.run(source);

  assert.equal(output.kind, "visual");
  assert.equal(output.packet_records.length, 1);
  const packet = output.packet_records[0];
  assert.equal(packet.version, 6);
  assert.equal(packet.dimension, 2);
  assert.equal(packet.rows, 1);
  assert.equal(packet.columns, 513);
  assert.ok(packet.rows * packet.columns >= 100);
  assert.equal(packet.x[0][0], -1);
  assert.equal(packet.x[0][256], 0);
  assert.equal(packet.x[0][512], 1);
  assert.ok(Math.abs(packet.y[0][0]) < 2e-8);
  assert.ok(Math.abs(packet.y[0][128] + 0.85) < 1e-12);
  assert.ok(Math.abs(packet.y[0][256]) < 1e-12);
  assert.ok(Math.abs(packet.y[0][384] - 0.85) < 1e-12);
  assert.ok(Math.abs(packet.y[0][512]) < 2e-8);
  assert.deepEqual(packet.x_axes, ["u"]);
  assert.deepEqual(packet.y_axes, ["u"]);
  assert.equal("z" in packet, false);

  const edited = compiler.run(source.replaceAll("512", "128").replaceAll("256", "64"));
  assert.equal(edited.packet_records[0].columns, 129);
  assert.deepEqual([
    edited.packet_records[0].x[0][0], edited.packet_records[0].x[0][64],
    edited.packet_records[0].x[0][128],
  ], [-1, 0, 1]);
  assert.throws(
    () => compiler.run(source.replace("[..512]", "[..511]")),
    /browser compiler could not run the VKF source/u,
  );
  assert.throws(
    () => compiler.run(source.replace(":.math\n", "")),
    /browser compiler could not run the VKF source/u,
  );
  assert.throws(
    () => compiler.run(source.replace(":.math", ":.math\npi: 4")),
    /browser compiler could not run the VKF source/u,
  );
  assert.throws(
    () => compiler.run(source.replace(":.math", ":.math\nsin(value:num) -> num: 0")),
    /browser compiler could not run the VKF source/u,
  );
  assert.throws(
    () => compiler.run(source.replaceAll("512", "2049")),
    /browser compiler could not run the VKF source/u,
  );
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
