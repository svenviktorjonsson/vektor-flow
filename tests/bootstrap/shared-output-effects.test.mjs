import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = await mkdtemp(path.join(os.tmpdir(), 'vkf-output-effects-'));
const probe = path.join(directory, 'probe');
const source = path.join(directory, 'probe.cpp');
await writeFile(source, `
#include "compiler/native/vkf_output_effects.hpp"
#include "compiler/native/vkf_stdout_format.hpp"
#include <iostream>
#include <iterator>
int main() {
    const std::string input(std::istreambuf_iterator<char>(std::cin), {});
    const auto ir = vf::parse_json(input);
    const bool ordered = vkf::output_effects::has_nested_output_effect(ir);
    vf::JsonValue::Object result;
    result["ordered"] = ordered;
    result["number"] = vkf::stdout_format::number_text(0.1, ordered ? 15 : 17);
    std::cout << vf::json_stringify(result, -1);
}
`);
const built = spawnSync('g++', ['-std=c++17', '-O0', `-I${root}`, `-I${path.join(root, 'native/VfOverlay')}`,
  source, path.join(root, 'native/VfOverlay/vf/json.cpp'), '-o', probe], {encoding: 'utf8', timeout: 30_000});

test('shared output mode matches native scalar precision and reachable nested print effects', () => {
  assert.equal(built.status, 0, built.stderr);
  for (const {source, ordered, lines} of [
    {source: ':: 0.1\n', ordered: false, lines: 1},
    {source: 'unused() -> num:\n    :: 0.1\n    0\n:: 0.1\n', ordered: false, lines: 1},
    {source: 'emit() -> num:\n    :: 0.1\n    0.1\n:: emit()\n', ordered: true, lines: 2},
    {source: 'emit() -> num:\n    :: 0.1\n    0.1\nouter() -> num: emit()\n:: outer()\n', ordered: true, lines: 2},
    {source: ':: io.print(0.1)\n', ordered: true, lines: 2},
  ]) {
    const frontend = spawnSync(path.join(root, 'build/shared-compiler/vkf-compiler-probe'), [],
      {input: source, encoding: 'utf8', timeout: 30_000});
    assert.equal(frontend.status, 0, frontend.stderr);
    const response = JSON.parse(frontend.stdout);
    assert.equal(response.ok, true, response.message);
    const actual = spawnSync(probe, [], {input: JSON.stringify(response.typed_ir), encoding: 'utf8', timeout: 30_000});
    assert.equal(actual.status, 0, actual.stderr);
    const result = JSON.parse(actual.stdout);
    assert.equal(result.ordered, ordered, source);
    const native = spawnSync(path.join(root, 'build/native-compiler-docker/bin/vkf-strict'), ['-e', source],
      {encoding: 'utf8', timeout: 30_000});
    assert.equal(native.error, undefined, native.error?.message);
    assert.equal(native.status, 0, native.stderr);
    assert.equal(native.stdout, (result.number + '\n').repeat(lines), source);
  }
});
