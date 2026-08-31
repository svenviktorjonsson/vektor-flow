import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';

import {
  conditionChild,
  createConditionedRoot,
} from '../../web/vf-ui/vf-conditioned-distribution.mjs';
import {
  queryMarkedPointRegion2Reference,
  sampleMarkedPointCell2Reference,
} from '../../web/vf-ui/vf-marked-point-candidates.mjs';

const ROOT_IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: [0x01234567, 0x89abcdef],
  domain: 'material',
  hierarchy: ['environment:alpine', 'species:grass'],
  lod: 4,
  channel: 'traits',
});

function createPointNode() {
  return conditionChild(createConditionedRoot(ROOT_IDENTITY), {
    segment: 'forest:7',
    channel: 'trees',
  });
}

test('queried cell produces pinned bounded candidate identities and marks', () => {
  const candidates = sampleMarkedPointCell2Reference(createPointNode(), [2, -1], {
    cellSize: 10,
    maxCandidates: 2,
    baseProbability: 1,
    correlationLength: 20,
    spatialStrength: 0,
  });

  assert.deepEqual(candidates, [
    {
      id: 'candidate:v1:b0709f36:2f5feefc',
      cell: [2, -1],
      slot: 0,
      position: [24.33209284907207, -2.935679443180561],
      marks: { weight: 0.30771112302318215, angle: 4.4799549441969715 },
    },
    {
      id: 'candidate:v1:fb1ae87e:1581e99c',
      cell: [2, -1],
      slot: 1,
      position: [20.41999283246696, -9.32815571082756],
      marks: { weight: 0.3901456024032086, angle: 3.1238375664991485 },
    },
  ]);
  assert.ok(Object.isFrozen(candidates));
  assert.ok(candidates.every((candidate) => Object.isFrozen(candidate)));
  assert.ok(candidates.every((candidate) => Object.isFrozen(candidate.position)));
  assert.ok(candidates.every((candidate) => Object.isFrozen(candidate.marks)));
});

test('cell candidate generation rejects malformed or unbounded requests', () => {
  const node = createPointNode();
  const valid = {
    cellSize: 10,
    maxCandidates: 2,
    baseProbability: 0.5,
    correlationLength: 20,
    spatialStrength: 0.5,
  };
  const sample = (cell, overrides = {}) => sampleMarkedPointCell2Reference(
    node,
    cell,
    { ...valid, ...overrides },
  );

  assert.throws(() => sample([0]), TypeError);
  assert.throws(() => sample([0.5, 0]), TypeError);
  assert.throws(() => sample([0x80000000, 0]), RangeError);
  assert.throws(() => sample([0, 0], { cellSize: 0 }), RangeError);
  assert.throws(() => sample([0, 0], { maxCandidates: -1 }), RangeError);
  assert.throws(() => sample([0, 0], { maxCandidates: 1_025 }), RangeError);
  assert.throws(() => sample([0, 0], { baseProbability: 1.1 }), RangeError);
  assert.throws(() => sample([0, 0], { correlationLength: Infinity }), RangeError);
  assert.throws(() => sample([0, 0], { spatialStrength: -0.1 }), RangeError);
  assert.throws(() => sample([0, 0], { spatialStrength: 1.1 }), RangeError);
  assert.deepEqual(sample(new Int32Array([0, 0]), { maxCandidates: 0 }), []);
});

test('region query includes candidates from every crossed neighbor cell', () => {
  const candidates = queryMarkedPointRegion2Reference(
    createPointNode(),
    { min: [8, -3], max: [11.6, 2.5] },
    {
      cellSize: 10,
      maxCandidates: 8,
      baseProbability: 1,
      correlationLength: 20,
      spatialStrength: 0,
    },
  );

  assert.deepEqual(
    candidates.map(({ id, cell, slot }) => ({ id, cell, slot })),
    [
      { id: 'candidate:v1:5f176be7:5643cbb0', cell: [0, -1], slot: 2 },
      { id: 'candidate:v1:df812db2:ecc08f23', cell: [1, -1], slot: 4 },
      { id: 'candidate:v1:76f3e6d1:18391f06', cell: [0, 0], slot: 5 },
      { id: 'candidate:v1:1357d14d:34ffea71', cell: [1, 0], slot: 1 },
      { id: 'candidate:v1:dc612832:2e626ea1', cell: [1, 0], slot: 5 },
    ],
  );
  assert.ok(Object.isFrozen(candidates));
});

