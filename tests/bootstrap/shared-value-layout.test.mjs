import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {createSharedCompiler} from '../../web/playground/vkf-shared-compiler.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'vkf-shared-layout-'));
const probe = path.join(directory, 'probe');
const built = spawnSync(process.env.CXX ?? 'g++', ['-std=c++17', '-O0', `-I${root}`,
  `-I${path.join(root, 'native/VfOverlay')}`, path.join(root, 'tests/bootstrap/fixtures/value-layout-probe.cpp'),
  path.join(root, 'native/VfOverlay/vf/json.cpp'), '-o', probe],
  {encoding: 'utf8', timeout: 30_000, windowsHide: true});
const wasm = new WebAssembly.Module(await readFile(path.join(root, 'build/shared-compiler/vkf-compiler.wasm')));
const compiler = createSharedCompiler({instance: new WebAssembly.Instance(wasm)});
const oracle = JSON.parse(await readFile(new URL('./fixtures/value-layout-native-oracle.json', import.meta.url), 'utf8'));

test('shared inference exactly preserves pre-extraction native canonical and transitive layouts', async context => {
  assert.equal(built.error, undefined, built.error?.message);
  assert.equal(built.status, 0, built.stderr);
  for (const fixture of oracle.fixtures) {
    await context.test(fixture.name, async () => {
      const source = fixture.file ? await readFile(path.join(root, fixture.file), 'utf8') : fixture.source;
      assert.equal(createHash('sha256').update(source).digest('hex'), fixture.sourceSha256,
        'canonical fixture changes require a freshly verified native oracle');
      const typed = compiler.compile(source).typed_ir;
      const first = spawnSync(probe, [], {input: JSON.stringify(typed), encoding: 'utf8', timeout: 30_000});
      assert.equal(first.status, 0, first.stderr);
      assert.deepEqual(JSON.parse(first.stdout), fixture.expected);
      const second = spawnSync(probe, [], {input: JSON.stringify(typed), encoding: 'utf8', timeout: 30_000});
      assert.equal(second.status, 0, second.stderr);
      assert.equal(second.stdout, first.stdout, 'inference and selector order are deterministic');
    });
  }
});
test('shared layout inference preserves native root diagnostics', () => {
  assert.equal(built.status, 0, built.stderr);
  const result = spawnSync(probe, [], {input: '{"kind":"other","body":[]}', encoding: 'utf8'});
  assert.equal(result.status, 1);
  assert.equal(result.stderr, 'unsupported typed IR root');
});
