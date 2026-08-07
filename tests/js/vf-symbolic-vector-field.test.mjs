import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createSymbolicKernel } from '../../web/vf-ui/vf-symbolic-kernel-runtime.mjs';

const artifactRoot = new URL('../../web/vf-ui/artifacts/', import.meta.url);

test('starts vector glyphs on data-grid crossings and terminates them with arrowheads', async () => {
  const wasm = await readFile(new URL('vkf-symbolic-kernel.wasm', artifactRoot));
  const manifest = JSON.parse(await readFile(
    new URL('vkf-symbolic-kernel.json', artifactRoot), 'utf8'
  ));
  const { instance } = await WebAssembly.instantiate(wasm);
  const kernel = createSymbolicKernel({ instance, manifest });
  const program = kernel.compile('[1+x*0,0+y*0]');
  const arena = kernel.plot(program.handle, kernel.createWorkspace().handle, {
    xMin: -2.4, xMax: 2.4, yMin: -1.4, yMax: 1.4,
    xSteps: 65, ySteps: 65,
    fieldXMin: -2, fieldYMin: -1,
    fieldXInterval: 1, fieldYInterval: 1,
    fieldXSteps: 5, fieldYSteps: 3,
    tMin: 0, tMax: 1, tSteps: 65, t: 0,
    vectorScale: 0.35, vectorArrowLength: 0.12, vectorArrowWidth: 0.07
  }, {
    edgeR: 1, edgeG: 1, edgeB: 1, edgeA: 1,
    faceR: 1, faceG: 1, faceB: 1, faceA: 1,
    valueMin: 0, valueMax: 1, colormapPoints: null
  }, 1);

  assert.equal(arena.ranges[0].mode, 'vector-field-glyphs');
  assert.equal(arena.count, 5 * 3 * 6);
  const xy = (vertex) => Array.from(arena.data.slice(vertex * 6, vertex * 6 + 2));
  assert.deepEqual(xy(0), [-2, -1]);
  assert.ok(Math.abs(xy(1)[0] - -1.65) < 1e-6);
  assert.equal(xy(1)[1], -1);
  assert.ok(Math.abs(xy(2)[0] - -1.65) < 1e-6);
  assert.equal(xy(2)[1], -1);
  assert.ok(Math.abs(xy(3)[0] - -1.77) < 1e-6);
  assert.ok(Math.abs(xy(3)[1] - -0.93) < 1e-6);
  assert.ok(Math.abs(xy(4)[0] - -1.65) < 1e-6);
  assert.equal(xy(4)[1], -1);
  assert.ok(Math.abs(xy(5)[1] - -1.07) < 1e-6);
});

test('normalizes one vector field proportionally below its grid spacing', async () => {
  const wasm = await readFile(new URL('vkf-symbolic-kernel.wasm', artifactRoot));
  const manifest = JSON.parse(await readFile(new URL('vkf-symbolic-kernel.json', artifactRoot), 'utf8'));
  const { instance } = await WebAssembly.instantiate(wasm);
  const kernel = createSymbolicKernel({ instance, manifest });
  const program = kernel.compile('[1+x+0*y,0]');
  const arena = kernel.plot(program.handle, kernel.createWorkspace().handle, {
    xMin: 0, xMax: 1, yMin: 0, yMax: 1,
    xSteps: 65, ySteps: 65,
    fieldXMin: 0, fieldYMin: 0,
    fieldXInterval: 1, fieldYInterval: 1,
    fieldXSteps: 2, fieldYSteps: 1,
    tMin: 0, tMax: 1, tSteps: 65, t: 0,
    vectorScale: 0.8, vectorArrowLength: 0.12, vectorArrowWidth: 0.07
  }, {
    edgeR: 1, edgeG: 1, edgeB: 1, edgeA: 1,
    faceR: 1, faceG: 1, faceB: 1, faceA: 1,
    valueMin: 0, valueMax: 1, colormapPoints: null
  }, 1);

  const x = (vertex) => arena.data[vertex * 6];
  assert.ok(Math.abs((x(1) - x(0)) - 0.4) < 1e-6);
  assert.ok(Math.abs((x(7) - x(6)) - 0.8) < 1e-6);
  assert.ok(x(7) - x(6) < 1);
});
