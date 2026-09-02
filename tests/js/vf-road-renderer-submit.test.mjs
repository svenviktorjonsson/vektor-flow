import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  captureProceduralRoadSceneFrameReference,
} from '../../web/vf-ui/vf-procedural-road-scene-capture.mjs';
import {
  createRoadRendererSubmitReference,
} from '../../web/vf-ui/vf-road-renderer-submit.mjs';

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
  const calls = [];
  const commandBuffer = {};
  const pass = {
    setPipeline(value) {
      calls.push(['setPipeline', value]);
    },
    setBindGroup(index, value) {
      calls.push(['setBindGroup', index, value]);
    },
    setVertexBuffer(index, value) {
      calls.push(['setVertexBuffer', index, value]);
    },
    setIndexBuffer(value, format) {
      calls.push(['setIndexBuffer', value, format]);
    },
    drawIndexed(...args) {
      calls.push(['drawIndexed', ...args]);
    },
    end() {
      calls.push(['end']);
    },
  };
  const device = {
    createBindGroup(specification) {
      const bindGroup = { specification };
      calls.push(['createBindGroup', specification]);
      return bindGroup;
    },
    createCommandEncoder() {
      calls.push(['createCommandEncoder']);
      return {
        beginRenderPass(specification) {
          calls.push(['beginRenderPass', specification]);
          return pass;
        },
        finish() {
          calls.push(['finish']);
          return commandBuffer;
        },
      };
    },
    queue: {
      submit(buffers) {
        calls.push(['submit', buffers]);
      },
    },
  };
  const pipeline = {
    getBindGroupLayout(index) {
      assert.equal(index, 0);
      return 'road-material-layout';
    },
  };
  const colorAttachment = {
    createView() {
      return 'road-color-view';
    },
  };
  const rgba8 = Uint8Array.from([
    24, 28, 32, 255,
    72, 78, 84, 255,
  ]);
  const submit = createRoadRendererSubmitReference(device, {
    pipeline,
    colorAttachment,
    width: 2,
    height: 1,
    async readPixels() {
      calls.push(['readPixels']);
      return rgba8;
    },
  });
  const resources = Object.freeze({
    kind: 'road-renderer-gpu-resources:v1',
    packet: {
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    },
    vertexBuffer: {},
    indexBuffer: {},
    materialBuffer: {},
  });
  return { calls, commandBuffer, submit, pipeline, rgba8, resources };
}

test('road indexed render pass submits and captures deterministic pixels', async () => {
  const { calls, commandBuffer, submit, pipeline, rgba8, resources } = fixture();
  const output = await submit({
    kind: 'road-renderer-draw:v1',
    frame: 3,
    resources: [resources],
  });
  const sceneFrame = {
    kind: 'procedural-material-scene-frame:v1',
    frame: 3,
    output,
  };
  const captured = await captureProceduralRoadSceneFrameReference(sceneFrame, {
    width: 2,
    height: 1,
    documentRef: captureDocument(),
    captureFactory,
  });

  assert.equal(output.kind, 'road-renderer-output:v1');
  assert.deepEqual(output.rgba8, rgba8);
  assert.equal(output.drawCount, 1);
  assert.equal(
    captured.sha256,
    createHash('sha256').update(rgba8).digest('hex'),
  );
  assert.deepEqual(calls.filter(([name]) => name === 'setPipeline'), [
    ['setPipeline', pipeline],
  ]);
  assert.deepEqual(calls.filter(([name]) => name === 'drawIndexed'), [
    ['drawIndexed', 6, 1, 0, 0, 0],
  ]);
  assert.deepEqual(calls.filter(([name]) => name === 'submit'), [
    ['submit', [commandBuffer]],
  ]);
  assert.equal(calls.at(-1)[0], 'readPixels');
});

test('malformed road draw is rejected before command encoding', async () => {
  const { calls, submit } = fixture();

  await assert.rejects(
    submit({
      kind: 'road-renderer-draw:v1',
      frame: 0,
      resources: [{}],
    }),
    /road renderer draw is invalid/,
  );
  assert.deepEqual(calls, []);
});
