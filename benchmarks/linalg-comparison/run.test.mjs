import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { materialized } from './materialize-fixtures.mjs';

import {
  comparison,
  enforceRelativeGate,
  parseRunnerOutput,
  rotateEntries,
  seriesStats,
  validateSample,
} from './run.mjs';

test('parses timed result and numeric validation fields', () => {
  assert.deepEqual(parseRunnerOutput([
    'elapsed_ms=1.25',
    'checksum=4.5',
    'residual=2e-15',
    'reconstruction=3e-15',
    'orthogonality=4e-15',
    'input_sha256=abc',
  ].join('\n')), {
    elapsedMs: 1.25,
    checksum: 4.5,
    metrics: {
      residual: 2e-15,
      reconstruction: 3e-15,
      orthogonality: 4e-15,
    },
    fields: {
      elapsed_ms: '1.25',
      checksum: '4.5',
      residual: '2e-15',
      reconstruction: '3e-15',
      orthogonality: '4e-15',
      input_sha256: 'abc',
    },
  });
});

test('rejects invalid runner output', () => {
  assert.throws(() => parseRunnerOutput('elapsed_ms=-1\nchecksum=2\n'));
  assert.throws(() => parseRunnerOutput('elapsed_ms=1\nchecksum=nan\n'));
});

test('accuracy gates run before timing sample is accepted', () => {
  const limits = { residual: 1e-12, reconstruction: 1e-12 };
  assert.equal(validateSample({ metrics: { residual: 1e-14, reconstruction: 2e-14 } }, limits), true);
  assert.throws(
    () => validateSample({ metrics: { residual: 2e-12, reconstruction: 2e-14 } }, limits),
    /residual/,
  );
  assert.throws(
    () => validateSample({ metrics: { residual: 1e-14 } }, limits),
    /reconstruction/,
  );
});

test('uses sample standard deviation', () => {
  assert.deepEqual(seriesStats([1, 2, 3]), { count: 3, meanMs: 2, stddevMs: 1 });
});

test('rotates language order without dropping entries', () => {
  assert.deepEqual(rotateEntries(['vkf', 'eigen', 'faer', 'scipy'], 2), [
    'faer', 'scipy', 'vkf', 'eigen',
  ]);
});

test('reports VKF divided by competitor and does not impose a speed gate by default', () => {
  assert.deepEqual(comparison(3, 2), { ratio: 1.5 });
});

test('strict relative gate requires every VKF ratio below its limit', () => {
  assert.equal(enforceRelativeGate({ eigen: { ratio: 1.499 }, faer: { ratio: 0.8 } }, 1.5), true);
  assert.throws(
    () => enforceRelativeGate({ eigen: { ratio: 1.5 }, faer: { ratio: 0.8 } }, 1.5),
    /eigen.*1\.500.*below 1\.500/,
  );
});

test('materialized fixtures have stable hashes and mathematical construction', () => {
  const generated = materialized();
  const manifest = JSON.parse(generated.manifest);
  const array = (fixtureName, arrayName) => {
    const fixture = manifest.fixtures[fixtureName];
    const descriptor = fixture.arrays[arrayName];
    const bytes = generated.files[fixture.file];
    assert.equal(createHash('sha256').update(bytes).digest('hex'), fixture.sha256);
    return Array.from({ length: descriptor.length }, (_, index) => bytes.readDoubleLE(
      (descriptor.offsetElements + index) * 8,
    ));
  };
  const matrix = array('tall-96x48', 'matrix');
  const x = array('tall-96x48', 'x_true');
  const rhs = array('tall-96x48', 'rhs');
  const { rows, columns } = manifest.fixtures['tall-96x48'];
  const residual = Array.from({ length: rows }, (_, row) => {
    let value = -rhs[row];
    for (let column = 0; column < columns; column += 1) {
      value += matrix[row * columns + column] * x[column];
    }
    return value;
  });
  let maxNormalResidual = 0;
  for (let column = 0; column < columns; column += 1) {
    let value = 0;
    for (let row = 0; row < rows; row += 1) value += matrix[row * columns + column] * residual[row];
    maxNormalResidual = Math.max(maxNormalResidual, Math.abs(value));
  }
  assert.ok(maxNormalResidual < 1e-11, `least-squares construction residual ${maxNormalResidual}`);

  const spd = array('spd-96', 'matrix');
  for (let row = 0; row < 96; row += 1) {
    assert.ok(spd[row * 96 + row] > 0);
    for (let column = 0; column < 96; column += 1) {
      assert.equal(spd[row * 96 + column], spd[column * 96 + row]);
    }
  }
});
