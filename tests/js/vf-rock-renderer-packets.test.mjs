import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCoarseEllipsoidReference,
} from '../../web/vf-ui/vf-demand-refined-geometry.mjs';
import {
  updateEllipsoidRefinementWorkingSetReference,
} from '../../web/vf-ui/vf-refinement-working-set.mjs';
import {
  adaptEllipsoidWorkingSetToRetainedGeometryPacketsReference,
} from '../../web/vf-ui/vf-rock-renderer-packets.mjs';

const demand = (face, error) => Object.freeze({
  face,
  silhouette: true,
  silhouetteEdges: Object.freeze([]),
  silhouetteErrorPixels: error,
  projectedErrorPixels: error,
  errorBoundPixels: error,
});

test('adapter emits renderer field-mesh packets with stable geometry identities', () => {
  const coarse = createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });
  const working = updateEllipsoidRefinementWorkingSetReference(coarse, null, {
    demands: [demand('face:+x:+y:+z', 40)],
    vertexBudget: 1,
    faceBudget: 3,
  });
  const adapted = adaptEllipsoidWorkingSetToRetainedGeometryPacketsReference(
    working,
    null,
  );
  const [coarsePacket, detailPacket] = adapted.packets;

  assert.equal(coarsePacket.type, 'field_mesh');
  assert.equal(coarsePacket.id, 'rock:ellipsoid-octahedron:v1:coarse');
  assert.equal(coarsePacket.object_id, 1);
  assert.deepEqual(coarsePacket.vertex_ids, coarse.vertices.map(({ id }) => id));
  assert.deepEqual(coarsePacket.face_ids, coarse.faces.map(({ id }) => id));
  assert.ok(coarsePacket.vertices instanceof Float32Array);
  assert.ok(coarsePacket.indices instanceof Uint32Array);
  assert.equal(coarsePacket.vertices.length, 60);
  assert.equal(coarsePacket.indices.length, 24);

  assert.equal(detailPacket.type, 'field_mesh');
  assert.equal(detailPacket.id, 'rock:detail:face:+x:+y:+z');
  assert.equal(detailPacket.object_id, 2);
  assert.deepEqual(detailPacket.vertex_ids, [
    'vertex:+x',
    'vertex:+y',
    'vertex:+z',
    'vertex:face:+x:+y:+z/refine:1/center',
  ]);
  assert.deepEqual(detailPacket.face_ids, [
    'face:+x:+y:+z/refine:1/child:0',
    'face:+x:+y:+z/refine:1/child:1',
    'face:+x:+y:+z/refine:1/child:2',
  ]);
  assert.equal(detailPacket.vertices.length, 40);
  assert.equal(detailPacket.indices.length, 9);
  assert.deepEqual(adapted.delta.upsert.map(({ id }) => id), [
    coarsePacket.id,
    detailPacket.id,
  ]);
  assert.deepEqual(adapted.delta.remove, []);
  assert.deepEqual(adapted.delta.upload, {
    packets: 2,
    vertices: 10,
    faces: 11,
    vertexFloats: 100,
    indices: 33,
  });
  assert.ok(Object.isFrozen(adapted));
  assert.ok(Object.isFrozen(adapted.packets));
});

