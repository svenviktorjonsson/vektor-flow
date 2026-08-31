import test from 'node:test';
import assert from 'node:assert/strict';

import { philox4x32_10 } from '../../web/vf-ui/vf-demand-random.mjs';

test('Philox4x32-10 matches the Random123 known-answer vectors', () => {
  const vectors = [
    {
      counter: [0x00000000, 0x00000000, 0x00000000, 0x00000000],
      key: [0x00000000, 0x00000000],
      expected: [0x6627e8d5, 0xe169c58d, 0xbc57ac4c, 0x9b00dbd8],
    },
    {
      counter: [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff],
      key: [0xffffffff, 0xffffffff],
      expected: [0x408f276d, 0x41c83b0e, 0xa20bc7c6, 0x6d5451fd],
    },
    {
      counter: [0x243f6a88, 0x85a308d3, 0x13198a2e, 0x03707344],
      key: [0xa4093822, 0x299f31d0],
      expected: [0xd16cfe09, 0x94fdcceb, 0x5001e420, 0x24126ea1],
    },
  ];

  for (const vector of vectors) {
    assert.deepEqual(philox4x32_10(vector.counter, vector.key), vector.expected);
  }
});