test('region query rejects malformed bounds and unbounded work', () => {
  const node = createPointNode();
  const options = {
    cellSize: 10,
    maxCandidates: 2,
    baseProbability: 0.5,
    correlationLength: 20,
    spatialStrength: 0.5,
  };
  const query = (bounds, overrides = {}) => queryMarkedPointRegion2Reference(
    node,
    bounds,
    { ...options, ...overrides },
  );

  assert.throws(() => query({ min: [0], max: [1, 1] }), TypeError);
  assert.throws(() => query({ min: [0, NaN], max: [1, 1] }), RangeError);
  assert.throws(() => query({ min: [1, 0], max: [1, 1] }), RangeError);
  assert.throws(() => query({ min: [0, 0], max: [40_970, 10] }), RangeError);
  assert.throws(
    () => query({ min: [0, 0], max: [650, 10] }, { maxCandidates: 1_024 }),
    RangeError,
  );
  assert.throws(
    () => query({ min: [21_474_836_480, 0], max: [21_474_836_490, 10] }),
    RangeError,
  );
});

test('adjacent half-open regions neither lose nor duplicate boundary candidates', () => {
  const node = createPointNode();
  const options = {
    cellSize: 10,
    maxCandidates: 8,
    baseProbability: 1,
    correlationLength: 20,
    spatialStrength: 0,
  };
  const query = (min, max) => queryMarkedPointRegion2Reference(
    node,
    { min, max },
    options,
  );
  const left = query([0, 0], [10, 10]);
  const right = query([10, 0], [20, 10]);
  const whole = query([0, 0], [20, 10]);
  const adjacentIds = [...left, ...right].map(({ id }) => id);

  assert.equal(new Set(adjacentIds).size, adjacentIds.length);
  assert.deepEqual(adjacentIds, whole.map(({ id }) => id));
});

test('candidate identities and marks are traversal, chunk, and branch independent', () => {
  const target = createPointNode();
  const recreated = createPointNode();
  const unrelated = conditionChild(createConditionedRoot(ROOT_IDENTITY), {
    segment: 'forest:999',
    channel: 'trees',
  });
  const options = {
    cellSize: 5,
    maxCandidates: 4,
    baseProbability: 0.55,
    correlationLength: 25,
    spatialStrength: 0.7,
  };
  const cells = Array.from({ length: 32 }, (_, index) => [
    index - 16,
    (index * 7 % 19) - 9,
  ]);
  const key = (cell) => cell.join(':');
  const sample = (node, cell) => sampleMarkedPointCell2Reference(node, cell, options);
  const expected = new Map(cells.map((cell) => [key(cell), sample(target, cell)]));

  [...cells].reverse().forEach((cell) => sample(unrelated, cell));
  const reversed = new Map(
    [...cells].reverse().map((cell) => [key(cell), sample(target, cell)]),
  );
  assert.deepEqual(
    cells.map((cell) => reversed.get(key(cell))),
    cells.map((cell) => expected.get(key(cell))),
  );

  const chunks = [cells.slice(0, 3), cells.slice(3, 21), cells.slice(21)];
  const chunked = new Map(
    chunks.flatMap((chunk) => chunk.map((cell) => [key(cell), sample(recreated, cell)])),
  );
  assert.deepEqual(
    cells.map((cell) => chunked.get(key(cell))),
    cells.map((cell) => expected.get(key(cell))),
  );

  const ids = cells.flatMap((cell) => expected.get(key(cell)).map(({ id }) => id));
  assert.equal(new Set(ids).size, ids.length);
});

