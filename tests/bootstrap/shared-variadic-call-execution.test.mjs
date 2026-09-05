import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {createSharedCompiler} from '../../web/playground/vkf-shared-compiler.mjs';

const module = new WebAssembly.Module(await readFile(new URL('../../build/shared-compiler/vkf-compiler.wasm', import.meta.url)));
const compiler = createSharedCompiler({instance: new WebAssembly.Instance(module)});
const nativeCompiler = process.env.VKF_NATIVE_COMPILER ?? fileURLToPath(new URL('../../build/native-compiler-docker/bin/vkf-strict', import.meta.url));

async function compare(source, expected) {
  const directory = await mkdtemp(fileURLToPath(new URL('../../build/shared-variadic-call-', import.meta.url)));
  const sourcePath = path.join(directory, 'program.vkf');
  await writeFile(sourcePath, source);
  const native = spawnSync(nativeCompiler, [sourcePath, '-o', path.join(directory, 'program')],
    {encoding:'utf8', timeout:30_000, windowsHide:true});
  assert.equal(native.error, undefined, native.error?.message);
  assert.equal(native.status, 0, native.stderr);
  assert.equal(native.stdout, expected);
  const actual = compiler.run(source);
  assert.equal(actual.stdout, native.stdout);
  assert.equal(actual.stderr, native.stderr);
  assert.equal(compiler.run(source).stdout, expected);
}

test('numeric variadic arguments pack nonempty and empty lists', async () => {
  // Original canonical numeric variadic declaration and assertion from calls.vkf.
  await compare(`_sum_rest(head: num, ...rest:num) -> num:
    head + stat.sum(rest)
variadic_numeric_arguments_pack_list() -> bit:
    (_sum_rest(1, 2, 3, 4) = 10 /\\ _sum_rest(5) = 5)?!
:: variadic_numeric_arguments_pack_list()
`, 'true\n');
});

test('canonical numeric and integer variadic spreads retain their list values', async () => {
  await compare(`_sum_rest(head: num, ...rest:num) -> num:
    head + stat.sum(rest)
variadic_spread_expands_numeric_list() -> bit:
    [num] values: collections.list(2, 3, 4)
    (_sum_rest(1, :values) = 10)?!
_sum_integer_rest(head:int, ...rest:int) -> int:
    head + stat.sum(rest)
integer_variadic_sum_preserves_integer_leaf_type() -> bit:
    [int] values: collections.list(2, 3, 4)
    (_sum_integer_rest(1, :values) = 10)?!
:: variadic_spread_expands_numeric_list()
:: integer_variadic_sum_preserves_integer_leaf_type()
`, 'true\ntrue\n');
});

test('omitted fixed defaults keep their callee scope alongside packed variadic values', async () => {
  await compare(`sum(head:num=2, ...rest:num) -> num:
    head + stat.sum(rest)
head: 100
:: sum()
:: sum(head:4)
values: collections.list(1,2,3)
:: sum(:values)
`, '2\n4\n8\n');
});

test('canonical fixed vector and record spreads bind by position and field name', async () => {
  await compare(`_volume(x, y, z):
    x * y * z
fixed_vector_spread_binds_positional_parameters() -> bit:
    values: [2, 3, 4]
    (_volume(:values) == 24)?!
_point_sum(x, y):
    x + y
fixed_record_spread_binds_by_field_name() -> bit:
    point: (y: 4, x: 3)
    (_point_sum(:point) == 7)?!
:: fixed_vector_spread_binds_positional_parameters()
:: fixed_record_spread_binds_by_field_name()
`, 'true\ntrue\n');
});

test('fixed spread evaluates once before ordinary operands and fills only unbound parameters', async () => {
  await compare(`volume(x:num, y:num, z:num) -> num: x*y*z
emit(value:num) -> num:
    :: value
    value
tail() -> [int:2]:
    :: 9
    [3,4]
:: volume(emit(2), :tail())
weighted(x:num=2, y:num=3, z:num=4) -> num: 100*x+10*y+z
point: (z:7, x:5)
:: weighted(y:6, :point)
partial: (z:8,)
:: weighted(:partial)
`, '9\n2\n24\n567\n238\n');
});

test('invalid fixed spread count preserves the exact native diagnostic', async () => {
  const source = 'volume(x,y,z): x*y*z\nvalues: [2,3]\n:: volume(:values)\n';
  const directory = await mkdtemp(fileURLToPath(new URL('../../build/shared-fixed-spread-error-', import.meta.url)));
  const sourcePath = path.join(directory, 'program.vkf');
  await writeFile(sourcePath, source);
  const native = spawnSync(nativeCompiler, [sourcePath, '-o', path.join(directory, 'program')],
    {encoding:'utf8', timeout:30_000, windowsHide:true});
  assert.equal(native.error, undefined, native.error?.message);
  assert.notEqual(native.status, 0);
  assert.equal(native.stderr, '<driver-smoke>:1:1: direct x64 backend unsupported: spread argument count mismatch for volume\n');
  assert.throws(() => compiler.run(source), error => error.message === 'spread argument count mismatch for volume');
});
