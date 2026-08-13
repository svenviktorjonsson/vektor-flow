import * as legacyModule from './vf-vkf-ui-math.js';

const vkfUiMath = legacyModule.default ?? globalThis.VfVkfUiMath;

if (!vkfUiMath) {
  throw new Error('VKF UI math failed to initialize.');
}

export default vkfUiMath;

