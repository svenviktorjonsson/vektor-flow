import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createSymbolicKernel } from "../../web/vf-ui/vf-symbolic-kernel-runtime.mjs";

const compilerPromise = (async () => {
  const module = new WebAssembly.Module(await readFile(new URL("../../build/shared-compiler/vkf-compiler.wasm", import.meta.url)));
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const { exports: compiler } = await WebAssembly.instantiate(module);
  compiler._initialize?.();
  return compiler;
})();

async function execute(source, expected) {
  const directory = await mkdtemp(fileURLToPath(new URL("../../build/shared-call-execution-", import.meta.url)));
  const sourcePath = path.join(directory, "program.vkf");
  const executable = path.join(directory, process.platform === "win32" ? "program.exe" : "program");
  await writeFile(sourcePath, source);
  const compiled = spawnSync(process.env.VKF_NATIVE_COMPILER ?? fileURLToPath(new URL("../../build/native-compiler-docker/bin/vkf-strict", import.meta.url)),
    [sourcePath, "-o", executable], { encoding: "utf8", timeout: 30_000, windowsHide: true });
  assert.equal(compiled.error, undefined, compiled.error?.message);
  assert.equal(compiled.status, 0, compiled.stderr);
  const native = spawnSync(executable, [], { encoding: "utf8", timeout: 30_000, windowsHide: true });
  assert.equal(native.error, undefined, native.error?.message);
  assert.equal(native.status, 0, native.stderr);
  assert.equal(native.stdout, expected.map(String).join("\n") + "\n");
  const compiler = await compilerPromise;
  const encoded = new TextEncoder().encode(source);
  const pointer = compiler.malloc(encoded.length);
  try {
    new Uint8Array(compiler.memory.buffer, pointer, encoded.length).set(encoded);
    assert.equal(compiler.vkf_compile_source(pointer, encoded.length), 0);
    const status = compiler.vkf_emit_program();
    const response = JSON.parse(new TextDecoder().decode(new Uint8Array(compiler.memory.buffer,
      compiler.vkf_result_pointer(), compiler.vkf_result_length())));
    assert.equal(status, 0, response.message);
    assert.ok(Object.keys(response.manifest.functions).every(name => !name.startsWith("$vkf_default$")),
      "private default functions must not change the public function manifest");
    const program = new WebAssembly.Module(new Uint8Array(compiler.memory.buffer,
      compiler.vkf_program_pointer(), compiler.vkf_program_length()).slice());
    assert.deepEqual(WebAssembly.Module.imports(program), []);
    const kernel = createSymbolicKernel({ instance: await WebAssembly.instantiate(program), manifest: response.manifest });
    assert.deepEqual(kernel.invokeValue("$vkf_main", []), expected);
    assert.deepEqual(kernel.invokeValue("$vkf_main", []), expected, "repeat calls reset output");
  } finally { compiler.free(pointer); }
}

test("shared calls bind named and mixed operands by parameter name", async () => {
  await execute(`weighted(x:num, y:num, z:num) -> num: x * 100 + y * 10 + z
:: weighted(y:4, x:3, z:5)
:: weighted(3, z:5, y:4)
`, [345, 345]);
});

test("missing defaults see earlier callee parameters rather than caller bindings", async () => {
  await execute(`f(x:num=2, y:num=x+1, z:num=y+1) -> num: x+y+z
x: 100
y: 200
:: f()
:: f(5)
:: f(y:4)
`, [9, 18, 11]);
});

test("supplied positional or named arguments do not execute a failing default", async () => {
  await execute(`f(x:num=(0)?!) -> num: x
:: f(1)
:: f(x:2)
`, [1, 2]);
});
