import test from 'node:test';
import assert from 'node:assert/strict';

import {
  encodeDemandIdentity,
  philox4x32_10,
} from '../../web/vf-ui/vf-demand-random.mjs';

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

test('demand identity uses a pinned length-framed hierarchy encoding', () => {
  const encoded = encodeDemandIdentity({
    generator: 'p',
    version: 2,
    seed: [3, 4],
    domain: 'd',
    hierarchy: ['ab', 'c'],
    lod: 5,
    channel: 'x',
    sample: [6, 7],
  });

  assert.equal(
    Buffer.from(encoded).toString('hex'),
    [
      '564b464401000000',
      '010100000070',
      '020400000002000000',
      '03080000000300000004000000',
      '040100000064',
      '050f000000020000000200000061620100000063',
      '060400000005000000',
      '070100000078',
      '08080000000600000007000000',
    ].join(''),
  );

  const differentBoundary = encodeDemandIdentity({
    generator: 'p',
    version: 2,
    seed: [3, 4],
    domain: 'd',
    hierarchy: ['a', 'bc'],
    lod: 5,
    channel: 'x',
    sample: [6, 7],
  });
  assert.notDeepEqual(encoded, differentBoundary);
});
