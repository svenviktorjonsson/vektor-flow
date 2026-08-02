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
