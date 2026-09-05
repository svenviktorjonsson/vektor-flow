import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir, mkdtemp, readdir, readFile, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = await mkdtemp(path.join(os.tmpdir(), 'vkf-test-selection-'));
const probe = path.join(directory, 'probe');
const cpp = path.join(directory, 'probe.cpp');
await writeFile(cpp, `
#include "compiler/native/vkf_test_suite.hpp"
#include <iostream>
#include <iterator>
int main() {
    const std::string input(std::istreambuf_iterator<char>(std::cin), {});
    const auto request = vf::parse_json(input).as_object();
    const auto source = request.at("source").as_string();
    vf::JsonValue::Object result;
    const auto expected = vkf::testing::expected_compile_error(source);
    result["expectedCompileError"] = expected ? vf::JsonValue(*expected) : vf::JsonValue(nullptr);
    vf::JsonValue::Array tests;
    if (!expected) for (const auto& test : vkf::testing::discover_tests(source, "test.vkf")) {
        vf::JsonValue::Object entry;
        entry["name"] = test.name;
        entry["compatible"] = test.compatible;
        entry["incompatibility"] = test.incompatibility;
        entry["source"] = vkf::testing::test_entry_source(source, test.name);
        tests.emplace_back(entry);
    }
    result["tests"] = tests;
    std::vector<std::string> files;
    for (const auto& file : request.at("files").as_array()) files.push_back(file.as_string());
    vf::JsonValue::Array selected;
    for (const auto& file : vkf::testing::select_test_source_files(files)) selected.emplace_back(file);
    result["files"] = selected;
    std::cout << vf::json_stringify(result, -1);
}
`);
const objects = path.join(root, 'build/native-compiler-docker/CMakeFiles/vkf_strict.dir');
const built = spawnSync('g++', ['-std=c++17', '-O0', `-I${root}`, `-I${path.join(root, 'native/VfOverlay')}`,
  cpp, path.join(objects, 'vkf_lexer_cursor_smoke.cpp.o'), path.join(objects, 'vkf_parser_token_stream_smoke.cpp.o'),
  path.join(root, 'native/VfOverlay/vf/json.cpp'), '-o', probe], {encoding: 'utf8', timeout: 30_000});

