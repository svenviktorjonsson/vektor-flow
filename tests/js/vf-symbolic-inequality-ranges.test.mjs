import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createSymbolicKernel } from '../../web/vf-ui/vf-symbolic-kernel-runtime.mjs';

const artifactRoot = new URL('../../web/vf-ui/artifacts/', import.meta.url);
const view = Object.freeze({
  xMin: -2, xMax: 2, yMin: -2, yMax: 2,
  xSteps: 9, ySteps: 9, fieldXSteps: 9, fieldYSteps: 9,
  tMin: 0, tMax: 1, tSteps: 9, t: 0, vectorScale: 0.1
});
const style = Object.freeze({
  edgeR: 1, edgeG: 0, edgeB: 0, edgeA: 0.9,
  faceR: 0, faceG: 0.25, faceB: 1, faceA: 0.4,
  valueMin: -1, valueMax: 1
});

test('encodes strict faces and non-strict face plus edge ranges with independent colors', async () => {
  const wasm = await readFile(new URL('vkf-symbolic-kernel.wasm', artifactRoot));
  const manifest = JSON.parse(
    await readFile(new URL('vkf-symbolic-kernel.json', artifactRoot), 'utf8')
  );
  const { instance } = await WebAssembly.instantiate(wasm);
  const kernel = createSymbolicKernel({ instance, manifest });
  const workspace = kernel.createWorkspace();

  for (const [operator, classification, parts] of [
    ['<', 'open-region', ['face']],
    ['>', 'open-region', ['face']],
    ['<=', 'closed-region', ['face', 'edge']],
    ['>=', 'closed-region', ['face', 'edge']]
  ]) {
    const program = kernel.compile(`x^2 + y^2 ${operator} 1`);
    const plot = kernel.plot(program.handle, workspace.handle, view, style, parts.length);
    const vertices = plot.data;

    assert.equal(program.value.classification, classification);
    assert.deepEqual(plot.ranges.map((range) => range.part), parts);
    assert.deepEqual(plot.ranges.map((range) => range.mode),
      parts.length === 1 ? ['triangles'] : ['triangles', 'linked-line-segments']);
    assert.deepEqual(Array.from(vertices.slice(2, 6), (value) => Number(value.toFixed(3))), [0, 0.25, 1, 0.4]);
    if (parts.length === 2) {
      const edgeColorOffset = plot.ranges[1].first * 6 + 2;
      assert.deepEqual(
        Array.from(vertices.slice(edgeColorOffset, edgeColorOffset + 4), (value) => Number(value.toFixed(3))),
        [1, 0, 0, 0.9]
      );
      assert.ok(plot.ranges[1].count > 0);
    }
  }
});

test('compiles chained parameter bounds for time-clipped parametric curves', async () => {
  const wasm = await readFile(new URL('vkf-symbolic-kernel.wasm', artifactRoot));
  const manifest = JSON.parse(
    await readFile(new URL('vkf-symbolic-kernel.json', artifactRoot), 'utf8')
  );
  const { instance } = await WebAssembly.instantiate(wasm);
  const kernel = createSymbolicKernel({ instance, manifest });

  const program = kernel.compile('0<x<t').value;

  assert.deepEqual(program.diagnostics, []);
  assert.equal(program.classification, 'open-region');
  assert.deepEqual(program.variables, ['x', 't']);
  assert.equal(program.ast.op, 'and');
  assert.deepEqual([program.ast.left.op, program.ast.right.op], ['<', '<']);

  const context = {
    kind: 'global', dimension: 2, originX: 0, originY: 0,
    basisXX: 1, basisXY: 0, basisYX: 0, basisYY: 1
  };
  const bounded = kernel.workspaceCompile(
    kernel.createWorkspace().handle, '0<x<t', context
  );
  const curve = kernel.workspaceCompile(bounded.workspace, '[x,0]', context);
  const plot = kernel.plot(curve.program, curve.workspace, {
    ...view, tMin: 0, tMax: 1, tSteps: 9, t: 0.5
  }, style, 1);
  const xs = Array.from({ length: 9 }, (_, index) => plot.data[index * 6]);

  assert.deepEqual(xs.slice(0, 5), [0, 0.125, 0.25, 0.375, 0.5]);
  assert.equal(Number.isFinite(xs[5]), false);
});

