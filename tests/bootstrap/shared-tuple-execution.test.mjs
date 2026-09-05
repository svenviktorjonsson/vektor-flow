import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {createSharedCompiler} from '../../web/playground/vkf-shared-compiler.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const nativeCompiler = process.env.VKF_NATIVE_COMPILER
  ?? path.join(root, 'build/native-compiler-docker/bin/vkf-strict');
const module = new WebAssembly.Module(
  await readFile(path.join(root, 'build/shared-compiler/vkf-compiler.wasm')),
);
const compiler = createSharedCompiler({instance: new WebAssembly.Instance(module)});

test('tuples remain distinct from vectors through updates, access and exact output', () => {
  const source = `pair: (3, 4)
pair.0: 8

point: (name:"origin", x:3, y:4)
point.z: 5

:: pair
:: [8, 4]
:: pair.0 + pair.1
:: point.name
:: point.x + point.y + point.z
`;
  const native = spawnSync(nativeCompiler, ['-e', source], {
    encoding: 'utf8', timeout: 30_000, windowsHide: true,
  });
  assert.equal(native.error, undefined, native.error?.message);
  assert.equal(native.status, 0, native.stderr);
  assert.equal(native.stdout, '(8, 4)\n[8, 4]\n12\norigin\n12\n');

  const shared = compiler.run(source);
  assert.deepEqual(Object.keys(shared).sort(), ['kind', 'stderr', 'stdout']);
  assert.equal(shared.stdout, native.stdout);
  assert.equal(shared.stderr, native.stderr);
});
