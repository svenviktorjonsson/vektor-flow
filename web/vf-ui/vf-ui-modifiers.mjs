import * as legacyModule from './vf-ui-modifiers.js';

const uiModifiers = legacyModule.default ?? globalThis.VfUiModifiers;

if (!uiModifiers) {
  throw new Error('VKF UI modifiers failed to initialize.');
}

export default uiModifiers;