test('binds an arbitrary curve parameter name when applying animated bounds', async () => {
  const wasm = await readFile(new URL('vkf-symbolic-kernel.wasm', artifactRoot));
  const manifest = JSON.parse(
    await readFile(new URL('vkf-symbolic-kernel.json', artifactRoot), 'utf8')
  );
  const { instance } = await WebAssembly.instantiate(wasm);
  const kernel = createSymbolicKernel({ instance, manifest });
  const context = {
    kind: 'global', dimension: 2, originX: 0, originY: 0,
    basisXX: 1, basisXY: 0, basisYX: 0, basisYY: 1
  };
  for (const parameter of ['u', 'v', 'y']) {
    const bounded = kernel.workspaceCompile(
      kernel.createWorkspace().handle, `0<${parameter}<t`, context
    );
    const curve = kernel.workspaceCompile(
      bounded.workspace, `[cos(${parameter}),sin(${parameter})]`, context
    );
    const plot = kernel.plot(curve.program, curve.workspace, {
      ...view, tMin: 0, tMax: 1, tSteps: 9, t: 0.5
    }, style, 1);

    assert.deepEqual(
      Array.from(plot.data.slice(0, 12), (value) => Number(value.toFixed(6))),
      [1, 0, 1, 0, 0, 0.9, 0.992198, 0.124675, 1, 0, 0, 0.9],
      parameter
    );
    assert.equal(Number.isFinite(plot.data[5 * 6]), false, parameter);
  }
});

test('materializes vertices only for inclusive parameter boundaries', async () => {
  const wasm = await readFile(new URL('vkf-symbolic-kernel.wasm', artifactRoot));
  const manifest = JSON.parse(
    await readFile(new URL('vkf-symbolic-kernel.json', artifactRoot), 'utf8')
  );
  const { instance } = await WebAssembly.instantiate(wasm);
  const kernel = createSymbolicKernel({ instance, manifest });
  const context = {
    kind: 'global', dimension: 2, originX: 0, originY: 0,
    basisXX: 1, basisXY: 0, basisYX: 0, basisYY: 1
  };

  for (const [constraint, expectedRanges] of [
    ['0<u<t', [{ mode: 'time-curve', part: 'edge', first: 0, count: 9 }]],
    ['0<=u<=t', [
      { mode: 'time-curve', part: 'edge', first: 0, count: 9 },
      { mode: 'points', part: 'edge', first: 9, count: 2 }
    ]]
  ]) {
    const bounded = kernel.workspaceCompile(
      kernel.createWorkspace().handle, constraint, context
    );
    const curve = kernel.workspaceCompile(bounded.workspace, '[cos(u),sin(u)]', context);
    const plot = kernel.plot(curve.program, curve.workspace, {
      ...view, tMin: 0, tMax: 1, tSteps: 9, t: 0.5
    }, style, expectedRanges.length);

    assert.deepEqual(plot.ranges, expectedRanges, constraint);
  }
});

test('keeps equality endpoints as a live boundary-only constraint after curve deletion', async () => {
  const wasm = await readFile(new URL('vkf-symbolic-kernel.wasm', artifactRoot));
  const manifest = JSON.parse(
    await readFile(new URL('vkf-symbolic-kernel.json', artifactRoot), 'utf8')
  );
  const { instance } = await WebAssembly.instantiate(wasm);
  const kernel = createSymbolicKernel({ instance, manifest });
  const context = {
    kind: 'global', dimension: 2, originX: 0, originY: 0,
    basisXX: 1, basisXY: 0, basisYX: 0, basisYY: 1
  };
  const source = String.raw`0=u \/ u=t`;
  const compiled = kernel.compile(source).value;

  assert.deepEqual(compiled.diagnostics, []);
  assert.equal(compiled.ast.op, 'or');
  assert.equal(compiled.classification, 'boundary-constraint');

  const bounded = kernel.workspaceCompile(kernel.createWorkspace().handle, source, context);
  const curve = kernel.workspaceCompile(bounded.workspace, '[cos(u),sin(u)]', context);
  const plot = kernel.plot(curve.program, curve.workspace, {
    ...view, tMin: 0, tMax: 1, tSteps: 9, t: 0.5
  }, style, 2);
  const finite = Array.from({ length: 9 }, (_, index) => Number.isFinite(plot.data[index * 6]));

  assert.deepEqual(finite, [true, false, false, false, true, false, false, false, false]);
  assert.deepEqual(plot.ranges, [
    { mode: 'time-curve', part: 'edge', first: 0, count: 9 },
    { mode: 'points', part: 'edge', first: 9, count: 2 }
  ]);
});

test('parses native conjunction and disjunction operators as VKF relations', async () => {
  const wasm = await readFile(new URL('vkf-symbolic-kernel.wasm', artifactRoot));
  const manifest = JSON.parse(
    await readFile(new URL('vkf-symbolic-kernel.json', artifactRoot), 'utf8')
  );
  const { instance } = await WebAssembly.instantiate(wasm);
  const kernel = createSymbolicKernel({ instance, manifest });

  const conjunction = kernel.compile(String.raw`0<=u /\ u<=t`).value;
  const disjunction = kernel.compile(String.raw`0=u \/ u=t`).value;

  assert.deepEqual(conjunction.diagnostics, []);
  assert.equal(conjunction.ast.op, 'and');
  assert.equal(conjunction.classification, 'closed-region');
  assert.deepEqual(disjunction.diagnostics, []);
  assert.equal(disjunction.ast.op, 'or');
  assert.equal(disjunction.classification, 'boundary-constraint');
});
