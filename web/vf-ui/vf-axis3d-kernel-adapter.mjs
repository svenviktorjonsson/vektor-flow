import * as kernelModule from './vf-axis3d-kernel.js';
import * as adapterModule from './vf-axis3d-kernel-adapter.js';

const kernel = kernelModule.default ?? globalThis.VfAxis3DKernel;
const axis3dAdapter = adapterModule.default ?? globalThis.VfAxis3DKernelAdapter;

if (!kernel || !axis3dAdapter) {
  throw new Error('VKF axis3d adapter failed to initialize.');
}

export default axis3dAdapter;

