import test from 'node:test';
import assert from 'node:assert/strict';

import {
  demandU32,
  deriveDemandKey,
  deriveDemandStream,
  encodeDemandIdentity,
  philox4x32_10,
  sampleDemandStreamU32,
  sha256Bytes,
} from '../../web/vf-ui/vf-demand-random.mjs';

const DEMAND_VECTOR = Object.freeze({
  generator: 'vkf.procedural',
  version: 1,
  seed: [0x01234567, 0x89abcdef],
  domain: 'material',
  hierarchy: ['world:alpine', 'object:grass', 'patch:7'],
  lod: 12,
  channel: 'blade-height',
  sample: [0x76543210, 0xfedcba98],
});

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

test('u32 identity and counter words reject truncating inputs', () => {
  assert.throws(
    () => philox4x32_10([0, 0, 0, -1], [0, 0]),
    /counter\[3\].*u32/,
  );
  assert.throws(
    () => deriveDemandStream({ ...DEMAND_VECTOR, version: 1.5 }),
    /version.*u32/,
  );
  assert.throws(
    () => sampleDemandStreamU32(deriveDemandStream(DEMAND_VECTOR), [0x100000000, 0]),
    /sample\[0\].*u32/,
  );
});

test('demand streams require explicit typed identity fields', () => {
  const withoutChannel = { ...DEMAND_VECTOR };
  delete withoutChannel.channel;
  assert.throws(() => deriveDemandStream(withoutChannel), /channel.*string/);
  assert.throws(
    () => deriveDemandStream({ ...DEMAND_VECTOR, hierarchy: ['world', 7] }),
    /hierarchy\[1\].*string/,
  );
});

test('identity digest matches the FIPS 180-4 SHA-256 vectors', () => {
  const vectors = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ];

  for (const [input, expected] of vectors) {
    const digest = sha256Bytes(new TextEncoder().encode(input));
    assert.equal(Buffer.from(digest).toString('hex'), expected);
  }
});

test('demand key and u32 output have a pinned cross-runtime reference vector', () => {
  assert.deepEqual(deriveDemandKey(DEMAND_VECTOR), {
    key: [0xc236c986, 0x61db5b0b],
    counter: [0x5c768268, 0x70d89da1, 0x76543210, 0xfedcba98],
  });
  assert.equal(demandU32(DEMAND_VECTOR), 0x533e66b5);
});

test('sampling is traversal, chunk, and worker-order independent', () => {
  const streamIdentity = { ...DEMAND_VECTOR };
  delete streamIdentity.sample;
  const stream = deriveDemandStream(streamIdentity);
  const samples = Array.from({ length: 24 }, (_, index) => [index, 0]);
  const expected = samples.map((sample) => sampleDemandStreamU32(stream, sample));

  const reverseTraversal = new Map(
    [...samples].reverse().map((sample) => [sample[0], sampleDemandStreamU32(stream, sample)]),
  );
  assert.deepEqual(samples.map((sample) => reverseTraversal.get(sample[0])), expected);

  const chunks = [samples.slice(0, 5), samples.slice(5, 17), samples.slice(17)];
  assert.deepEqual(
    chunks.flatMap((chunk) => chunk.map((sample) => sampleDemandStreamU32(stream, sample))),
    expected,
  );

  const workerA = deriveDemandStream(structuredClone(streamIdentity));
  const workerB = deriveDemandStream(structuredClone(streamIdentity));
  const interleaved = new Array(samples.length);
  for (let index = 0; index < samples.length; index += 2) {
    interleaved[index] = sampleDemandStreamU32(workerA, samples[index]);
  }
  for (let index = 1; index < samples.length; index += 2) {
    interleaved[index] = sampleDemandStreamU32(workerB, samples[index]);
  }
  assert.deepEqual(interleaved, expected);
});

test('hierarchy levels share explicit ancestry without sharing random state', () => {
  const parent = { ...DEMAND_VECTOR, hierarchy: ['world:alpine', 'object:grass'] };
  const child = { ...parent, hierarchy: [...parent.hierarchy, 'patch:7'] };
  const sibling = { ...parent, hierarchy: [...parent.hierarchy, 'patch:8'] };

  const childFirst = demandU32(child);
  const parentAfterChild = demandU32(parent);
  const parentFirst = demandU32(parent);
  const childAfterParent = demandU32(child);

  assert.equal(childFirst, childAfterParent);
  assert.equal(parentFirst, parentAfterChild);
  assert.notEqual(parentFirst, childFirst);
  assert.notEqual(childFirst, demandU32(sibling));
});

test('every demand identity dimension selects a different deterministic sample', () => {
  const variants = [
    { ...DEMAND_VECTOR, generator: 'vkf.geometry' },
    { ...DEMAND_VECTOR, version: 2 },
    { ...DEMAND_VECTOR, seed: [DEMAND_VECTOR.seed[0] + 1, DEMAND_VECTOR.seed[1]] },
    { ...DEMAND_VECTOR, domain: 'geometry' },
    { ...DEMAND_VECTOR, hierarchy: [...DEMAND_VECTOR.hierarchy, 'blade:3'] },
    { ...DEMAND_VECTOR, lod: DEMAND_VECTOR.lod + 1 },
    { ...DEMAND_VECTOR, channel: 'blade-width' },
    { ...DEMAND_VECTOR, sample: [DEMAND_VECTOR.sample[0] + 1, DEMAND_VECTOR.sample[1]] },
  ];
  const outputs = [demandU32(DEMAND_VECTOR), ...variants.map(demandU32)];
  assert.equal(new Set(outputs).size, outputs.length);
});

test('unrealized detail and huge sample identities do not expand stream storage', () => {
  const small = deriveDemandStream({ ...DEMAND_VECTOR, lod: 0 });
  const huge = deriveDemandStream({ ...DEMAND_VECTOR, lod: 0xffffffff });
  assert.equal(small.key.length + small.counterPrefix.length, 4);
  assert.equal(huge.key.length + huge.counterPrefix.length, 4);
  assert.equal(
    typeof sampleDemandStreamU32(huge, [0xffffffff, 0xffffffff]),
    'number',
  );
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
