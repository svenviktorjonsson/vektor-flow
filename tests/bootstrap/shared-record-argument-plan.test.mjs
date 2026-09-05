import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'vkf-record-plan-'));
const probe = path.join(directory, 'probe');
const built = spawnSync(process.env.CXX ?? 'g++', ['-std=c++17', '-O0', `-I${root}`,
  `-I${path.join(root, 'native/VfOverlay')}`, path.join(root, 'tests/bootstrap/fixtures/record-argument-plan.cpp'),
  path.join(root, 'native/VfOverlay/vf/json.cpp'), '-o', probe],
  {encoding: 'utf8', timeout: 30_000, windowsHide: true});
const run = (source, target) => {
  assert.equal(built.status, 0, built.stderr);
  return spawnSync(probe, [source, target], {encoding: 'utf8', timeout: 30_000});
};
const leaf = (...path) => ({kind:'leaf', path, children:[]});
const array = (...children) => ({kind:'array', path:[], children:children.map((value,index)=>({name:String(index),value}))});
const record = fields => ({kind:'record', path:[], children:Object.entries(fields).map(([name,value])=>({name,value}))});

test('native equal-width fixed numeric argument maps to inferred record fields without evaluating source', () => {
  const result = run('[int:2]', 'record{pair:[int:2]}');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), record({pair:array(leaf(0),leaf(1))}));
  const nested = run('[[int:2]:2]', 'record{left:[int:2],right:record{x:int,y:int}}');
  assert.equal(nested.status, 0, nested.stderr);
  assert.deepEqual(JSON.parse(nested.stdout), record({
    left:array(leaf(0,0),leaf(0,1)), right:record({x:leaf(1,0),y:leaf(1,1)})}));
  assert.equal(run('[[int:2]:2]', 'record{left:[int:2],right:record{x:int,y:int}}').stdout, nested.stdout);
});
test('record adaptation never invents missing leaves or changes unrelated representation', () => {
  const mismatch = run('[int:3]', 'record{pair:[int:2]}');
  assert.equal(mismatch.status, 1);
  assert.equal(mismatch.stderr, 'machine IR call argument width mismatch for f.value: expected 2[pair:2], got 3[0:1,1:1,2:1]');
  for (const [source,target] of [['record{x:int}', 'record{x:int}'], ['[str:2]', 'record{x:str,y:str}'],
    ['[int:2]', '[int:2]']]) {
    const result = run(source,target);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'null');
  }
});
