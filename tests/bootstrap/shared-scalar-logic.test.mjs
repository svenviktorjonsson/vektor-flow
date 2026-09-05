import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile, mkdtemp, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import test from 'node:test';
import {createSharedCompiler} from '../../web/playground/vkf-shared-compiler.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const module = new WebAssembly.Module(await readFile(path.join(root,'build/shared-compiler/vkf-compiler.wasm')));
const compiler = createSharedCompiler({instance:new WebAssembly.Instance(module)});

test('the complete unchanged native scalar-operations suite executes its assertions in WASM', async context => {
  const source = await readFile(path.join(root,'tests/vkf/scalar_operations.vkf'),'utf8');
  const suite = compiler.describeTests(source,'tests/vkf/scalar_operations.vkf');
  assert.equal(suite.tests.length,17);
  for (const entry of suite.tests) await context.test(entry.name, () => {
    assert.equal(compiler.run(entry.source).stdout,'');
  });
});

test('logical results are normalized and XOR evaluates each operand once in source order', async () => {
  const source = `emit(value:num) -> num:
    :: value
    value
:: (2 /\\ 3)
:: (0 \\/ 4)
:: (2 >< 3)
:: (emit(2) >< emit(0))
`;
  const directory = await mkdtemp(path.join(root,'build/shared-logic-test-'));
  const unit = path.join(directory,'case.vkf');
  await writeFile(unit,source);
  const native = spawnSync(path.join(root,'build/native-compiler-docker/bin/vkf-strict'),
    [unit,'-o',path.join(directory,'case')],{encoding:'utf8',timeout:30_000,windowsHide:true});
  assert.equal(native.error,undefined,native.error?.message);
  assert.equal(native.status,0,native.stderr);
  const actual=compiler.run(source);
  assert.equal(actual.stdout,native.stdout);
  assert.equal(actual.stderr,native.stderr);
});
