import assert from 'node:assert/strict';
import test from 'node:test';

import {
  closestInterpolatedPathContact,
  coordinateFrameControlGraph,
  directedArrowPlacement,
  interpolatedFaceBoundary,
  interpolatedTopologyEdgePath,
  interpolateDirectedPath,
  makeInterpolationEditorBridge,
  normalizeInterpolationStyle
} from '../../web/vf-ui/vf-interpolation.mjs';

test('finds interpolated-curve contacts with tangent-derived outward normals', () => {
  const curve = interpolateDirectedPath([[-1, 0], [0, 1], [1, 0]], {
    type: 'spline', tension: 0.5
  }, 32);
  const openContact = closestInterpolatedPathContact(curve, [0, 1.25], {
    normalSide: 'left'
  });
  assert.ok(Math.abs(openContact.point[0]) < 1e-9);
  assert.ok(Math.abs(openContact.point[1] - 1) < 1e-9);
  assert.ok(openContact.tangent[0] > 0.99);
  assert.ok(openContact.normal[1] > 0.99);
  assert.ok(Math.abs(openContact.signedDistance - 0.25) < 1e-9);

  const closedContact = closestInterpolatedPathContact([
    [-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]
  ], [0, -1.2], { closed: true });
  assert.deepEqual(closedContact.normal, [0, -1]);
  assert.ok(Math.abs(closedContact.signedDistance - 0.2) < 1e-9);
});

test('normalizes the legacy interpolation-editor style contract', () => {
  assert.deepEqual(normalizeInterpolationStyle({
    id: 's1', type: 'linear', linearArrowMode: 'relative', linearArrowRelativeValue: 2
  }), {
    id: 's1', name: 'Linear', type: 'linear', order: 1, tension: 0.5,
    linearStyle: 'lines', linearArrowMode: 'relative', linearArrowRelativeMode: 'end',
    linearArrowRelativeValue: 1, linearArrowAbsoluteMode: 'dist', linearArrowAbsoluteValue: 1
  });
  assert.equal(normalizeInterpolationStyle({ type: 'cubic_spline' }).type, 'spline');
  assert.equal(normalizeInterpolationStyle({ type: 'nurbs' }).name, 'Spline');
  assert.equal(normalizeInterpolationStyle({ type: 'circular_arc' }).type, 'radius');
  assert.equal(normalizeInterpolationStyle({ type: 'nurbs', nurbsPointMode: 'control_only' }).pointHandling, 'control');
});

test('curves visual edge chains while preserving straight topology interaction', () => {
  const graph = {
    vertices: [
      { id: 'v0', properties: { position: [0, 0] } },
      { id: 'v1', properties: { position: [1, 1] } },
      { id: 'v2', properties: { position: [2, 0] } }
    ],
    hyperedges: [
      { id: 'e0', vertices: ['v0', 'v1'], properties: { interpolationStyleId: 'curve' } },
      { id: 'e1', vertices: ['v1', 'v2'], properties: { interpolationStyleId: 'curve' } }
    ]
  };
  const result = interpolatedTopologyEdgePath(graph, 'e0', [{ id: 'curve', type: 'spline' }], 8);
  assert.deepEqual(result.interactionPath, [[0, 0], [1, 1]]);
  assert.deepEqual(result.visualPath[0], [0, 0]);
  assert.deepEqual(result.visualPath.at(-1), [1, 1]);
  assert.ok(result.visualPath.length > 2);
  assert.ok(result.visualPath.some(([x, y]) => Math.abs(x - y) > 0.01));
});

test('builds face fill boundary from interpolated boundary edges', () => {
  const style = { id: 'curve', type: 'spline' };
  const graph = {
    vertices: [
      { id: 'v0', properties: { position: [0, 0] } },
      { id: 'v1', properties: { position: [2, 0] } },
      { id: 'v2', properties: { position: [1, 2] } }
    ],
    hyperedges: [
      { id: 'e0', vertices: ['v0', 'v1'], properties: { interpolationStyleId: 'curve' } },
      { id: 'e1', vertices: ['v1', 'v2'], properties: { interpolationStyleId: 'curve' } },
      { id: 'e2', vertices: ['v2', 'v0'], properties: { interpolationStyleId: 'curve' } }
    ],
    faces: [{ id: 'f0', vertices: ['v0', 'v1', 'v2'], properties: {} }]
  };
  const boundary = interpolatedFaceBoundary(graph, 'f0', [style], 8);
  assert.deepEqual(boundary[0], [0, 0]);
  assert.deepEqual(boundary.at(-1), [0, 0]);
  assert.ok(boundary.length > 4);
});

test('adapts interpolation-editor graph payloads to VKF paths', () => {
  const bridge = makeInterpolationEditorBridge();
  const result = bridge.compute_interpolation({
    graph: {
      vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }],
      edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }]
    },
    style: { type: 'cubic_spline', tension: 0.25 },
    samples_per_segment: 8
  });
  assert.equal(result.paths.length, 1);
  assert.deepEqual(result.paths[0].points[0], { x: 0, y: 0 });
  assert.deepEqual(result.paths[0].points.at(-1), { x: 2, y: 0 });
  assert.ok(result.paths[0].points.length > 3);
});

test('interpolates directed paths and places an arrow along their tangent', () => {
  const path = interpolateDirectedPath([[0, 0], [1, 1], [2, 0]], {
    type: 'spline', tension: 0.5
  }, 8);
  assert.deepEqual(path[0], [0, 0]);
  assert.deepEqual(path.at(-1), [2, 0]);
  assert.ok(path.length > 3);
  const arrow = directedArrowPlacement(path, {
    type: 'linear', linearArrowMode: 'relative', linearArrowRelativeMode: 'end',
    linearArrowRelativeValue: 0.25
  });
  assert.ok(arrow.position[0] > 1);
  assert.ok(arrow.tangent[0] > 0);
});

test('uses distinct control, anchor, and mixed point intersection rules', () => {
  const points = [[0, 0], [1, 1], [2, 0], [3, 1]];
  const anchor = interpolateDirectedPath(points, { type: 'spline', pointHandling: 'anchor' }, 8);
  const control = interpolateDirectedPath(points, { type: 'spline', pointHandling: 'control' }, 8);
  const mixed = interpolateDirectedPath(points, {
    type: 'spline', pointHandling: 'mixed', nurbsSide: 'left'
  }, 8);
  assert.ok(anchor.some((point) => point[0] === 1 && point[1] === 1));
  assert.ok(!control.some((point) => point[0] === 1 && point[1] === 1));
  assert.notDeepEqual(mixed, anchor);
  assert.notDeepEqual(mixed, control);
});

test('represents a 2D coordinate frame as three selectable vertices and two directed axes', () => {
  const graph = coordinateFrameControlGraph([2, 0, 0, 2, 5, 6], { id: 'surface:f0' });
  assert.deepEqual(graph.vertices.map(({ id, position, color, transparent }) => ({
    id, position, color, transparent
  })), [
    { id: 'surface:f0:origin', position: [5, 6], color: '#0000ff', transparent: false },
    { id: 'surface:f0:x', position: [7, 6], color: '#ff0000', transparent: true },
    { id: 'surface:f0:y', position: [5, 8], color: '#00ff00', transparent: true }
  ]);
  assert.deepEqual(graph.edges.map(({ from, to, color, directed }) => ({ from, to, color, directed })), [
    { from: 'surface:f0:origin', to: 'surface:f0:x', color: '#ff0000', directed: true },
    { from: 'surface:f0:origin', to: 'surface:f0:y', color: '#00ff00', directed: true }
  ]);
});