function describe(source, files = []) {
  assert.equal(built.status, 0, built.stderr);
  const run = spawnSync(probe, [], {input: JSON.stringify({source, files}), encoding: 'utf8', timeout: 30_000});
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

test('shared selection matches native -t names, source order, default arguments and private helpers', async () => {
  const source = 'zeta() -> bit: true\n_private() -> bit: true\nrequired(x:int) -> bit: true\nnumber() -> num: 1\ninferred(): true\nalpha(value:int=1) -> bit: value = 1\n';
  const selected = describe(source);
  assert.deepEqual(selected.tests.map(entry => entry.name), ['zeta', 'alpha']);
  assert.ok(selected.tests.every(entry => entry.compatible));
  assert.equal(selected.tests[0].source, `${source}(zeta())?!\n`);
  const fixture = path.join(directory, 'selection.vkf');
  await writeFile(fixture, source);
  const native = spawnSync(path.join(root, 'build/native-compiler-docker/bin/vkf-strict'), ['-t', fixture],
    {encoding: 'utf8', timeout: 30_000});
  assert.equal(native.status, 0, native.stderr);
  const names = native.stdout.split('\n').filter(line => line.startsWith('PASS ')).map(line => line.split('::').at(-1));
  assert.deepEqual(selected.tests.map(entry => entry.name), names);
});

test('explicit tags suppress implicit tests but never hide incompatible tagged entries', async () => {
  const source = 'implicit() -> bit: true\ntest _private() -> bit: true\ntest required(x:int) -> bit: true\ntest numeric() -> num: 1\ntest final(value:int=1) -> bit: true\n';
  const selected = describe(source);
  assert.deepEqual(selected.tests.map(({name, compatible, incompatibility}) => ({name, compatible, incompatibility})), [
    {name: '_private', compatible: true, incompatibility: ''},
    {name: 'required', compatible: false, incompatibility: 'required parameters need fixtures'},
    {name: 'numeric', compatible: false, incompatibility: 'test must return bit'},
    {name: 'final', compatible: true, incompatibility: ''},
  ]);
  const fixture = path.join(directory, 'explicit.vkf');
  await writeFile(fixture, source);
  const native = spawnSync(path.join(root, 'build/native-compiler-docker/bin/vkf-strict'), ['-t', fixture],
    {encoding: 'utf8', timeout: 30_000});
  assert.equal(native.status, 1, native.stderr);
  const lines = native.stdout.split('\n').filter(line => /^(PASS|INCOMPATIBLE) /.test(line));
  assert.deepEqual(lines, [
    `PASS ${fixture}::_private`,
    `INCOMPATIBLE ${fixture}::required: required parameters need fixtures`,
    `INCOMPATIBLE ${fixture}::numeric: test must return bit`,
    `PASS ${fixture}::final`,
  ]);
});

test('shared collection keeps every native test file, excludes only generated paths, and preserves error markers', () => {
  const files = ['suite/z.vkf', 'suite/a.vkf', 'suite/invalid/b.vkf', 'suite/.vkfbuild/generated.vkf',
    'suite/nested/.vkfbuild/hidden.vkf', 'suite/not.vkf.txt', 'suite/UPPER.VKF', 'suite/.vkf', 'suite/.valid.vkf'];
  const source = '# expect-compile-error: exact diagnostic\r\nnot valid VKF (\r\n';
  const selected = describe(source, files);
  assert.equal(selected.expectedCompileError, 'exact diagnostic');
  assert.deepEqual(selected.tests, []);
  assert.deepEqual(selected.files, ['suite/.valid.vkf', 'suite/a.vkf', 'suite/invalid/b.vkf', 'suite/z.vkf']);
  assert.equal(describe('# expect-compile-error: \ninvalid(').expectedCompileError, '');
  const normal = describe('passes() -> bit: true\r\n');
  assert.equal(normal.expectedCompileError, null);
  assert.equal(normal.tests[0].source, 'passes() -> bit: true\n(passes())?!\n');
});

test('shared recursive collection matches native path-component sorting', async () => {
  const suite = path.join(directory, 'order');
  await mkdir(path.join(suite, 'a'), {recursive: true});
  const files = [path.join(suite, 'a.vkf'), path.join(suite, 'a/nested.vkf')];
  for (const file of files) await writeFile(file, 'valid() -> bit: true\n');
  const native = spawnSync(path.join(root, 'build/native-compiler-docker/bin/vkf-strict'), ['-t', suite],
    {encoding: 'utf8', timeout: 30_000});
  assert.equal(native.status, 0, native.stderr);
  const actual = native.stdout.split('\n').filter(line => line.startsWith('PASS ')).map(line => line.slice(5).split('::')[0]);
  assert.deepEqual(describe('', files).files, actual);
});

test('the complete tests/vkf inventory is selected by shared C++, without a curated source list', async context => {
  const files = [];
  async function collect(directory) {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await collect(filename);
      else if (entry.isFile()) files.push(filename);
    }
  }
  await collect(path.join(root, 'tests/vkf'));
  const selected = describe('', files).files;
  assert.ok(selected.length > 0);
  let runnable = 0;
  let incompatible = 0;
  let diagnostic = 0;
  for (const filename of selected) {
    const source = await readFile(filename, 'utf8');
    const result = describe(source);
    if (result.expectedCompileError !== null) {
      ++diagnostic;
      assert.deepEqual(result.tests, []);
    } else {
      for (const entry of result.tests) {
        if (entry.compatible) ++runnable;
        else ++incompatible;
        assert.ok(entry.source.endsWith(`(${entry.name}())?!\n`));
      }
    }
  }
  context.diagnostic(JSON.stringify({files: selected.length, runnable, incompatible, diagnostic}));
  assert.ok(runnable > 0 && diagnostic > 0, 'both execution and expected-compiler-error tests remain in the inventory');
});
