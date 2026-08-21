import assert from 'node:assert/strict';
import test from 'node:test';

import { compareRegression } from './compare-regression.mjs';

function payload(compile, runtime, hash = 'code') {
  return {
    environment: { platform: 'win32', architecture: 'x64', cpu: 'test' },
    options: { compileRuns: 100, runs: 100 },
    results: [{
      case: 'scalar-control-small',
      language: 'vkf',
      compile: { meanMs: compile },
      nativeRuntime: { meanMs: runtime },
      nativeCodeSha256: hash
    }]
  };
}

test('accepts lower compile and runtime means', () => {
  const result = compareRegression(payload(10, 2, 'a'), payload(9, 1, 'b'));
  assert.equal(result.rows[0].compileDeltaMs, -1);
  assert.equal(result.rows[0].runtimeDeltaMs, -1);
});
test('treats identical machine code as proof against a runtime-code regression', () => {
  const result = compareRegression(payload(10, 1, 'same'), payload(9, 2, 'same'));
  assert.equal(result.rows[0].identicalCode, true);
});

test('rejects unexplained compile or changed-code runtime regression', () => {
  assert.throws(
    () => compareRegression(payload(10, 1, 'a'), payload(11, 2, 'b')),
    /unexplained VKF performance regression/
  );
});

test('records explicit justification for an unavoidable regression', () => {
  const result = compareRegression(
    payload(10, 1, 'a'), payload(11, 2, 'b'), 'required bounds check'
  );
  assert.equal(result.acceptedReason, 'required bounds check');
});
