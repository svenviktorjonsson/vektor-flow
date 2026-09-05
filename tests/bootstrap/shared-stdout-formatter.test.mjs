import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = await mkdtemp(path.join(os.tmpdir(), 'vkf-stdout-format-'));
const sourcePath = path.join(root, 'tests/bootstrap/fixtures/stdout-formatter.cpp');
const nativePath = path.join(directory, 'formatter');
const wasmPath = path.join(directory, 'formatter.wasm');
const nativeBuild = spawnSync(process.env.CXX ?? 'g++', ['-std=c++17', '-O0', `-I${root}`,
  sourcePath, '-o', nativePath], {encoding: 'utf8', timeout: 30_000});

function memoryFor(values) {
  const memory = new Uint8Array(65536);
  const view = new DataView(memory.buffer);
  let cursor = 0;
  function allocate(length) {const pointer = cursor; cursor += length; return pointer;}
  function value(item) {
    const pointer = allocate(16);
    if (item === null) return pointer;
    if (typeof item === 'number') {view.setUint32(pointer, 2, true); view.setFloat64(pointer + 8, item, true); return pointer;}
    if (typeof item === 'boolean') {view.setUint32(pointer, 1, true); view.setUint32(pointer + 8, +item, true); return pointer;}
    if (typeof item === 'string') {
      const text = new TextEncoder().encode(item); const payload = allocate(text.length);
      view.setUint32(pointer, 3, true); view.setUint32(pointer + 4, text.length, true); view.setUint32(pointer + 8, payload, true);
      memory.set(text, payload); return pointer;
    }
    if (Array.isArray(item)) {
      const payload = allocate(item.length * 4);
      view.setUint32(pointer, 4, true); view.setUint32(pointer + 4, item.length, true); view.setUint32(pointer + 8, payload, true);
      item.forEach((child, index) => view.setUint32(payload + 4 * index, value(child), true));
      return pointer;
    }
    const entries = Object.entries(item);
    const payload = allocate(entries.length * 8);
    view.setUint32(pointer, 5, true); view.setUint32(pointer + 4, entries.length, true); view.setUint32(pointer + 8, payload, true);
    entries.forEach(([key, child], index) => {
      view.setUint32(payload + 8 * index, value(key), true);
      view.setUint32(payload + 8 * index + 4, value(child), true);
    });
    return pointer;
  }
  assert.equal(value(values), 0);
  return memory.slice(0, cursor);
}

function nativeVKF(source) {
  const run = spawnSync(path.join(root, 'build/native-compiler-docker/bin/vkf-strict'), ['-e', source],
    {encoding: 'utf8', timeout: 30_000});
  assert.equal(run.error, undefined, run.error?.message);
  assert.equal(run.status, 0, run.stderr);
  return run.stdout;
}

test('tagged-memory console formatting matches native scalar, string and vector output exactly', () => {
  assert.equal(nativeBuild.status, 0, nativeBuild.stderr);
  const values = [0.1, 1.2345678901234567, -0, 0.0000001, 'hello', ['a\nb', 'a"b'], [[0.1, -0], [0.2, 0.3]], true, null];
  const source = ':: 0.1\n:: 1.2345678901234567\n:: -0.0\n:: 0.0000001\n:: "hello"\n:: ["a\\nb", "a\\\"b"]\n:: [[0.1,-0.0],[0.2,0.3]]\n:: true\n:: null\n';
  const formatted = spawnSync(nativePath, [], {input: memoryFor(values), encoding: 'utf8'});
  assert.equal(formatted.status, 0, formatted.stdout);
  assert.equal(formatted.stdout, nativeVKF(source));
});

test('tagged-memory records retain native field order and nested display syntax', () => {
  assert.equal(nativeBuild.status, 0, nativeBuild.stderr);
  const values = [{x: 1, label: 'hi', nested: {enabled: true, samples: [2, 3]}}];
  const source = ':: (x:1, label:"hi", nested:(enabled:true, samples:[2,3]))\n';
  const formatted = spawnSync(nativePath, [], {input: memoryFor(values), encoding: 'utf8'});
  assert.equal(formatted.status, 0, formatted.stdout);
  assert.equal(formatted.stdout, nativeVKF(source));
});

