import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clusterIndexForReceiver
} from '../../web/vf-ui/geom/vf-clustered-light-shading-oracle.mjs';

test('receiver depth uses logarithmic positive view depth rather than radial distance', () => {
  const grid = {
    xSlices: 1,
    ySlices: 1,
    depthSlices: 4,
    nearDepth: 1,
    farDepth: 16
  };

  const index = clusterIndexForReceiver({
    ndc: [0, 0],
    worldPosition: [3, 0, 4],
    cameraPosition: [0, 0, 0],
    cameraForward: [0, 0, 1],
    grid
  });

  // Positive view depth is 4 (slice 2); radial distance is 5 and must not
  // influence the result.
  assert.equal(index, 2);
});
