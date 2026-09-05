import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = await mkdtemp(path.join(os.tmpdir(), 'vkf-module-snapshots-'));
const sourceFile = path.join(directory, 'probe.cpp');
const probe = path.join(directory, 'probe');
await writeFile(sourceFile, `
#include "compiler/native/vkf_module_snapshots.hpp"
#include <iostream>
#include <iterator>
int main() {
    try {
        const std::string input(std::istreambuf_iterator<char>(std::cin), {});
        const auto typed = vf::parse_json(input);
        const auto before = vf::json_stringify(typed, -1);
        const auto rewritten = vkf::module_snapshots::capture_module_literal_snapshots(typed);
        if (vf::json_stringify(typed, -1) != before) throw std::runtime_error("input mutated");
        std::cout << vf::json_stringify(rewritten ? *rewritten : typed, -1);
    } catch (const std::exception& error) {
        std::cerr << error.what();
        return 1;
    }
}
`);
const built = spawnSync(process.env.CXX ?? 'g++', ['-std=c++17', '-O0', `-I${root}`, `-I${path.join(root, 'native/VfOverlay')}`,
  sourceFile, path.join(root, 'native/VfOverlay/vf/json.cpp'), '-o', probe],
{ encoding: 'utf8', timeout: 30_000 });

test('shared snapshot pass captures literal module values at function definition, with lexical shadowing', () => {
  assert.equal(built.status, 0, built.stderr);
  const source = 'scale:2\nf(v:int) -> int: v * scale\n.scale:4\ng(v:int) -> int: v * scale\nh(scale:int) -> int: scale * 3\nk(v:int) -> int:\n    scale:5\n    v * scale\n:: f(3)\n:: g(3)\n:: h(5)\n:: k(3)\n';
  const frontend = spawnSync(path.join(root, 'build/shared-compiler/vkf-compiler-probe'), [],
    { input: source, encoding: 'utf8', timeout: 30_000 });
  assert.equal(frontend.status, 0, frontend.stderr);
  const response = JSON.parse(frontend.stdout);
  assert.equal(response.ok, true, response.message);
  const snapshot = spawnSync(probe, [], { input: JSON.stringify(response.typed_ir), encoding: 'utf8', timeout: 30_000 });
  assert.equal(snapshot.status, 0, snapshot.stderr);
  const result = JSON.parse(snapshot.stdout);
  const functions = new Map(result.body.filter(node => node.kind === 'function').map(node => [node.name, node]));
  assert.deepEqual(functions.get('f').body.body[0].expr.right, {kind: 'const', type: 'int', value: 2});
  assert.deepEqual(functions.get('g').body.body[0].expr.right, {kind: 'const', type: 'int', value: 4});
  assert.deepEqual(functions.get('h').body.body[0].expr.left, {kind: 'load', name: 'scale', type: 'int'});
  assert.deepEqual(functions.get('k').body.body[1].expr.right, {kind: 'load', name: 'scale', type: 'int'});
  assert.deepEqual(result.body.filter(node => node.kind === 'store_binding'),
    response.typed_ir.body.filter(node => node.kind === 'store_binding'), 'do not remove module initialization or updates');
  const native = spawnSync(path.join(root, 'build/native-compiler-docker/bin/vkf-strict'), ['-e', source],
    { encoding: 'utf8', timeout: 30_000 });
  assert.equal(native.status, 0, native.stderr);
  assert.equal(native.stdout, '6\n12\n15\n15\n');
});

test('shared snapshot pass preserves existing rejection wording and does not invent nonliteral captures', () => {
  assert.equal(built.status, 0, built.stderr);
  const invalid = spawnSync(probe, [], {input: JSON.stringify({kind: 'typed_module', body: [
    {kind: 'store_binding', name: 'missing'}]}), encoding: 'utf8'});
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stderr, 'missing value in module snapshot binding');
  const load = {kind: 'load', name: 'value', type: 'any'};
  const input = {kind: 'typed_module', body: [
    {kind: 'store_binding', name: 'value', update: false, value: {kind: 'const', type: 'int', value: 2}},
    {kind: 'store_binding', name: 'value', update: true, value: {kind: 'list', items: []}},
    {kind: 'function', name: 'f', params: [], body: {kind: 'block', body: [{kind: 'expr_stmt', expr: load}]}},
  ]};
  const first = spawnSync(probe, [], {input: JSON.stringify(input), encoding: 'utf8'});
  const second = spawnSync(probe, [], {input: JSON.stringify(input), encoding: 'utf8'});
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);
  assert.deepEqual(JSON.parse(first.stdout), input);
});
