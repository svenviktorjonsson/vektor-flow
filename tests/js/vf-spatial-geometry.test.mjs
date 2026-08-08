import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cameraFacingPolygonFrame,
  clipSpatialGeometryToConvexVolume,
  closedFacesFromCornerWalk,
  closeLinkedSpatialGeometry,
  constrainSpatialPointDrag,
  guidedPlaneExtrusionPositions,
  lexicographicMinimumPoint,
  nearestSpatialPointToLine,
  projectSpatialPointsToDominantPlane,
  projectedNormalDragDistance,
  spatialFrameFromDirections,
  volumeCutPlanePolygons
} from '../../web/vf-ui/vf-spatial-geometry.mjs';

test('selects the nearest world point to a line and resolves visual depth ties front-first', () => {
  assert.deepEqual(nearestSpatialPointToLine([
    [1,0,0], [0.5,0,100], [0.5,0,-3]
  ], {
    linePoint: [0,0,0],
    lineDirection: [0,0,1],
    cameraForward: [0,0,1]
  }), {
    index: 2,
    point: [0.5,0,-3],
    distance: 0.5,
    lineParameter: -3
  });
});

test('constrains a spatial point drag by independent non-triangular face planes', () => {
  const xy = [[-1,-1,0],[1,-1,0],[1,1,0],[-1,1,0]];
  const xz = [[-1,0,-1],[1,0,-1],[1,0,1],[-1,0,1]];
  const yz = [[0,-1,-1],[0,1,-1],[0,1,1],[0,-1,1]];
  const viewLine = { linePoint: [2,3,5], lineDirection: [0,0,-1] };

  assert.deepEqual(constrainSpatialPointDrag({
    originalPoint: [0,0,0], incidentPolygons: [xy], ...viewLine
  }), { point: [2,3,0], freedom: 2, planeCount: 1 });

  assert.deepEqual(constrainSpatialPointDrag({
    originalPoint: [0,0,0], incidentPolygons: [xy,xz], ...viewLine
  }), { point: [2,0,0], freedom: 1, planeCount: 2 });

  assert.deepEqual(constrainSpatialPointDrag({
    originalPoint: [0,0,0], incidentPolygons: [xy,xz,yz], ...viewLine
  }), { point: [0,0,0], freedom: 0, planeCount: 3 });
});

test('triangles do not constrain a spatial point drag', () => {
  assert.deepEqual(constrainSpatialPointDrag({
    originalPoint: [0,0,0],
    incidentPolygons: [[[0,0,0],[1,0,0],[0,1,0]]],
    linePoint: [2,3,5],
    lineDirection: [0,0,-1]
  }), { point: null, freedom: 3, planeCount: 0 });
});

test('projects an edge-on spatial plane onto its strongest coordinate pair', () => {
  assert.deepEqual(projectSpatialPointsToDominantPlane([
    [0,0,0], [2,0,0], [2,0,2], [0,0,2]
  ]), {
    axes: [0,2],
    points: [[0,0], [2,0], [2,2], [0,2]]
  });
});

test('derives stable spatial axes from selected incident directions', () => {
  assert.deepEqual(spatialFrameFromDirections({
    origin: [2,3,4], directions: [[2,0,0]]
  }), {
    origin: [2,3,4], xAxis: [1,0,0], yAxis: [0,1,0], zAxis: [0,0,1], dimension: 1
  });
  assert.deepEqual(spatialFrameFromDirections({
    origin: [0,0,0], directions: [[1,0,0],[1,1,0]]
  }), {
    origin: [0,0,0], xAxis: [1,0,0], yAxis: [1/Math.sqrt(2),1/Math.sqrt(2),0], zAxis: [0,0,1], dimension: 2
  });
  assert.deepEqual(spatialFrameFromDirections({
    origin: [0,0,0], directions: [[1,0,0],[0,1,0],[0,0,-2]]
  }), {
    origin: [0,0,0], xAxis: [1,0,0], yAxis: [0,1,0], zAxis: [0,0,-1], dimension: 3
  });
});

test('anchors internal volume coordinates at the lowest x then y then z', () => {
  assert.deepEqual(lexicographicMinimumPoint([
    [1,-4,0], [-2,5,9], [-2,5,3], [-2,4,8]
  ]), [-2,4,8]);
});

test('clips spatial graphs against convex volume walls', () => {
  const shell = [
    [[-1,-1,-1],[1,-1,-1],[1,1,-1]], [[-1,-1,-1],[1,1,-1],[-1,1,-1]],
    [[-1,-1,1],[1,1,1],[1,-1,1]], [[-1,-1,1],[-1,1,1],[1,1,1]],
    [[-1,-1,-1],[-1,-1,1],[1,-1,1]], [[-1,-1,-1],[1,-1,1],[1,-1,-1]],
    [[1,-1,-1],[1,-1,1],[1,1,1]], [[1,-1,-1],[1,1,1],[1,1,-1]],
    [[1,1,-1],[1,1,1],[-1,1,1]], [[1,1,-1],[-1,1,1],[-1,1,-1]],
    [[-1,1,-1],[-1,1,1],[-1,-1,1]], [[-1,1,-1],[-1,-1,1],[-1,-1,-1]]
  ];
  const clipped = clipSpatialGeometryToConvexVolume({
    classification: 'curve',
    points: [[0,0,0],[3,0,0]],
    paths: [[[-2,0,0],[2,0,0]]],
    triangles: []
  }, shell);
  assert.deepEqual(clipped.points, [[0,0,0]]);
  assert.deepEqual(clipped.paths, [[[-1,0,0],[1,0,0]]]);
});

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
