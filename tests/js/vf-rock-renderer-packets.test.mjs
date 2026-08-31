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
