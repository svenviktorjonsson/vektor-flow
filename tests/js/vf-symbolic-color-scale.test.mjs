import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createSymbolicKernel } from '../../web/vf-ui/vf-symbolic-kernel-runtime.mjs';

const artifactRoot = new URL('../../web/vf-ui/artifacts/', import.meta.url);
const view = {
  xMin: -1, xMax: 1, yMin: 0, yMax: 1,
  xSteps: 3, ySteps: 3,
  fieldXSteps: 3, fieldYSteps: 3,
  tMin: 0, tMax: 1, tSteps: 3,
  t: 0, vectorScale: 0.35
};
const colormapPoints = [
  { pos: 0, color: [0, 0, 0], alpha: 1, order: 1 },
  { pos: 1, color: [255, 255, 255], alpha: 1, order: 1 }
];

async function createKernel() {
  const wasm = await readFile(new URL('vkf-symbolic-kernel.wasm', artifactRoot));
  const manifest = JSON.parse(await readFile(new URL('vkf-symbolic-kernel.json', artifactRoot), 'utf8'));
  const { instance } = await WebAssembly.instantiate(wasm);
  return createSymbolicKernel({ instance, manifest });
}

function style(mode) {
  return {
    edgeR: 1, edgeG: 1, edgeB: 1, edgeA: 1,
    faceR: 1, faceG: 1, faceB: 1, faceA: 1,
    valueMin: 0, valueMax: 1,
    magnitudeMin: 0, magnitudeMax: 2,
    colorScaleMode: mode,
    colormapPoints
  };
}

function plot(kernel, workspace, source, mode) {
  const program = kernel.compile(source);
  assert.deepEqual(program.value.diagnostics, []);
  return {
    program: program.value,
    arena: kernel.plot(program.handle, workspace, view, style(mode), 1)
  };
}

function colorAt(arena, x, y) {
  for (let index = 0; index < arena.data.length; index += 6) {
    if (Math.abs(arena.data[index] - x) < 1e-6 && Math.abs(arena.data[index + 1] - y) < 1e-6) {
      return Array.from(arena.data.slice(index + 2, index + 6));
    }
  }
  assert.fail(`missing field vertex at ${x},${y}`);
}

test('GPU scalar fields clamp or cyclically repeat normalized values', async () => {
  const kernel = await createKernel();
  const workspace = kernel.createWorkspace().handle;
  const clamped = plot(kernel, workspace, 'x + y', 'clamp');
  const cyclic = plot(kernel, workspace, 'x + y', 'cyclic');

  assert.equal(clamped.program.classification, 'scalar-field');
  assert.deepEqual(colorAt(clamped.arena, 1, 1), [1, 1, 1, 1]);
  assert.deepEqual(colorAt(cyclic.arena, 1, 1), [0, 0, 0, 1]);
});

test('GPU complex fields map phase to color and magnitude to alpha', async () => {
  const kernel = await createKernel();
  const workspace = kernel.createWorkspace().handle;
  const clamped = plot(kernel, workspace, 'x + y * i', 'clamp');
  const cyclic = plot(kernel, workspace, 'x + y * i', 'cyclic');

  assert.equal(clamped.program.classification, 'complex-field');
  assert.deepEqual(colorAt(clamped.arena, -1, 0), [1, 1, 1, 0.5]);
  assert.deepEqual(colorAt(cyclic.arena, -1, 0), [0, 0, 0, 0.5]);
});
