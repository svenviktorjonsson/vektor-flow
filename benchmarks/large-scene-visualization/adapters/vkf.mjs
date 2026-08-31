import { generatePointFixtureBytes } from '../point-fixture.mjs';
import {
  cameraOffsetForFrame,
  projectionForFrame,
} from '../point-frame-oracle.mjs';
import { createScreenSpacePointCloudRenderer } from '../../../web/vf-ui/geom/vf-screen-point-cloud-renderer.mjs';
import { setRetainedWorldPointCloud2D } from '../../../web/vf-ui/geom/internal/vf-retained-point-cloud-camera.mjs';

export { cameraOffsetForFrame };

function fixtureView(bytes) {
  const exactBytes = Uint8Array.from(bytes);
  return { bytes: exactBytes, points: new Float32Array(exactBytes.buffer) };
}

async function sha256(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is required by the VKF benchmark adapter');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function createVkfLargeSceneAdapter(canvas, workload, options = {}) {
  const fixtureBytes = options.fixtureBytes ?? generatePointFixtureBytes(workload.fixture, workload.pointCount);
  const fixture = fixtureView(fixtureBytes);
  const points = fixture.points;
  const rendererFactory = options.rendererFactory ?? createScreenSpacePointCloudRenderer;
  if (canvas && typeof canvas === 'object') {
    [canvas.width, canvas.height] = workload.viewport;
  }
  const renderer = rendererFactory(canvas);
  let initialized = false;
  let rendered = false;
  let retainedProjection = null;

  function sameProjection(left, right) {
    return left != null && ['worldOrigin', 'screenOrigin', 'xAxis', 'yAxis', 'zAxis']
      .every((name) => left[name].every((value, index) => value === right[name][index]));
  }

  function renderFrame(frame) {
    if (!initialized) throw new Error('VKF large-scene adapter must initialize before rendering');
    const nextProjection = projectionForFrame(workload, frame);
    if (rendered && sameProjection(retainedProjection, nextProjection)) return;
    setRetainedWorldPointCloud2D(renderer, points, nextProjection, {
      count: workload.pointCount,
      pointSize: workload.pointDiameterPixels,
      color: workload.pointRgba.map((value) => value / 255),
    });
    retainedProjection = nextProjection;
    rendered = true;
  }

  async function initialize() {
    if (initialized) return;
    const actualHash = await sha256(fixture.bytes);
    if (actualHash !== workload.fixture.sha256) {
      throw new Error(`${workload.id} fixture hash ${actualHash}; expected ${workload.fixture.sha256}`);
    }
    await renderer.initialize();
    initialized = true;
    renderFrame(0);
  }

  function destroy() {
    renderer.destroy();
    initialized = false;
    rendered = false;
    retainedProjection = null;
  }

  return Object.freeze({ initialize, renderFrame, destroy });
}
