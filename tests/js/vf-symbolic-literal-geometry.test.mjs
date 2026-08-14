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

function plotGeometry(kernel, workspace, source, viewOverrides = {}, context = null) {
  const compiled = context
    ? kernel.workspaceCompile(workspace, source, context)
    : kernel.compile(source);
  const programValue = context ? compiled.value.program : compiled.value;
  const programHandle = context ? compiled.program : compiled.handle;
  const activeWorkspace = context ? compiled.workspace : workspace;
  assert.deepEqual(programValue.diagnostics, [], source);
  const arena = kernel.plot(programHandle, activeWorkspace, { ...view, ...viewOverrides }, style, 1);
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
    program: programValue,
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

test('applies workspace inequalities to later curves and marks inclusive endpoints', async () => {
  const kernel = await createKernel();
  const context = {
    kind: 'global', dimension: 2, originX: 0, originY: 0,
    basisXX: 1, basisXY: 0, basisYX: 0, basisYY: 1
  };

  const strictConstraint = kernel.workspaceCompile(
    kernel.createWorkspace().handle, 'x<2', context
  );
  const strictCurve = kernel.workspaceCompile(
    strictConstraint.workspace, 'x^2', context
  );
  const strictPlot = kernel.plot(
    strictCurve.program, strictCurve.workspace,
    { ...view, xMin: -4, xMax: 4, xSteps: 9 }, style, 1
  );
  assert.deepEqual(strictPlot.ranges.map((range) => ({ ...range })), [
    { mode: 'time-curve', part: 'edge', first: 0, count: 9 }
  ]);
  assert.equal(strictPlot.data[6 * 6], 2);
  assert.equal(strictPlot.data[6 * 6 + 1], 4);
  assert.equal(Number.isFinite(strictPlot.data[7 * 6 + 1]), false);

  const closedConstraint = kernel.workspaceCompile(
    kernel.createWorkspace().handle, 'x<=2', context
  );
  const closedCurve = kernel.workspaceCompile(
    closedConstraint.workspace, 'x^2', context
  );
  const closedPlot = kernel.plot(
    closedCurve.program, closedCurve.workspace,
    { ...view, xMin: -4, xMax: 4, xSteps: 9 }, style, 2
  );
  assert.deepEqual(closedPlot.ranges.map((range) => ({ ...range })), [
    { mode: 'time-curve', part: 'edge', first: 0, count: 9 },
    { mode: 'points', part: 'edge', first: 9, count: 1 }
  ]);
  assert.deepEqual(Array.from(closedPlot.data.slice(9 * 6, 9 * 6 + 2)), [2, 4]);
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

test('preserves set and tuple exponent semantics while grouped ranges equal sets', async () => {
  const kernel = await createKernel();
  const workspace = kernel.createWorkspace().handle;

  const unlinked = plotGeometry(kernel, workspace, 'i^{1,2}');
  assert.equal(unlinked.program.latex, '{i}^{\\left\\{1, 2\\right\\}}');
  assert.deepEqual(unlinked.geometry.points, [[0, 1], [-1, 0]]);
  assert.deepEqual(unlinked.geometry.segments, []);

  const linked = plotGeometry(kernel, workspace, 'i^(1,2)');
  assert.equal(linked.program.latex, '{i}^{\\left(1, 2\\right)}');
  assert.deepEqual(linked.geometry.points, [[0, 1], [-1, 0]]);
  assert.deepEqual(linked.geometry.segments, [[[0, 1], [-1, 0]]]);

  const groupedRange = plotGeometry(kernel, workspace, 'i^(1..5)');
  const setRange = plotGeometry(kernel, workspace, 'i^{1..5}');
  assert.deepEqual(groupedRange.geometry, setRange.geometry);
  assert.equal(groupedRange.geometry.points.length, 4);
  assert.equal(groupedRange.geometry.segments.length, 0);
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

test('links tuples only when their expanded elements contain at most t', async () => {
  const kernel = await createKernel();
  const workspace = kernel.createWorkspace().handle;

  const movingGeometry = plotGeometry(kernel, workspace, '(t,t+1)', { t: 2 });
  assert.equal(movingGeometry.program.classification, 'linked-tuple');
  assert.deepEqual(movingGeometry.geometry.segments, [[[2, 0], [3, 0]]]);

  const powerFunctions = plotGeometry(kernel, workspace, 'x^(1,2,3)');
  assert.equal(powerFunctions.program.classification, 'y-of-x');
  assert.equal(symbolicPlotSeriesCount(powerFunctions.program), 3);
  assert.equal(powerFunctions.arena.ranges.length, 3);

  const tupleFunctions = plotGeometry(kernel, workspace, '(x,x^2)');
  assert.equal(tupleFunctions.program.classification, 'y-of-x');
  assert.equal(symbolicPlotSeriesCount(tupleFunctions.program), 2);
  assert.equal(tupleFunctions.arena.ranges.length, 2);
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

test('plots independent coefficient ranges as a Cartesian curve family', async () => {
  const kernel = await createKernel();
  const workspace = kernel.createWorkspace().handle;
  const result = plotGeometry(
    kernel,
    workspace,
    '5sin({1..3}x-{1..4}t)',
    { t: 66.95 },
    { kind: 'global', dimension: 2, n: 0, N: 1 }
  );

  assert.equal(result.program.classification, 'y-of-x');
  assert.equal(symbolicPlotSeriesCount(result.program), 12);
  assert.equal(result.arena.ranges.length, 12);
  assert.ok(result.arena.ranges.every(({ mode, count }) => (
    mode === 'time-curve' && count === view.xSteps
  )));

  const compiled = kernel.workspaceCompile(
    workspace,
    '5sin({1..3}x-{1..4}t)',
    { kind: 'global', dimension: 2, n: 0, N: 1 }
  );
  for (let variantIndex = 0; variantIndex < 12; variantIndex += 1) {
    const arena = kernel.plotVariant(
      compiled.program,
      compiled.workspace,
      { ...view, t: 66.95, xSteps: 1122 },
      style,
      1,
      variantIndex
    );
    assert.equal(arena.ranges.length, 1);
    assert.equal(arena.ranges[0].count, 1122);
  }
});

test('expands a parenthesized range inside a function like a set range', async () => {
  const kernel = await createKernel();
  const workspace = kernel.createWorkspace().handle;
  const result = plotGeometry(
    kernel,
    workspace,
    '5sin(x-(1..4)t)',
    { t: 74.43 },
    { kind: 'global', dimension: 2, n: 0, N: 1 }
  );

  assert.equal(symbolicPlotSeriesCount(result.program), 4);
  assert.equal(result.program.variants.length, 4);
  assert.equal(result.arena.ranges.length, 4);

  const zipped = plotGeometry(
    kernel,
    workspace,
    '(2,3,4,5)sin(x-(1..4)t)',
    { t: 1 },
    { kind: 'global', dimension: 2, n: 0, N: 1 }
  );
  assert.equal(symbolicPlotSeriesCount(zipped.program), 4);
  assert.equal(zipped.program.variants.length, 4);
  assert.equal(zipped.arena.ranges.length, 4);
});

test('zips equal tuples inside functions and relations', async () => {
  const kernel = await createKernel();
  const workspace = kernel.createWorkspace().handle;
  const curve = plotGeometry(kernel, workspace, 'sin((1,2,3)x-(4,5,6)t)');
  const relation = kernel.compile('y=(1,2,3)x').value;

  assert.equal(symbolicPlotSeriesCount(curve.program), 3);
  assert.equal(curve.arena.ranges.length, 3);
  assert.equal(relation.variants.length, 3);
});

test('combines zipped tuples with Cartesian sets', async () => {
  const kernel = await createKernel();
  const workspace = kernel.createWorkspace().handle;
  const result = plotGeometry(kernel, workspace, 'sin((1,2,3)x-{1..4}t)');

  assert.equal(symbolicPlotSeriesCount(result.program), 12);
  assert.equal(result.arena.ranges.length, 12);
});

test('rejects mismatched tuples inside one function or relation', async () => {
  const kernel = await createKernel();
  const mismatch = kernel.compile('sin((1,2)x-(3,4,5)t)').value;

  assert.equal(mismatch.diagnostics.length, 1);
  assert.equal(mismatch.diagnostics[0].code, 'tuple-length-mismatch');
});

test('keeps a standalone tuple as linked geometry', async () => {
  const kernel = await createKernel();
  const workspace = kernel.createWorkspace().handle;
  const standalone = plotGeometry(kernel, workspace, '(1,2,3)');

  assert.equal(standalone.program.classification, 'linked-tuple');
  assert.equal(standalone.geometry.points.length, 3);
  assert.equal(standalone.geometry.segments.length, 2);
});
test('distributes a set-valued relation into one analytical family while preserving tuples', async () => {
  const kernel = await createKernel();
  const relation = kernel.compile('x^2+y^2={1..5}').value;

  assert.deepEqual(relation.diagnostics, []);
  assert.equal(relation.classification, 'implicit-curve');
  assert.equal(relation.variants.length, 5);
  assert.deepEqual(relation.variants.map(({ right }) => right.value), [1, 2, 3, 4, 5]);

  const tupleRelation = kernel.compile('x^2+y^2=(1..5)').value;
  assert.equal(tupleRelation.variants.length, 5);
  assert.deepEqual(
    tupleRelation.variants.map(({ right }) => right.value),
    [1, 2, 3, 4, 5]
  );
});

test('distributes sets cartesianly as unlinked points', async () => {
  const kernel = await createKernel();
  const workspace = kernel.createWorkspace().handle;

  const grid = plotGeometry(kernel, workspace, '{1..4}+{1..4}*i').geometry;
  assert.equal(grid.points.length, 16);
  assert.equal(grid.segments.length, 0);
  assert.deepEqual(
    [...grid.points].sort(([ax, ay], [bx, by]) => ax - bx || ay - by),
    [1, 2, 3, 4].flatMap((x) => [1, 2, 3, 4].map((y) => [x, y]))
  );
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

test('treats a grouped exponent range exactly like a set exponent range', async () => {
  const kernel = await createKernel();
  const workspace = kernel.createWorkspace().handle;
  const grouped = plotGeometry(kernel, workspace, 'i^(1..5)').geometry;
  const set = plotGeometry(kernel, workspace, 'i^{1..5}').geometry;
  const [i, minusOne, minusI, one] = [[0, 1], [-1, 0], [0, -1], [1, 0]];

  assert.deepEqual(grouped, set);
  assert.deepEqual(grouped.points, [i, minusOne, minusI, one]);
  assert.deepEqual(grouped.segments, []);
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

test('evaluates n and N from immutable plot context constants', async () => {
  const kernel = await createKernel();
  const workspace = kernel.createWorkspace().handle;
  const context = {
    kind: 'vertex', dimension: 2,
    originX: 0, originY: 0,
    basisXX: 1, basisXY: 0, basisYX: 0, basisYY: 1,
    n: 2, N: 4
  };
  const result = plotGeometry(kernel, workspace, 'x^n+n/(N-1)-2/3', {}, context);

  assert.equal(result.program.classification, 'y-of-x');
  assert.deepEqual(result.geometry.segments[0][0], [-5, 25]);
  assert.deepEqual(result.geometry.segments.at(-1)[1], [5, 25]);
});

test('plots named functions and constants from earlier workspace relations', async () => {
  const kernel = await createKernel();
  const context = {
    kind: 'global', dimension: 2,
    originX: 0, originY: 0, basisXX: 1, basisXY: 0, basisYX: 0, basisYY: 1,
    n: 0, N: 1
  };
  let workspace = kernel.createWorkspace().handle;
  workspace = kernel.workspaceCompile(workspace, 'f(x)=x^2', context).workspace;
  workspace = kernel.workspaceCompile(workspace, 'p=4', context).workspace;
  const compiled = kernel.workspaceCompile(workspace, 'f(x)^2+x^p-x^4', context);
  const arena = kernel.plot(compiled.program, compiled.workspace, view, style, 1);
  const geometry = symbolicPlotSnapGeometry({ data: arena.data, ranges: arena.ranges });

  assert.equal(compiled.value.program.classification, 'y-of-x');
  assert.deepEqual(geometry.segments[0][0], [-5, 625]);
  assert.deepEqual(geometry.segments.at(-1)[1], [5, 625]);
});
