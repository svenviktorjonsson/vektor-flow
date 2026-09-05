import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {createSharedCompiler} from '../../web/playground/vkf-shared-compiler.mjs';

const module = new WebAssembly.Module(await readFile(new URL('../../build/shared-compiler/vkf-compiler.wasm', import.meta.url)));
const compiler = createSharedCompiler({instance: new WebAssembly.Instance(module)});

test('shared execution returns only compiler-formatted output, never language values or handles', () => {
  const source = ':: 42\n:: true\n:: [1,2]\n:: (x:3, label:"hi")\n';
  const result = compiler.run(source);
  assert.deepEqual(Object.keys(result).sort(), ['kind', 'stderr', 'stdout']);
  assert.equal(result.kind, 'console');
  assert.equal(result.stdout, '42\ntrue\n[1, 2]\n(x:3, label:hi)\n');
  assert.equal(result.stderr, '');
  assert.deepEqual(compiler.run(source), result, 'a new execution resets output');
});

test('shared execution never decodes tagged WASM values in JavaScript', () => {
  const original = DataView.prototype.getUint32;
  try {
    DataView.prototype.getUint32 = function () {
      throw new Error('JavaScript attempted to inspect a tagged VKF value');
    };
    assert.equal(compiler.run(':: [2,4,6]\n').stdout, '[2, 4, 6]\n');
  } finally {
    DataView.prototype.getUint32 = original;
  }
});

test('tuples remain inside WASM and expose only compiler-formatted output', () => {
  const result = compiler.run(':: (3,4)\n');
  assert.deepEqual(Object.keys(result).sort(), ['kind', 'stderr', 'stdout']);
  assert.equal(result.stdout, '(3, 4)\n');
  assert.equal(result.stderr, '');
  assert.deepEqual(Object.keys(compiler.run(':: 7\n')).sort(), ['kind', 'stderr', 'stdout']);
});
