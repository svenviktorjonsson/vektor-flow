import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createPhilox4x32WgslParityFixture,
} from '../../web/vf-ui/vf-demand-random-wgsl.mjs';

test('WGSL parity fixture preserves the official zero-vector word layout', () => {
  const fixture = createPhilox4x32WgslParityFixture([{
    counter: [0, 0, 0, 0],
    key: [0, 0],
    expected: [0x6627e8d5, 0xe169c58d, 0xbc57ac4c, 0x9b00dbd8],
  }]);

  assert.deepEqual(
    [...fixture.inputWords],
    [0, 0, 0, 0, 0, 0, 0, 0],
  );
  assert.deepEqual(
    [...fixture.expectedWords],
    [0x6627e8d5, 0xe169c58d, 0xbc57ac4c, 0x9b00dbd8],
  );
  assert.equal(fixture.inputStrideWords, 8);
  assert.match(fixture.source, /@compute\s+@workgroup_size\(64\)/);
  assert.match(fixture.source, /fn vf_philox4x32_10\(/);
});
