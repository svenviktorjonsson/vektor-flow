import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {createSharedCompiler} from '../../web/playground/vkf-shared-compiler.mjs';

test('WASM console uses the exact native scalar, vector and source-order output modes', async () => {
  const module = new WebAssembly.Module(await readFile(new URL('../../build/shared-compiler/vkf-compiler.wasm', import.meta.url)));
  const compiler = createSharedCompiler({instance: new WebAssembly.Instance(module)});
  for (const source of [
    ':: 0.1\n:: -0.0\n:: 1.2345678901234567\n',
    ':: [0.1, 0.2]\n:: [[0.1, 0.2], [0.3, 0.4]]\n',
    'f(value:num) -> num:\n    :: value\n    value + 1\n:: f(0.1)\n',
    'unused() -> num:\n    :: 1\n    2\n:: 0.1\n',
    ':: "first"\n:: "second"\n',
  ]) {
    const native = spawnSync(process.env.VKF_NATIVE_COMPILER ?? fileURLToPath(new URL('../../build/native-compiler-docker/bin/vkf-strict', import.meta.url)),
      ['-e', source], {encoding: 'utf8', timeout: 30_000, windowsHide: true});
    assert.equal(native.error, undefined, native.error?.message);
    assert.equal(native.status, 0, native.stderr);
    const result = compiler.run(source);
    assert.equal(result.stdout, native.stdout, source);
    assert.equal(result.stderr, native.stderr, source);
  }
});

test('record console output matches fresh native field order and nested syntax', async () => {
  const source = ':: (x:1, label:"hi", nested:(enabled:true, samples:[2,3]))\n';
  const directory = await mkdtemp(fileURLToPath(new URL('../../build/shared-record-console-', import.meta.url)));
  const sourcePath = path.join(directory, 'program.vkf');
  await writeFile(sourcePath, source);
  const native = spawnSync(process.env.VKF_NATIVE_COMPILER ?? fileURLToPath(new URL('../../build/native-compiler-docker/bin/vkf-strict', import.meta.url)),
    [sourcePath, '-o', path.join(directory, 'program')], {encoding:'utf8', timeout:30_000, windowsHide:true});
  assert.equal(native.error, undefined, native.error?.message);
  assert.equal(native.status, 0, native.stderr);
  const module = new WebAssembly.Module(await readFile(new URL('../../build/shared-compiler/vkf-compiler.wasm', import.meta.url)));
  const compiler = createSharedCompiler({instance:new WebAssembly.Instance(module)});
  assert.equal(compiler.run(source).stdout, native.stdout);
  assert.equal(compiler.run(source).stderr, native.stderr);
});
