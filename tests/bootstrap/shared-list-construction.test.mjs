import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile, mkdtemp, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import test from 'node:test';
import {createSharedCompiler} from '../../web/playground/vkf-shared-compiler.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const module = new WebAssembly.Module(await readFile(path.join(root, 'build/shared-compiler/vkf-compiler.wasm')));
const compiler = createSharedCompiler({instance: new WebAssembly.Instance(module)});

test('native numeric list construction and reductions execute unchanged in WASM', async () => {
  const source = `c: .collections
:: stat.sum(collections.list())
:: stat.count(collections.list())
:: c.list(1, 2, 3)
:: stat.std(collections.list(2, 4, 4, 4, 5, 5, 7, 9))
:: stat.variance(collections.list(-2, 0, 2), ddof:1)
:: stat.sum(collections.list(${Array.from({length:101}, (_, i) => i).join(',')}))
`;
  const directory = await mkdtemp(path.join(root, 'build/shared-list-test-'));
  const unit = path.join(directory, 'case.vkf');
  await writeFile(unit, source);
  const native = spawnSync(path.join(root, 'build/native-compiler-docker/bin/vkf-strict'),
    [unit, '-o', path.join(directory, 'case')], {encoding:'utf8', timeout:30_000, windowsHide:true});
  assert.equal(native.error, undefined, native.error?.message);
  assert.equal(native.status, 0, native.stderr);
  assert.equal(native.stdout, '0\n0\n[1, 2, 3]\n2\n4\n5050\n');
  const result = compiler.run(source);
  assert.equal(result.stdout, native.stdout);
  assert.equal(result.stderr, native.stderr);
});
