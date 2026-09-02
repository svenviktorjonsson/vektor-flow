import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  captureProceduralRoadSceneFrameReference,
} from '../../web/vf-ui/vf-procedural-road-scene-capture.mjs';
import {
  createProceduralRoadSceneReference,
} from '../../web/vf-ui/vf-procedural-road-scene.mjs';
import {
  createRoadConstructionFieldReference,
} from '../../web/vf-ui/vf-road-construction-field.mjs';
import {
  createRoadCoordinateFieldReference,
} from '../../web/vf-ui/vf-road-coordinate-field.mjs';
import {
  createRoadRendererDrawPipelineReference,
} from '../../web/vf-ui/vf-road-renderer-pipeline.mjs';
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
    createElement() {
      const canvas = { pixels: null };
      canvas.getContext = () => ({
        createImageData(width, height) {
          return { data: new Uint8ClampedArray(width * height * 4) };
        },
        putImageData(image) {
          canvas.pixels = image.data.slice();
        },
      });
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

function fixture() {
  const scheduled = [];
  const calls = { createBuffer: 0, writeBuffer: 0, destroy: 0 };
  const device = {
    createBuffer(specification) {
      calls.createBuffer += 1;
      return {
        specification,
        destroy() {
          calls.destroy += 1;
        },
      };
    },
    queue: {
      writeBuffer() {
        calls.writeBuffer += 1;
      },
    },
  };
  const drawPipeline = createRoadRendererDrawPipelineReference(device, {
    packetBudget: 2,
  });
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
    drawPipeline,
    frameBudget: 1,
    scheduleFrame(callback) {
      scheduled.push(callback);
    },
  });
  return { scene, drawPipeline, scheduled, calls };
}

function submitPixel(draw) {
  const packet = draw.resources[0].packet;
  const color = packet.material_channels.albedo;
  return {
    rgba8: Uint8Array.from([
      ...color.map((value) => Math.round(value * 255)),
      255,
    ]),
  };
}

test('road GPU resources persist across deterministic captured frames', async () => {
  const { scene, drawPipeline, scheduled, calls } = fixture();
  const request = () => scene.requestFrame({
    demands: [[1, 2, 0]],
    cellBudget: 1,
    pipeline: {},
    outputBuffer: {},
    submit: submitPixel,
  });
  const captureOptions = {
    width: 1,
    height: 1,
    documentRef: captureDocument(),
    captureFactory,
  };

  const firstPending = request();
  scheduled.shift()(10);
  const first = await firstPending;
  const firstCapture = await captureProceduralRoadSceneFrameReference(
    first,
    captureOptions,
  );
  const firstResources = first.draw.resources[0];

  const secondPending = request();
  scheduled.shift()(26);
  const second = await secondPending;
  const secondCapture = await captureProceduralRoadSceneFrameReference(
    second,
    captureOptions,
  );

  assert.strictEqual(second.draw.resources[0], firstResources);
  assert.equal(firstCapture.sha256, secondCapture.sha256);
  assert.equal(
    firstCapture.sha256,
    createHash('sha256').update(first.output.rgba8).digest('hex'),
  );
  assert.equal(calls.createBuffer, 3);
  assert.equal(calls.writeBuffer, 3);
  assert.equal(calls.destroy, 0);
  assert.deepEqual(drawPipeline.snapshot(), {
    packetBudget: 2,
    retainedPackets: 1,
    frames: 2,
    draws: 2,
    uploadedBytes: 216,
    destroyedBuffers: 0,
    destroyed: false,
  });

  scene.destroy();
  assert.equal(calls.destroy, 3);
  assert.equal(drawPipeline.snapshot().retainedPackets, 0);
  assert.equal(drawPipeline.snapshot().destroyed, true);
});

test('malformed road GPU delta is rejected without changing retained state', async () => {
  const { scene, drawPipeline, scheduled, calls } = fixture();
  const pending = scene.requestFrame({
    demands: [[1, 2, 0]],
    cellBudget: 1,
    pipeline: {},
    outputBuffer: {},
    submit: submitPixel,
  });
  scheduled.shift()(10);
  const completed = await pending;
  const before = drawPipeline.snapshot();
  const retainedPacket = completed.draw.packet.packets[0];

  assert.throws(
    () => drawPipeline.draw({
      frame: 1,
      packet: {
        ...completed.draw.packet,
        delta: {
          ...completed.draw.packet.delta,
          remove: [retainedPacket.id],
          upsert: [{ id: 'road:cell:forged' }],
        },
      },
    }),
    /road renderer packet delta is invalid/,
  );
  assert.deepEqual(drawPipeline.snapshot(), before);
  assert.equal(calls.destroy, 0);

  scene.destroy();
});
