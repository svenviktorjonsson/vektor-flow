import test from 'node:test';
import assert from 'node:assert/strict';

import { createWebGpuProbeCanvas } from './vf-gpu-backend-probe.mjs';

test('probes WebGPU on a disposable canvas without claiming the render canvas', () => {
  const renderCanvas = {
    contexts: [],
    getContext(type) {
      this.contexts.push(type);
      return {};
    },
    cloneNode() {
      return {
        getContext(type) {
          return type === 'webgpu' ? {} : null;
        }
      };
    }
  };

  const probeCanvas = createWebGpuProbeCanvas(renderCanvas);
  assert.notEqual(probeCanvas, renderCanvas);
  assert.ok(probeCanvas.getContext('webgpu'));
  assert.deepEqual(renderCanvas.contexts, []);
});
