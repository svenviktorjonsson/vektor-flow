const assert = require("node:assert/strict");
const adapter = require("../../web/vf-ui/vf-axis3d-projection-kernel-adapter.js");

{
  let createCalls = 0;
  let depsSeen = null;
  const wrapped = adapter.createJsAxis3DProjectionKernelAdapter(
    {
      kernelName: "deps-ok"
    },
    {
      projectedAxisInfos() {
        return { axisInfos: [{ axisIndex: 2 }] };
      }
    }
  );
  assert.equal(typeof wrapped.projectedAxisInfos, "function");
  assert.deepEqual(wrapped.projectedAxisInfos(), { axisInfos: [{ axisIndex: 2 }] });
}

{
  const customKernel = adapter.createJsAxis3DProjectionKernelAdapter(
    {},
    {
      projectedAxisAngleDeg() { return 12; },
      projectedAxisDiffDeg() { return 4; },
      alignProjectedAxisToScreenSnap() { return true; },
      nearestAxisSnapAngleDeg() { return { angleDeg: 90, diffDeg: 1 }; },
      normalizeUndirectedAngleDeg() { return 7; }
    }
  );
  assert.equal(customKernel.projectedAxisAngleDeg(), 12);
  assert.equal(customKernel.projectedAxisDiffDeg(), 4);
  assert.equal(customKernel.alignProjectedAxisToScreenSnap(), true);
  assert.deepEqual(customKernel.nearestAxisSnapAngleDeg(), { angleDeg: 90, diffDeg: 1 });
  assert.equal(customKernel.normalizeUndirectedAngleDeg(), 7);
}

console.log("vf-axis3d-projection-kernel-adapter tests passed");
