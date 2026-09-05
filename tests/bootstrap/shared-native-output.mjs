import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Test oracle only: fresh native compilation, no JavaScript value decoder/formatter.
export function compareNativeOutput(compiler, source, expectedStdout) {
  const directory = mkdtempSync(fileURLToPath(new URL('../../build/shared-output-oracle-', import.meta.url)));
  try {
    const sourcePath = join(directory, 'program.vkf');
    writeFileSync(sourcePath, source);
    const native = spawnSync(process.env.VKF_NATIVE_COMPILER ?? fileURLToPath(
      new URL('../../build/native-compiler-docker/bin/vkf-strict', import.meta.url)),
    [sourcePath, '-o', join(directory, 'program')], {encoding:'utf8', timeout:30_000, windowsHide:true});
    assert.equal(native.error, undefined, native.error?.message);
    assert.equal(native.status, 0, native.stderr);
    if (expectedStdout !== undefined) assert.equal(native.stdout, expectedStdout);
    const result = compiler.run(source);
    assert.deepEqual(Object.keys(result).sort(), ['kind', 'stderr', 'stdout']);
    assert.equal(result.stdout, native.stdout, source);
    assert.equal(result.stderr, native.stderr, source);
    return result;
  } finally {
    rmSync(directory, {recursive:true, force:true});
  }
}
