import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {createSharedCompiler} from '../../web/playground/vkf-shared-compiler.mjs';

// Accepted Math A, first production tracer. These are the exact results of the
// committed, independently audited candidate, not new accuracy tolerances.
// Assertions execute inside VKF; no VKF values cross the JavaScript boundary.
const source = `:.math
check(x:num, expected_sin:num, expected_cos:num) -> int:
    (sin(x) == expected_sin)?!
    (cos(x) == expected_cos)?!
    1
:: check(2.5, 0.5984721441039564, -0.8011436155469337)
:: check(-1.5707963267948966, -1, 0.00000000000000006123233995736766)
:: check(-6.283185307179586, 0.00000000000000024492935982947064, 1)
:: check(9.4, 0.024775425453357765, -0.9996930420352065)
`;
const expected = {kind:'console', stdout:'1\n1\n1\n1\n', stderr:''};

test('native production trig executes the accepted compiler-owned policy', () => {
  const directory = mkdtempSync(fileURLToPath(new URL('../../build/trig-production-', import.meta.url)));
  try {
    const file = join(directory, 'tracer.vkf');
    writeFileSync(file, source);
    const result = spawnSync(process.env.VKF_NATIVE_COMPILER ?? fileURLToPath(
      new URL('../../build/native-compiler-docker/bin/vkf-strict', import.meta.url)),
    [file, '-o', join(directory, 'tracer')], {encoding:'utf8', timeout:30_000, windowsHide:true});
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, expected.stdout);
    assert.equal(result.stderr, expected.stderr);
  } finally {
    rmSync(directory, {recursive:true, force:true});
  }
});

test('emitted program WASM executes the accepted compiler-owned trig policy', async () => {
  const module = new WebAssembly.Module(await readFile(new URL(
    '../../build/shared-compiler/vkf-compiler.wasm', import.meta.url)));
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const compiler = createSharedCompiler({instance:new WebAssembly.Instance(module)});
  assert.deepEqual(compiler.run(source), expected);
});
