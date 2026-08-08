import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cameraFacingPolygonFrame,
  closedFacesFromCornerWalk,
  closeLinkedSpatialGeometry,
  guidedPlaneExtrusionPositions,
  projectedNormalDragDistance,
  volumeCutPlanePolygons
} from '../../web/vf-ui/vf-spatial-geometry.mjs';

test('extrudes a guided plane without changing topology', () => {
  const points = [[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
  const frame = cameraFacingPolygonFrame(points, { cameraPosition: [0,0,10] });
  const moved = guidedPlaneExtrusionPositions(points, {
    normal: frame.normal, distance: 0.5,
    guides: [[[-2,-2,0]],[[2,-2,0]],[[2,2,0]],[[-2,2,0]]]
  });
  assert.deepEqual(moved, [[-0.5,-0.5,1.5],[0.5,-0.5,1.5],[0.5,0.5,1.5],[-0.5,0.5,1.5]]);
});

test('projected front and backside normal produce signed distances', () => {
  assert.equal(projectedNormalDragDistance({ startScreen:[0,0], currentScreen:[20,0], normalScreenVector:[10,0], orthoScale:5, viewportHeight:500 }), 2);
  assert.equal(projectedNormalDragDistance({ startScreen:[0,0], currentScreen:[-20,0], normalScreenVector:[10,0], orthoScale:5, viewportHeight:500 }), -2);
});

test('closes linked face walks into a volume', () => {
  const closed = closeLinkedSpatialGeometry({
    points:[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],
    segments:[[0,1],[1,2],[2,0],[0,3],[1,3],[2,3]],
    faces:[[0,1,2],[0,3,1],[0,2,3],[1,3,2]]
  });
  assert.equal(closed.volumes.length, 1);
});

test('extracts every explicitly closed face from one continuous corner walk', () => {
  assert.deepEqual(
    closedFacesFromCornerWalk([0,1,2,0,3,1,0]),
    [[0,1,2], [0,3,1]]
  );
});

test('cuts a closed triangle shell on a near plane', () => {
  const triangles = [
    [[-1,-1,-1],[1,-1,-1],[1,1,-1]], [[-1,-1,-1],[1,1,-1],[-1,1,-1]],
    [[-1,-1,1],[1,1,1],[1,-1,1]], [[-1,-1,1],[-1,1,1],[1,1,1]],
    [[-1,-1,-1],[-1,-1,1],[1,-1,1]], [[-1,-1,-1],[1,-1,1],[1,-1,-1]],
    [[1,-1,-1],[1,-1,1],[1,1,1]], [[1,-1,-1],[1,1,1],[1,1,-1]],
    [[1,1,-1],[1,1,1],[-1,1,1]], [[1,1,-1],[-1,1,1],[-1,1,-1]],
    [[-1,1,-1],[-1,1,1],[-1,-1,1]], [[-1,1,-1],[-1,-1,1],[-1,-1,-1]]
  ];
  assert.equal(volumeCutPlanePolygons(triangles, { planePoint:[0,0,0], planeNormal:[0,0,1], orthoScale:2 }).length, 1);
});
