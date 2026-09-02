import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  captureProceduralRoadSceneFrameReference,
} from '../../web/vf-ui/vf-procedural-road-scene-capture.mjs';
import {
  createRoadConstructionFieldReference,
} from '../../web/vf-ui/vf-road-construction-field.mjs';
import {
  createRoadCoordinateFieldReference,
} from '../../web/vf-ui/vf-road-coordinate-field.mjs';
import {
  createProceduralRoadSceneReference,
} from '../../web/vf-ui/vf-procedural-road-scene.mjs';
import {
  createRoadWearFieldReference,
} from '../../web/vf-ui/vf-road-wear-field.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x6a09e667, 0xbb67ae85]),
  domain: 'material',
  hierarchy: Object.freeze(['world:test', 'road:arterial-7']),
  lod: 0,
  channel: 'road',
});

function captureDocument() {
  return {
    createElement(tagName) {
      assert.equal(tagName, 'canvas');
      const canvas = { width: 0, height: 0, pixels: null };
      canvas.getContext = (kind) => {
        assert.equal(kind, '2d');
        return {
          createImageData(width, height) {
            return {
              data: new Uint8ClampedArray(width * height * 4),
            };
          },
          putImageData(image) {
            canvas.pixels = image.data.slice();
          },
        };
      };
      return canvas;
    },
  };
}

function captureFactory({ fallbackCanvas }) {
  return {
    async screenshot() {
      return new Blob([fallbackCanvas.pixels], { type: 'image/png' });
    },
  };
}

async function completedRoadFrame(rgba8) {
  const scheduled = [];
  const scene = createProceduralRoadSceneReference({
    coordinateField: createRoadCoordinateFieldReference({
      origin: [10, 20, 3],
      forward: [1, 0, 0],
      up: [0, 0, 1],
      cellSize: [1, 0.1],
      longitudinalCells: 1_000_000_000,
      lateralCells: 100,
      layerThicknesses: [1, 2, 4],
    }),
    constructionField: createRoadConstructionFieldReference({
      ...IDENTITY,
      channel: 'road-construction',
    }),
    wearField: createRoadWearFieldReference({
      ...IDENTITY,
      channel: 'road-wear',
    }),
    frameBudget: 1,
    scheduleFrame(callback) {
      scheduled.push(callback);
    },
    drawPipeline: {
      draw(request) {
        return { frame: request.frame, packetCount: request.packet.packets.length };
      },
      destroy() {},
      snapshot() {
        return {};
      },
    },
  });
  const pending = scene.requestFrame({
    demands: [[1, 2, 0]],
    cellBudget: 1,
    pipeline: {},
    outputBuffer: {},
    submit(draw) {
      return { ...draw, rgba8 };
    },
  });
  scheduled.shift()(10);
  const frame = await pending;
  scene.destroy();
  return frame;
}

test('completed road frame captures supplied GPU pixels deterministically', async () => {
  const rgba8 = Uint8Array.from([
    10, 20, 30, 255,
    40, 50, 60, 255,
  ]);
  const frame = await completedRoadFrame(rgba8);
  const options = {
    width: 2,
    height: 1,
    documentRef: captureDocument(),
    captureFactory,
  };

  const first = await captureProceduralRoadSceneFrameReference(frame, options);
  const second = await captureProceduralRoadSceneFrameReference(frame, options);
  const expectedHash = createHash('sha256').update(rgba8).digest('hex');

  assert.equal(first.kind, 'procedural-road-scene-capture:v1');
  assert.strictEqual(first.sourceFrame, frame);
  assert.equal(first.mimeType, 'image/png');
  assert.equal(first.width, 2);
  assert.equal(first.height, 1);
  assert.equal(first.byteLength, 8);
  assert.equal(first.sha256, expectedHash);
  assert.equal(second.sha256, expectedHash);
  assert.deepEqual(first.imageBytes, rgba8);
});

test('road capture rejects invalid GPU image dimensions before allocation', async () => {
  const frame = await completedRoadFrame(Uint8Array.from([1, 2, 3, 255]));
  const options = {
    width: 2,
    height: 1,
    documentRef: {
      createElement() {
        assert.fail('invalid capture must not allocate a canvas');
      },
    },
    captureFactory,
  };

  await assert.rejects(
    captureProceduralRoadSceneFrameReference(frame, options),
    /procedural road scene RGBA image size is invalid/,
  );
  await assert.rejects(
    captureProceduralRoadSceneFrameReference(frame, {
      ...options,
      width: 16_777_217,
      height: 1,
    }),
    /procedural road scene capture exceeds pixel budget/,
  );
});
