import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createPhilox4x32WgslParityFixture,
  verifyPhilox4x32WgslParity,
} from '../../web/vf-ui/vf-demand-random-wgsl.mjs';

const OFFICIAL_VECTORS = Object.freeze([
  {
    counter: [0, 0, 0, 0],
    key: [0, 0],
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
]);

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

test('WGSL readback verifier pinpoints parity across every official vector', () => {
  const fixture = createPhilox4x32WgslParityFixture(OFFICIAL_VECTORS);
  assert.deepEqual(verifyPhilox4x32WgslParity(fixture, fixture.expectedWords), {
    matched: true,
    records: 3,
  });

  const corrupted = fixture.expectedWords.slice();
  corrupted[9] ^= 1;
  assert.deepEqual(verifyPhilox4x32WgslParity(fixture, corrupted), {
    matched: false,
    record: 2,
    lane: 1,
    expected: 0x94fdcceb,
    actual: 0x94fdccea,
  });
});

test('browser fixture executes the shader and verifies mapped GPU readback', async () => {
  const html = await readFile(
    new URL('../fixtures/demand-random-wgsl-smoke.html', import.meta.url),
    'utf8',
  );
  assert.match(html, /createComputePipelineAsync/);
  assert.match(html, /dispatchWorkgroups/);
  assert.match(html, /mapAsync\(GPUMapMode\.READ\)/);
  assert.match(html, /verifyPhilox4x32WgslParity/);
});
