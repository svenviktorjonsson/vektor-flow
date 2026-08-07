import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createSymbolicKernel } from '../../web/vf-ui/vf-symbolic-kernel-runtime.mjs';
import {
  symbolicPlotSeriesCount,
  symbolicPlotSnapGeometry
} from '../../web/vf-ui/vf-symbolic-plot-controller.mjs';

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

test('preserves set, tuple, and range-tuple exponent semantics in latex and geometry', async () => {
  const kernel = await createKernel();
  const workspace = kernel.createWorkspace().handle;

  const unlinked = plotGeometry(kernel, workspace, 'i^{1,2}');
  assert.equal(unlinked.program.latex, '{\\mathrm{i}}^{\\left\\{1, 2\\right\\}}');
  assert.deepEqual(unlinked.geometry.points, [[0, 1], [-1, 0]]);
  assert.deepEqual(unlinked.geometry.segments, []);

  const linked = plotGeometry(kernel, workspace, 'i^(1,2)');
  assert.equal(linked.program.latex, '{\\mathrm{i}}^{\\left(1, 2\\right)}');
  assert.deepEqual(linked.geometry.points, [[0, 1], [-1, 0]]);
  assert.deepEqual(linked.geometry.segments, [[[0, 1], [-1, 0]]]);

  const closed = plotGeometry(kernel, workspace, 'i^(1..5)');
  assert.equal(closed.program.latex, '{\\mathrm{i}}^{\\left(1..5\\right)}');
  assert.equal(closed.geometry.points.length, 4);
  assert.equal(closed.geometry.segments.length, 4);
});

test('plots a symbolic base with a range exponent as one multi-range curve family', async () => {
  const kernel = await createKernel();
  const workspace = kernel.createWorkspace().handle;
  const result = plotGeometry(kernel, workspace, 'x^(1..4)');

  assert.equal(result.program.classification, 'y-of-x-family');
  assert.equal(symbolicPlotSeriesCount(result.program), 4);
  assert.equal(result.program.latex, '{x}^{\\left(1..4\\right)}');
  assert.deepEqual(
    result.arena.ranges.map(({ mode, first, count }) => ({ mode, first, count })),
    [0, 1, 2, 3].map((index) => ({
      mode: 'time-curve',
      first: index * view.xSteps,
      count: view.xSteps
    }))
  );

  const sampleAt = (power, index) => {
    const vertex = (power - 1) * view.xSteps + index;
    const strideFloats = result.arena.stride / Float32Array.BYTES_PER_ELEMENT;
    return [
      result.packed[vertex * strideFloats],
      result.packed[vertex * strideFloats + 1]
    ];
  };
  const middle = Math.floor(view.xSteps / 2);
  assert.deepEqual(sampleAt(1, middle), [0, 0]);
  assert.deepEqual(sampleAt(2, 0), [-5, 25]);
  assert.deepEqual(sampleAt(3, 0), [-5, -125]);
  assert.deepEqual(sampleAt(4, view.xSteps - 1), [5, 625]);

  for (const source of ['x^{1..4}', 'x^{1,2,3,4}']) {
    const equivalent = plotGeometry(kernel, workspace, source);
    assert.equal(equivalent.program.classification, 'y-of-x-family', source);
    assert.deepEqual(equivalent.arena.ranges, result.arena.ranges, source);
    assert.deepEqual(equivalent.packed, result.packed, source);
  }
});

test('plots a set of x-dependent scalars as separate ordered graph series', async () => {
  const kernel = await createKernel();
  const workspace = kernel.createWorkspace().handle;
  const result = plotGeometry(kernel, workspace, '{sin(x),cos(x)}');

  assert.equal(result.program.classification, 'y-of-x');
  assert.equal(symbolicPlotSeriesCount(result.program), 2);
  assert.deepEqual(
    result.arena.ranges.map(({ mode, count }) => ({ mode, count })),
    [
      { mode: 'time-curve', count: view.xSteps },
      { mode: 'time-curve', count: view.xSteps }
    ]
  );
});
test('distributes a set-valued relation into one analytical family while preserving tuples', async () => {
  const kernel = await createKernel();
  const relation = kernel.compile('x^2+y^2={1..5}').value;

  assert.deepEqual(relation.diagnostics, []);
  assert.equal(relation.classification, 'implicit-curve');
  assert.equal(relation.variants.length, 5);
  assert.deepEqual(relation.variants.map(({ right }) => right.value), [1, 2, 3, 4, 5]);

  const tupleRelation = kernel.compile('x^2+y^2=(1..5)').value;
  assert.equal(tupleRelation.variants.length, 1);
  assert.equal(tupleRelation.ast.right.kind, 'range');
});

test('distributes sets cartesianly while translating linked tuples as whole graphs', async () => {
  const kernel = await createKernel();
  const workspace = kernel.createWorkspace().handle;

  const grid = plotGeometry(kernel, workspace, '{1..4}+{1..4}*i').geometry;
  assert.equal(grid.points.length, 16);
  assert.equal(grid.segments.length, 0);
  assert.deepEqual(
    [...grid.points].sort(([ax, ay], [bx, by]) => ax - bx || ay - by),
    [1, 2, 3, 4].flatMap((x) => [1, 2, 3, 4].map((y) => [x, y]))
  );

  const squarePlot = plotGeometry(kernel, workspace, 'i^(1..5)+4i^{1..4}');
  assert.equal(squarePlot.program.variants.length, 4);
  assert.ok(squarePlot.program.variants.every(({ kind }) => kind === 'tuple'));
  assert.deepEqual(
    squarePlot.arena.ranges.map(({ mode, count }) => ({ mode, count })),
    [1, 2, 3, 4].flatMap(() => [
      { mode: 'points', count: 5 },
      { mode: 'linked-line-segments', count: 8 }
    ])
  );
  assert.equal(squarePlot.geometry.points.length, 16);
  assert.equal(squarePlot.geometry.segments.length, 16);

  const centers = squarePlot.geometry.points.reduce((groups, point, index) => {
    const group = Math.floor(index / 4);
    groups[group][0] += point[0] / 4;
    groups[group][1] += point[1] / 4;
    return groups;
  }, [[0, 0], [0, 0], [0, 0], [0, 0]]);
  assert.deepEqual(centers, [[0, 4], [-4, 0], [0, -4], [4, 0]]);
  for (let square = 0; square < 4; square += 1) {
    const vertices = squarePlot.geometry.points.slice(square * 4, square * 4 + 4);
    const segments = squarePlot.geometry.segments.slice(square * 4, square * 4 + 4);
    assert.deepEqual(segments.map(([from, to]) => [vertices.indexOf(from), vertices.indexOf(to)]), [
      [0, 1], [1, 2], [2, 3], [3, 0]
    ]);
  }
});

test('emits ordinary linked tuple vertices before linked edges', async () => {
  const kernel = await createKernel();
  const workspace = kernel.createWorkspace().handle;
  const result = plotGeometry(kernel, workspace, '(1,2,3,4)');

  assert.equal(result.program.latex, '\\left(1, 2, 3, 4\\right)');
  assert.deepEqual(result.arena.ranges.map(({ mode, first, count }) => ({ mode, first, count })), [
    { mode: 'points', first: 0, count: 4 },
    { mode: 'linked-line-segments', first: 4, count: 6 }
  ]);
  assert.deepEqual(result.geometry.points, [[1, 0], [2, 0], [3, 0], [4, 0]]);
  assert.deepEqual(result.geometry.segments, [
    [[1, 0], [2, 0]],
    [[2, 0], [3, 0]],
    [[3, 0], [4, 0]]
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