test('camera demand uploads only changed detail and never the coarse packet again', () => {
  const coarse = createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });
  const firstDemands = [
    demand('face:+x:+y:+z', 40),
    demand('face:+x:+y:-z', 20),
  ];
  const update = (previous, demands) => updateEllipsoidRefinementWorkingSetReference(
    coarse,
    previous,
    { demands, vertexBudget: 2, faceBudget: 6 },
  );
  const firstWorking = update(null, firstDemands);
  const first = adaptEllipsoidWorkingSetToRetainedGeometryPacketsReference(
    firstWorking,
    null,
  );
  const steadyWorking = update(firstWorking, [...firstDemands].reverse());
  const steady = adaptEllipsoidWorkingSetToRetainedGeometryPacketsReference(
    steadyWorking,
    first,
  );
  const changedWorking = update(steadyWorking, [
    demand('face:-x:+y:+z', 60),
    firstDemands[1],
  ]);
  const changed = adaptEllipsoidWorkingSetToRetainedGeometryPacketsReference(
    changedWorking,
    steady,
  );

  assert.strictEqual(steady.coarse, first.coarse);
  assert.strictEqual(steady.packets[1], first.packets[1]);
  assert.strictEqual(steady.packets[2], first.packets[2]);
  assert.deepEqual(steady.delta.upsert, []);
  assert.deepEqual(steady.delta.remove, []);
  assert.deepEqual(steady.delta.unchanged, steady.packets.map(({ id }) => id));
  assert.deepEqual(steady.delta.upload, {
    packets: 0,
    vertices: 0,
    faces: 0,
    vertexFloats: 0,
    indices: 0,
  });

  assert.strictEqual(changed.coarse, first.coarse);
  assert.deepEqual(changed.delta.upsert.map(({ id }) => id), [
    'rock:detail:face:-x:+y:+z',
  ]);
  assert.deepEqual(changed.delta.remove, [
    'rock:detail:face:+x:+y:+z',
  ]);
  assert.deepEqual(changed.delta.unchanged, [
    'rock:ellipsoid-octahedron:v1:coarse',
    'rock:detail:face:+x:+y:-z',
  ]);
  assert.deepEqual(changed.delta.upload, {
    packets: 1,
    vertices: 4,
    faces: 3,
    vertexFloats: 40,
    indices: 9,
  });
  const retainedPacket = changed.packets.find(
    ({ id }) => id === 'rock:detail:face:+x:+y:-z',
  );
  assert.strictEqual(retainedPacket, first.packets[2]);
});

test('evicted renderer packets regenerate exactly with stable object identities', () => {
  const coarse = createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });
  const firstDemands = [
    demand('face:+x:+y:+z', 40),
    demand('face:+x:+y:-z', 20),
  ];
  const changedDemands = [
    demand('face:-x:-y:+z', 70),
    demand('face:-x:+y:+z', 50),
  ];
  const update = (previous, demands) => updateEllipsoidRefinementWorkingSetReference(
    coarse,
    previous,
    { demands, vertexBudget: 2, faceBudget: 6 },
  );
  const firstWorking = update(null, firstDemands);
  const first = adaptEllipsoidWorkingSetToRetainedGeometryPacketsReference(
    firstWorking,
    null,
  );
  const changedWorking = update(firstWorking, changedDemands);
  const changed = adaptEllipsoidWorkingSetToRetainedGeometryPacketsReference(
    changedWorking,
    first,
  );
  const returnedWorking = update(changedWorking, [...firstDemands].reverse());
  const returned = adaptEllipsoidWorkingSetToRetainedGeometryPacketsReference(
    returnedWorking,
    changed,
  );

  assert.strictEqual(returned.coarse, first.coarse);
  assert.deepEqual(returned.packets, first.packets);
  assert.notStrictEqual(returned.packets[1], first.packets[1]);
  assert.notStrictEqual(returned.packets[2], first.packets[2]);
  assert.deepEqual(returned.packets.map(({ id, object_id }) => ({ id, object_id })), [
    { id: 'rock:ellipsoid-octahedron:v1:coarse', object_id: 1 },
    { id: 'rock:detail:face:+x:+y:+z', object_id: 2 },
    { id: 'rock:detail:face:+x:+y:-z', object_id: 6 },
  ]);
  assert.deepEqual(returned.delta.upsert.map(({ id }) => id), [
    'rock:detail:face:+x:+y:+z',
    'rock:detail:face:+x:+y:-z',
  ]);
  assert.deepEqual(returned.delta.remove, [
    'rock:detail:face:-x:-y:+z',
    'rock:detail:face:-x:+y:+z',
  ]);
  assert.deepEqual(returned.delta.upload, {
    packets: 2,
    vertices: 8,
    faces: 6,
    vertexFloats: 80,
    indices: 18,
  });
  assert.ok(returned.packets.every(({ id }) => !id.includes('face:-x')));
});
