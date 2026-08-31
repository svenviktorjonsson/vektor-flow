import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createPhilox4x32WgslParityFixture,
  decodePhilox4x32WgslReadback,
  verifyPhilox4x32WgslParity,
} from '../../web/vf-ui/vf-demand-random-wgsl.mjs';
import {
  deriveDemandKey,
  philox4x32_10,
} from '../../web/vf-ui/vf-demand-random.mjs';

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

test('CPU and GPU records use pinned little-endian u32 bytes', () => {
  const fixture = createPhilox4x32WgslParityFixture([OFFICIAL_VECTORS[2]]);
  assert.equal(
    Buffer.from(fixture.inputBytes).toString('hex'),
    '886a3f24d308a3852e8a191344737003223809a4d0319f290000000000000000',
  );
  assert.equal(
    Buffer.from(fixture.expectedBytes).toString('hex'),
    '09fe6cd1ebccfd9420e40150a16e1224',
  );
  assert.deepEqual(
    [...decodePhilox4x32WgslReadback(fixture.expectedBytes)],
    OFFICIAL_VECTORS[2].expected,
  );
});

test('a hierarchical demand key maps unchanged into the GPU fixture', () => {
  const demandKey = deriveDemandKey({
    generator: 'vkf.procedural',
    version: 1,
    seed: [0x01234567, 0x89abcdef],
    domain: 'material',
    hierarchy: ['world:alpine', 'object:grass', 'patch:7'],
    lod: 12,
    channel: 'blade-height',
    sample: [0x76543210, 0xfedcba98],
  });
  const expected = philox4x32_10(demandKey.counter, demandKey.key);
  const fixture = createPhilox4x32WgslParityFixture([{ ...demandKey, expected }]);

  assert.deepEqual([...fixture.inputWords], [
    0x5c768268, 0x70d89da1, 0x76543210, 0xfedcba98,
    0xc236c986, 0x61db5b0b, 0, 0,
  ]);
  assert.deepEqual([...fixture.expectedWords], [
    0x533e66b5, 0x0c7c0189, 0x93314d71, 0xc15ff1c2,
  ]);
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
