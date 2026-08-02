import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createSymbolicKernel } from '../../web/vf-ui/vf-symbolic-kernel-runtime.mjs';
import { compileSymbolicRelationShader } from '../../web/vf-ui/geom/vf-symbolic-relation-shader.mjs';

const artifactRoot = new URL('../../web/vf-ui/artifacts/', import.meta.url);

test('compiles numeric coefficients adjacent to symbolic variables', async () => {
  const wasm = await readFile(new URL('vkf-symbolic-kernel.wasm', artifactRoot));
  const manifest = JSON.parse(
    await readFile(new URL('vkf-symbolic-kernel.json', artifactRoot), 'utf8')
  );
  const { instance } = await WebAssembly.instantiate(wasm);
  const kernel = createSymbolicKernel({ instance, manifest });

  for (const [source, latex, expected] of [
    ['2x', '2x', 6],
    ['2pi', '2\\pi', 2 * Math.PI]
  ]) {
    const compiled = kernel.compile(source);
    assert.deepEqual(compiled.value.diagnostics, [], source);
    assert.equal(compiled.value.latex, latex, source);
    assert.equal(compiled.value.classification, source === '2pi' ? 'literal' : 'y-of-x', source);
    assert.ok(Math.abs(kernel.evaluate(compiled.handle, 3, 0) - expected) < 1e-12, source);
  }

  const program = kernel.compile('2x');
  const plot = kernel.plot(
    program.handle,
    kernel.createWorkspace().handle,
    {
      xMin: -2, xMax: 2, yMin: -4, yMax: 4,
      xSteps: 65, ySteps: 65,
      fieldXSteps: 17, fieldYSteps: 17,
      tMin: -2, tMax: 2, tSteps: 65,
      t: 0, vectorScale: 0.35
    },
    {
      edgeR: 1, edgeG: 1, edgeB: 1, edgeA: 1,
      faceR: 1, faceG: 1, faceB: 1, faceA: 1,
      valueMin: -4, valueMax: 4
    },
    1
  );
  const packed = plot.data;
  assert.equal(plot.ranges[0].mode, 'time-curve');
  assert.equal(plot.ranges[0].part, 'edge');
  assert.ok(Array.from({ length: plot.count }, (_, index) => index)
    .every((index) => Math.abs(packed[index * 6 + 1] - 2 * packed[index * 6]) < 1e-6));
});

test('compiles adjacent coordinate variables in GPU relations', async () => {
  const wasm = await readFile(new URL('vkf-symbolic-kernel.wasm', artifactRoot));
  const manifest = JSON.parse(
    await readFile(new URL('vkf-symbolic-kernel.json', artifactRoot), 'utf8')
  );
  const { instance } = await WebAssembly.instantiate(wasm);
  const kernel = createSymbolicKernel({ instance, manifest });
  const source = '3x^2 + xy - y^3 <= y^2 - x^2';
  const compiled = kernel.compile(source);

  assert.deepEqual(compiled.value.diagnostics, []);
  assert.equal(compiled.value.classification, 'closed-region');
  assert.deepEqual(new Set(compiled.value.variables), new Set(['x', 'y']));
  const shader = compileSymbolicRelationShader(compiled.value.ast);
  assert.ok(shader, 'exact relation must compile to a GPU shader');
  assert.equal(shader.operator, '<=');
  assert.equal(shader.hasFill, true);
  assert.equal(shader.hasBoundary, true);
});
