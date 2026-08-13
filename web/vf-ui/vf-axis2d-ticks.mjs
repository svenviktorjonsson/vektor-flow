import * as legacyModule from './vf-axis2d-ticks.js';

const axis2dTicks = legacyModule.default ?? globalThis.VfAxis2DTicks;

if (!axis2dTicks) {
  throw new Error('VKF axis2d ticks failed to initialize.');
}

export default axis2dTicks;

