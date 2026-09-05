import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import test from 'node:test';
import {createSharedCompiler} from '../../web/playground/vkf-shared-compiler.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const module = new WebAssembly.Module(await readFile(path.join(root, 'build/shared-compiler/vkf-compiler.wasm')));
const compiler = createSharedCompiler({instance: new WebAssembly.Instance(module)});

async function nativeOutput(source) {
  const directory = await mkdtemp(path.join(root, 'build/shared-if-expression-'));
  const unit = path.join(directory, 'case.vkf');
  await writeFile(unit, source);
  const run = spawnSync(path.join(root, 'build/native-compiler-docker/bin/vkf-strict'),
    [unit, '-o', path.join(directory, 'case')], {encoding: 'utf8', timeout: 30_000, windowsHide: true});
  assert.equal(run.error, undefined, run.error?.message);
  assert.equal(run.status, 0, run.stderr);
  return run;
}

test('canonical conditional expression returns its body or null exactly like native', async () => {
  const source = await readFile(path.join(root, 'examples/generated/readme/core/31-conditionals.vkf'), 'utf8');
  const native = await nativeOutput(source);
  const shared = compiler.run(source);
  assert.equal(shared.stdout, native.stdout);
  assert.equal(shared.stderr, native.stderr);
});

test('conditional expression evaluates only the selected body at its source position', async () => {
  const source = `mark(value:int) -> int:
    :: value
    value
enabled: false
:: (enabled? mark(1))
:: (true? mark(2))
`;
  const native = await nativeOutput(source);
  assert.equal(native.stdout, 'nan\n2\n2\n');
  const shared = compiler.run(source);
  assert.equal(shared.stdout, native.stdout);
  assert.equal(shared.stderr, native.stderr);
});
