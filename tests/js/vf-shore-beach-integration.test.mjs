import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  createShoreBeachReference,
  createShoreBeachRenderPacketsReference,
} from '../../web/vf-ui/vf-shore-beach-reference.mjs';

const hash = view => createHash('sha256')
  .update(Buffer.from(view.buffer, view.byteOffset, view.byteLength)).digest('hex');

test('shore classes and sediment consume one terrain/water truth', () => {
  const shore = createShoreBeachReference({ seed: 0x5eac, resolution: 65 });
  assert.ok(shore.samples.some(sample => sample.classification === 'submerged'));
  assert.ok(shore.samples.some(sample => sample.classification === 'wet'));
  assert.ok(shore.samples.some(sample => sample.classification === 'dry'));
  for (const sample of shore.samples) {
    assert.equal(sample.signedHeight, sample.height - shore.waterLevel);
    assert.equal(sample.sedimentDepth > 0, sample.classification !== 'submerged');
    if (sample.classification === 'wet') assert.ok(sample.signedHeight <= shore.wetWidth);
  }
  assert.ok(shore.waterlineSegments.length > 8);
  assert.ok(shore.waterlineSegments.every(segment => segment.every(point => point[2] === shore.waterLevel)));
});

test('replay is byte exact; seed and water level change boundary deterministically', () => {
  const first = createShoreBeachReference({ seed: 0x5eac, resolution: 65 });
  const replay = createShoreBeachReference({ seed: 0x5eac, resolution: 65 });
  const varied = createShoreBeachReference({ seed: 0x5ead, resolution: 65 });
  const flooded = createShoreBeachReference({ seed: 0x5eac, resolution: 65, waterLevel: 0.12 });
  assert.equal(hash(first.heights), hash(replay.heights));
  assert.equal(first.revision, replay.revision);
  assert.notEqual(hash(first.heights), hash(varied.heights));
  assert.notEqual(first.revision, flooded.revision);
  assert.ok(flooded.samples.filter(sample => sample.classification === 'submerged').length
    > first.samples.filter(sample => sample.classification === 'submerged').length);
});

test('rocks and sand are supported by the same terrain with no floating or underwater sediment', () => {
  const shore = createShoreBeachReference({ seed: 0x5eac, resolution: 65 });
  assert.equal(shore.rocks.length, 10);
  assert.deepEqual([...new Set(shore.rocks.map(rock => rock.speciesIndex))], [0, 1, 2, 3, 4]);
  assert.ok(shore.rocks.every(rock => Math.abs(rock.supportHeight - shore.heightAt(rock.x, rock.y)) < 1e-12));
  assert.ok(shore.rocks.every(rock => rock.supportHeight > shore.waterLevel));
  assert.ok(shore.samples.every(sample => sample.classification !== 'submerged' || sample.sedimentDepth === 0));
  assert.ok(shore.metrics.minimumRockClearance >= -1e-9);
  assert.ok(shore.metrics.maximumRockSupportGap <= 1e-9);
});

test('render packets retain physics source revision and remain finite and bounded', () => {
  const shore = createShoreBeachReference({ seed: 0x5eac, resolution: 65 });
  const packets = createShoreBeachRenderPacketsReference(shore);
  assert.equal(packets.terrain.sourceRevision, shore.revision);
  assert.equal(packets.sediment.sourceRevision, shore.revision);
  assert.equal(packets.water.sourceRevision, shore.revision);
  assert.ok(packets.rocks.every(packet => packet.sourceRevision === shore.revision));
  for (const packet of [packets.terrain, packets.sediment, packets.water, ...packets.rocks]) {
    assert.ok(packet.vertices.every(Number.isFinite));
    assert.ok(packet.indices.every(index => index < packet.vertices.length / 10));
  }
  assert.ok(shore.metrics.vectorBytes < 8 * 1024 * 1024);
});
