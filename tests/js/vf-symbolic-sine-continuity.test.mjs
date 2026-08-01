import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createSymbolicKernel } from '../../web/vf-ui/vf-symbolic-kernel-runtime.mjs';

const artifactRoot = new URL('../../web/vf-ui/artifacts/', import.meta.url);

test('emits an ordered smooth sin(x) line strip across negative pi', async () => {
  const wasm = await readFile(new URL('vkf-symbolic-kernel.wasm', artifactRoot));
  const manifest = JSON.parse(
    await readFile(new URL('vkf-symbolic-kernel.json', artifactRoot), 'utf8')
  );
  const { instance } = await WebAssembly.instantiate(wasm);
  const kernel = createSymbolicKernel({ instance, manifest });
  const program = kernel.compile('sin(x)');
  const workspace = kernel.createWorkspace();
  const xMin = -3.3;
  const xMax = -3.0;
  const xSteps = 65;
  const plot = kernel.plot(
    program.handle,
    workspace.handle,
    {
      xMin,
      xMax,
      yMin: -1,
      yMax: 1,
      xSteps,
      ySteps: 9,
      fieldXSteps: 9,
      fieldYSteps: 9,
      tMin: 0,
      tMax: 1,
      tSteps: 9,
      t: 0,
      vectorScale: 0.1
    },
    {
      edgeR: 1,
      edgeG: 1,
      edgeB: 1,
      edgeA: 1,
      faceR: 1,
      faceG: 1,
      faceB: 1,
      faceA: 1,
      valueMin: -1,
      valueMax: 1
    },
    1
  );
  const packed = new Float32Array(kernel.memory.buffer, plot.pointer, plot.count * 6);
  const points = Array.from({ length: plot.count }, (_, index) => ({
    x: packed[index * 6],
    y: packed[index * 6 + 1]
  }));

  assert.equal(plot.count, xSteps);
  assert.deepEqual(
    plot.ranges.map((range) => ({ ...range })),
    [{ mode: 'time-curve', part: 'edge', first: 0, count: xSteps }]
  );
  assert.ok(points.every((point, index) => index === 0 || points[index - 1].x < point.x));
  assert.ok(points.every((point) => Math.abs(point.y - Math.sin(point.x)) < 1e-6));
  assert.ok(points.every((point, index) => index === 0 || points[index - 1].y > point.y));

  const largestSecondDifference = Math.max(
    ...points.slice(1, -1).map((point, index) => (
      Math.abs(points[index].y - 2 * point.y + points[index + 2].y)
    ))
  );
  assert.ok(largestSecondDifference < 1e-4, `unexpected local spike: ${largestSecondDifference}`);
});