test('WASM formatter uses the native numeric modes without losing signed zero or binary precision', async () => {
  assert.equal(nativeBuild.status, 0, nativeBuild.stderr);
  if (!process.env.VKF_STDOUT_FORMATTER_WASM) {
    const compiled = spawnSync(process.env.EMXX ?? 'em++', ['-std=c++17', '-O1', `-I${root}`,
    sourcePath, path.join(root, 'compiler/native/vkf_browser_host_policy.cpp'), '-fwasm-exceptions', '--no-entry',
    '-sSTANDALONE_WASM=1', '-sFILESYSTEM=0',
    '-sEXPORTED_FUNCTIONS=["_format_buffer","_result_pointer","_result_length","_malloc","_free"]',
    '-o', wasmPath], {encoding: 'utf8', timeout: 120_000});
    assert.equal(compiled.status, 0, compiled.stderr ?? compiled.error?.message);
  }
  const module = new WebAssembly.Module(await readFile(process.env.VKF_STDOUT_FORMATTER_WASM ?? wasmPath));
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const api = (await WebAssembly.instantiate(module)).exports;
  api._initialize?.();
  function format(memory, ordered = false) {
    const pointer = api.malloc(memory.length);
    try {
      new Uint8Array(api.memory.buffer, pointer, memory.length).set(memory);
      const status = api.format_buffer(pointer, memory.length, 0, +ordered);
      const text = new TextDecoder().decode(new Uint8Array(api.memory.buffer, api.result_pointer(), api.result_length()));
      return {status, text};
    } finally { api.free(pointer); }
  }
  for (const ordered of [false, true]) {
    const memory = memoryFor([0.1, -0, 1.2345678901234567, 0.0000001, [[0.1, -0], [0.2, 0.3]], 'hello\nworld']);
    const native = spawnSync(nativePath, ordered ? ['ordered'] : [], {input: memory, encoding: 'utf8'});
    assert.equal(native.status, 0, native.stdout);
    assert.deepEqual(format(memory, ordered), {status: 0, text: native.stdout});
  }
  const orderedSource = 'emit() -> num:\n    :: 0.1\n    1.2345678901234567\n:: emit()\n';
  assert.equal(format(memoryFor([0.1, 1.2345678901234567]), true).text, nativeVKF(orderedSource));
  const sine = nativeVKF(':: math.sin(1)\n');
  assert.equal(format(memoryFor([Number(sine.trim())])).text, sine, 'format the exact native result bits; do not reevaluate sin in JS');
  const nonfinite = memoryFor([Infinity, NaN]);
  const nonfiniteView = new DataView(nonfinite.buffer);
  const second = nonfiniteView.getUint32(nonfiniteView.getUint32(8, true) + 4, true);
  nonfiniteView.setBigUint64(second + 8, 0xfff8000000000000n, true);
  assert.equal(format(nonfinite).text, nativeVKF(':: 1 / 0\n:: 0 / 0\n'));

  const invalid = memoryFor([1]);
  new DataView(invalid.buffer).setUint32(8, invalid.length, true);
  assert.deepEqual(format(invalid), {status: 1, text: 'VKF stdout value addressed invalid WASM memory'});
  const cyclic = memoryFor([[]]);
  const cycleView = new DataView(cyclic.buffer);
  cycleView.setUint32(cycleView.getUint32(8, true), 0, true);
  assert.deepEqual(format(cyclic), {status: 1, text: 'cyclic VKF values cannot cross the stdout ABI'});
  const unknown = memoryFor([1]);
  const unknownView = new DataView(unknown.buffer);
  unknownView.setUint32(unknownView.getUint32(unknownView.getUint32(8, true), true), 99, true);
  assert.deepEqual(format(unknown), {status: 1, text: 'unknown VKF stdout value tag 99'});
  assert.equal(format(memoryFor([0.1])).text, '0.10000000000000001\n', 'a rejected result does not poison the formatter');
});
