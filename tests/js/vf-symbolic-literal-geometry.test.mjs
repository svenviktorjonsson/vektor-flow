import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createSymbolicKernel } from '../../web/vf-ui/vf-symbolic-kernel-runtime.mjs';
import { symbolicPlotSnapGeometry } from '../../web/vf-ui/vf-symbolic-plot-controller.mjs';

const artifactRoot = new URL('../../web/vf-ui/artifacts/', import.meta.url);
const view = {
  xMin: -5, xMax: 5, yMin: -5, yMax: 5,
  xSteps: 65, ySteps: 65,
  fieldXSteps: 17, fieldYSteps: 17,
  tMin: -5, tMax: 5, tSteps: 65,
  t: 0, vectorScale: 0.35
};
const style = {
  edgeR: 1, edgeG: 1, edgeB: 1, edgeA: 1,
  faceR: 1, faceG: 1, faceB: 1, faceA: 1,
  valueMin: -5, valueMax: 5,
  colormapPoints: null
};

async function createKernel() {
  const wasm = await readFile(new URL('vkf-symbolic-kernel.wasm', artifactRoot));
  const manifest = JSON.parse(await readFile(new URL('vkf-symbolic-kernel.json', artifactRoot), 'utf8'));
  const { instance } = await WebAssembly.instantiate(wasm);
  return createSymbolicKernel({ instance, manifest });
}

function plotGeometry(kernel, workspace, source, viewOverrides = {}) {
  const program = kernel.compile(source);
  assert.deepEqual(program.value.diagnostics, [], source);
  const arena = kernel.plot(program.handle, workspace, { ...view, ...viewOverrides }, style, 1);
  const data = arena.data;
  const ranges = arena.ranges.map((range) => ({
    ...range,
    topology: range.mode === 'points'
      ? 'point-list'
      : range.mode === 'time-curve'
        ? 'line-strip'
        : 'line-list'
  }));
  return {
    program: program.value,
    arena,
    packed: Array.from(data),
    geometry: symbolicPlotSnapGeometry({ data, ranges })
  };
}

test('maps scalar, complex, and vector literals into complex-plane vertices', async () => {
  const kernel = await createKernel();
  const workspace = kernel.createWorkspace().handle;

  assert.deepEqual(plotGeometry(kernel, workspace, '1').geometry.points, [[1, 0]]);
  assert.deepEqual(plotGeometry(kernel, workspace, 'i').geometry.points, [[0, 1]]);
  assert.deepEqual(plotGeometry(kernel, workspace, '[1,3]').geometry.points, [[1, 3]]);
});

test('maps exponent sets to points and exponent tuples to open linked geometry', async () => {
  const kernel = await createKernel();
  const workspace = kernel.createWorkspace().handle;
  const expected = [[0, 1], [-1, 0], [0, -1], [1, 0]];

  const unlinked = plotGeometry(kernel, workspace, 'i^{1,2,3,4}').geometry;
  assert.deepEqual(unlinked.points, expected);
  assert.deepEqual(unlinked.segments, []);

  const linked = plotGeometry(kernel, workspace, 'i^(1,2,3,4)').geometry;
  assert.deepEqual(linked.points, expected);
  assert.deepEqual(linked.segments, [
    [expected[0], expected[1]],
    [expected[1], expected[2]],
    [expected[2], expected[3]]
  ]);
});

test('preserves multiset multiplicity while canonicalizing equal graph vertices', async () => {
  const kernel = await createKernel();
  const workspace = kernel.createWorkspace().handle;
  const result = plotGeometry(kernel, workspace, '{1,1,2}');

  assert.equal(result.program.valueKind, 'multiset');
  assert.equal(result.program.latex, '\\left\\{1, 1, 2\\right\\}');
  assert.deepEqual(result.geometry.points, [[1, 0], [2, 0]]);
  assert.deepEqual(result.geometry.segments, []);
});

test('expands inclusive exponent ranges and closes through a canonical repeated point', async () => {
  const kernel = await createKernel();
  const workspace = kernel.createWorkspace().handle;
  const geometry = plotGeometry(kernel, workspace, 'i^(1..5)').geometry;
  const [i, minusOne, minusI, one] = [[0, 1], [-1, 0], [0, -1], [1, 0]];

  assert.deepEqual(geometry.points, [i, minusOne, minusI, one]);
  assert.deepEqual(geometry.segments, [
    [i, minusOne],
    [minusOne, minusI],
    [minusI, one],
    [one, i]
  ]);
  assert.equal(geometry.segments.at(-1)[1], geometry.points[0]);
});

test('t changes the current 2D frame without changing its geometry category', async () => {
  const kernel = await createKernel();
  const workspace = kernel.createWorkspace().handle;

  const literal = plotGeometry(kernel, workspace, 't', { t: 2 });
  assert.equal(literal.program.classification, 'literal');
  assert.deepEqual(literal.geometry.points, [[2, 0]]);

  const vector = plotGeometry(kernel, workspace, '[t,t+1]', { t: 2 });
  assert.equal(vector.program.classification, 'literal');
  assert.deepEqual(vector.geometry.points, [[2, 3]]);

  const tuple = plotGeometry(kernel, workspace, '(t,t+1)', { t: 2 });
  assert.equal(tuple.program.classification, 'linked-tuple');
  assert.deepEqual(tuple.geometry.segments, [[[2, 0], [3, 0]]]);

  const multiset = plotGeometry(kernel, workspace, '{t,t+1}', { t: 2 });
  assert.equal(multiset.program.classification, 'point-set');
  assert.deepEqual(multiset.geometry.points, [[2, 0], [3, 0]]);
});

test('t is fixed per frame across curves, fields, and relations', async () => {
  const kernel = await createKernel();
  const workspace = kernel.createWorkspace().handle;

  const explicit = plotGeometry(kernel, workspace, 'x+t', { t: 2 });
  assert.equal(explicit.program.classification, 'y-of-x');
  assert.deepEqual(explicit.geometry.segments[0][0], [-5, -3]);
  assert.deepEqual(explicit.geometry.segments.at(-1)[1], [5, 7]);

  const parametric = plotGeometry(kernel, workspace, '[x,t]', { t: 2 });
  assert.equal(parametric.program.classification, 'parametric');
  assert.deepEqual(parametric.geometry.segments[0][0], [-5, 2]);
  assert.deepEqual(parametric.geometry.segments.at(-1)[1], [5, 2]);

  for (const source of ['[x+t,y-t]', 'x+y+t', 'x=t', 'x>t', 'x>=t']) {
    try {
      const atZero = plotGeometry(kernel, workspace, source, { t: 0 });
      const atTwo = plotGeometry(kernel, workspace, source, { t: 2 });
      assert.notDeepEqual(atTwo.packed, atZero.packed, source);
    } catch (error) {
      error.message = `${source}: ${error.message}`;
      throw error;
    }
  }
});