test('worker partitions reproduce candidate identities, positions, and marks', async () => {
  const cells = Array.from({ length: 32 }, (_, index) => [
    index - 16,
    (index * 7 % 19) - 9,
  ]);
  const options = {
    cellSize: 5,
    maxCandidates: 4,
    baseProbability: 0.55,
    correlationLength: 25,
    spatialStrength: 0.7,
  };
  const expected = cells.map((cell) => ({
    cell,
    candidates: sampleMarkedPointCell2Reference(createPointNode(), cell, options),
  }));
  const partitions = Array.from({ length: 3 }, () => []);
  cells.forEach((cell, index) => partitions[index % partitions.length].push(cell));
  const runWorker = (workerCells) => new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('../fixtures/vf-marked-point-worker.mjs', import.meta.url),
      {
        workerData: {
          identity: ROOT_IDENTITY,
          child: { segment: 'forest:7', channel: 'trees' },
          cells: workerCells,
          options,
        },
      },
    );
    worker.once('message', resolve);
    worker.once('error', reject);
  });

  const records = (await Promise.all(partitions.map(runWorker))).flat();
  records.sort((first, second) => cells.findIndex(
    (cell) => cell[0] === first.cell[0] && cell[1] === first.cell[1],
  ) - cells.findIndex(
    (cell) => cell[0] === second.cell[0] && cell[1] === second.cell[1],
  ));
  assert.deepEqual(records, expected);
});

test('marked-point population matches pinned spatial and mark statistics', () => {
  const node = createPointNode();
  const options = {
    cellSize: 5,
    maxCandidates: 16,
    baseProbability: 0.5,
    correlationLength: 40,
    spatialStrength: 0.9,
  };
  const cellCount = 48 * 48;
  let total = 0;
  let weightSum = 0;
  let cosineSum = 0;
  let sineSum = 0;
  const nearby = { a: 0, b: 0, aa: 0, bb: 0, ab: 0 };
  const distant = { a: 0, b: 0, aa: 0, bb: 0, ab: 0 };
  const countAt = (x, y) => sampleMarkedPointCell2Reference(node, [x, y], options).length;
  const accumulatePair = (moments, a, b) => {
    moments.a += a;
    moments.b += b;
    moments.aa += a * a;
    moments.bb += b * b;
    moments.ab += a * b;
  };

  for (let y = -24; y < 24; y += 1) {
    for (let x = -24; x < 24; x += 1) {
      const points = sampleMarkedPointCell2Reference(node, [x, y], options);
      const count = points.length;
      total += count;
      for (const point of points) {
        weightSum += point.marks.weight;
        cosineSum += Math.cos(point.marks.angle);
        sineSum += Math.sin(point.marks.angle);
      }
      accumulatePair(nearby, count, countAt(x + 1, y));
      accumulatePair(distant, count, countAt(x + 47, y + 31));
    }
  }

  const correlation = ({ a, b, aa, bb, ab }) => {
    const meanA = a / cellCount;
    const meanB = b / cellCount;
    const varianceA = aa / cellCount - meanA * meanA;
    const varianceB = bb / cellCount - meanB * meanB;
    const covariance = ab / cellCount - meanA * meanB;
    return covariance / Math.sqrt(varianceA * varianceB);
  };
  const nearbyCorrelation = correlation(nearby);
  const distantCorrelation = correlation(distant);

  assert.equal(total, 18_365);
  assert.ok(Math.abs(weightSum / total - 0.4989402512780761) < 1e-12);
  assert.ok(Math.abs(cosineSum / total - 0.007599462732954929) < 1e-12);
  assert.ok(Math.abs(sineSum / total - (-0.00263045433517926)) < 1e-12);
  assert.ok(Math.abs(nearbyCorrelation - 0.7716081897797222) < 1e-12);
  assert.ok(Math.abs(distantCorrelation - (-0.03629859300415917)) < 1e-12);
  assert.ok(nearbyCorrelation > 0.7);
  assert.ok(Math.abs(distantCorrelation) < 0.08);
});
