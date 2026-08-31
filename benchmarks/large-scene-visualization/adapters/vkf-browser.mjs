import { createVkfLargeSceneAdapter } from './vkf.mjs';
import {
  createBrowserPeerAdapter,
  fixtureView,
  installLargeBufferUploadTracker,
  prepareHost,
} from './browser-common.mjs';

export const VKF_BROWSER_VERSION = '0.4.0-dev';

export function createVkfBrowserLargeSceneAdapter(host, workload, options = {}) {
  prepareHost(host, workload);
  const fixture = fixtureView(workload, options.fixtureBytes);
  const tracker = options.tracker ?? installLargeBufferUploadTracker(workload.pointCount * 4);
  const canvas = document.createElement('canvas');
  host.append(canvas);
  const renderer = createVkfLargeSceneAdapter(canvas, workload, {
    fixtureBytes: fixture.bytes,
    forceStaticDraw: options.forceStaticDraw === true,
  });
  return createBrowserPeerAdapter({
    version: VKF_BROWSER_VERSION,
    host,
    workload,
    fixture,
    tracker,
    async initializeImpl() { await renderer.initialize(); },
    async renderFrameImpl(frame) { renderer.renderFrame(frame); },
    async destroyImpl() { renderer.destroy(); },
  });
}
