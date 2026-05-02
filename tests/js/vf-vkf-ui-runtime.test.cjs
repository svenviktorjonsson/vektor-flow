const assert = require("node:assert/strict");
const shared = require("../../web/vf-ui/vf-shared-runtime.js");
const vkfUi = require("../../web/vf-ui/vf-vkf-ui-runtime.js");

function assertApproxPoint(actual, expected, epsilon = 1e-6) {
  assert.ok(Math.abs(actual[0] - expected[0]) <= epsilon, `${actual[0]} ~= ${expected[0]}`);
  assert.ok(Math.abs(actual[1] - expected[1]) <= epsilon, `${actual[1]} ~= ${expected[1]}`);
}

{
  const arena = shared.createTransformArena(2);
  const eventArena = shared.createEventArena(4);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena, width: 1280, height: 720 });
  const ui = runtime.ui;
  assert.equal(ui.display.width, 1280);
  assert.equal(ui.display.height, 720);
  ui.keyboard.set_mask(5);
  assert.deepEqual(ui.keyboard.modifiers, {
    ctrl: true,
    shift: false,
    alt: true,
    meta: false
  });
  ui.display.set_size({ width: 960, height: 540 });
  assert.equal(ui.display.width, 960);
  assert.equal(ui.display.height, 540);

  const panel = ui.display.frame({ title: "VKF rect" });
  ui.display.add_frame(panel, [0.18, 0.18, 0.42, 0.34]);
  const rect = panel.add_rect([120, 96, 180, 118], {
    color: [0.2, 0.82, 0.49, 1.0]
  });

  eventArena.writeInputSample({
    sequence: 1,
    cursorPx: [150, 116],
    pointerAnchorPx: [120, 96],
    localCursor: [0.5, 0.25],
    localAnchor: [0.1, -0.25],
    pointerDown: true,
    buttons: 1,
    hover: { object: rect.id }
  });

  const originalStringify = JSON.stringify;
  const originalParse = JSON.parse;
  JSON.stringify = function () {
    throw new Error("JSON.stringify must not be used by the VKF UI hot path");
  };
  JSON.parse = function () {
    throw new Error("JSON.parse must not be used by the VKF UI hot path");
  };

  try {
    const e = ui.events.get();
    const target = panel.get(e.hover);
  assert.equal(e.event, ui.MOUSE_DRAG);
  assert.equal(e.hover.object_id, rect.id);
  assert.equal(e.hover.mask, vkfUi.HOVER_OBJECT);
    assert.equal(e.hover.kind, vkfUi.HOVER_OBJECT);
    assert.deepEqual(e.trans, [30, 20]);
    assert.deepEqual(e.local_cursor, [0.5, 0.25]);
    assert.deepEqual(e.local_anchor, [0.1, -0.25]);
    assert.deepEqual(e.local_trans, [0.4, 0.5]);
    assert.equal(e.key_mask, 0);
    assert.equal(target, rect);
    target.translate({ trans: e.trans });
  } finally {
    JSON.stringify = originalStringify;
    JSON.parse = originalParse;
  }

  assert.equal(arena.mat4[rect.slot * shared.MAT4_F32 + 12], 150);
  assert.equal(arena.mat4[rect.slot * shared.MAT4_F32 + 13], 116);
  assert.deepEqual(arena.dirtyRange(), { version: 2, min: 0, max: 0 });
}

{
  const arena = shared.createTransformArena(4);
  const eventArena = shared.createEventArena(4);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena });
  const ui = runtime.ui;
  const panel = ui.display.frame();
  ui.display.add_frame(panel, [0, 0, 1, 1]);

  const parent = panel.add_rect([100, 80, 220, 140], { color: [1, 0, 0, 1] });
  const child = parent.add_rect([40, 30, 100, 70], { color: [0, 1, 0, 1] });
  const leaf = child.add_rect([18, 14, 36, 24], { color: [0, 0, 1, 1] });

  assert.deepEqual(parent.world_rect(), { x: 100, y: 80, w: 220, h: 140 });
  assert.deepEqual(child.world_rect(), { x: 140, y: 110, w: 100, h: 70 });
  assert.deepEqual(leaf.world_rect(), { x: 158, y: 124, w: 36, h: 24 });

  parent.translate({ trans: [10, 20] });

  assert.deepEqual(parent.world_rect(), { x: 110, y: 100, w: 220, h: 140 });
  assert.deepEqual(child.world_rect(), { x: 150, y: 130, w: 100, h: 70 });
  assert.deepEqual(leaf.world_rect(), { x: 168, y: 144, w: 36, h: 24 });
  assert.equal(arena.mat4[parent.slot * shared.MAT4_F32 + 12], 110);
  assert.equal(arena.mat4[child.slot * shared.MAT4_F32 + 12], 150);
  assert.equal(arena.mat4[leaf.slot * shared.MAT4_F32 + 12], 168);
  assert.equal(panel.pick([170, 150]), leaf);
  assert.equal(panel.get({ object_id: child.id }), child);
}

{
  const arena = shared.createTransformArena(1);
  const eventArena = shared.createEventArena(1);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena });
  runtime.ui.cursor.set_mode("open_hand");
  assert.equal(runtime.ui.cursor.mode, "open_hand");
}

{
  const arena = shared.createTransformArena(3);
  const eventArena = shared.createEventArena(1);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena });
  const panel = runtime.ui.display.frame();
  runtime.ui.display.add_frame(panel, [0, 0, 1, 1]);

  const mesh = panel.add({
    x: [0, 1, 0, 0],
    y: [0, 0, 1, 0],
    z: [0, 0, 0, 1]
  });

  mesh.add_vertices([0, 1, 2, 3]);
  mesh.add_edges([[0, 1], [1, 2], [2, 0]]);
  mesh.add_faces([[0, 1, 2]]);
  mesh.add_volumes([[0, 1, 2]]);
  mesh.add_volumes([[0, 1, 2, 3]]);

  assert.deepEqual(mesh.coords.x, [0, 1, 0, 0]);
  assert.deepEqual(mesh.vertices, [0, 1, 2, 3]);
  assert.deepEqual(mesh.edges, [[0, 1], [1, 2], [2, 0]]);
  assert.deepEqual(mesh.faces, [[0, 1, 2]]);
  assert.deepEqual(mesh.volumes, [[0, 1, 2, 3]]);
  assert.equal(mesh.volume_policy, "filled");
  assert.equal(panel.get({ object_id: mesh.id }), mesh);
}

{
  const arena = shared.createTransformArena(4);
  const eventArena = shared.createEventArena(4);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena });
  const panel = runtime.ui.display.frame();
  runtime.ui.display.add_frame(panel, [0, 0, 1, 1]);

  const mesh = panel.add(
    {
      x: [-1, 1, 0],
      y: [-1, -1, 1],
      bounds: [100, 120, 80, 70]
    },
    {
      face_color: [0.8, 0.5, 0.2, 1],
      edge_color: [0.1, 0.9, 0.9, 1],
      vertex_color: [1, 0.2, 0.7, 1],
      volume_color: [0.4, 0.4, 1, 1],
      vertex_radius: 10,
      edge_radius: 6
    }
  );
  mesh.add_vertices([0, 1, 2]);
  mesh.add_edges([[0, 1], [1, 2], [2, 0]]);
  mesh.add_faces([[0, 1, 2]]);

  assert.equal(mesh.vertex_radius, 10);
  assert.equal(mesh.edge_radius, 6);
  assert.equal(mesh.vertex_pick_radius, 10);
  assert.equal(mesh.edge_pick_radius, 6);
  assert.deepEqual(mesh.face_color, [0.8, 0.5, 0.2, 1]);
  assert.deepEqual(mesh.edge_color, [0.1, 0.9, 0.9, 1]);
  assert.deepEqual(mesh.vertex_color, [1, 0.2, 0.7, 1]);
  assert.deepEqual(mesh.volume_color, [0.4, 0.4, 1, 1]);
  assert.deepEqual(mesh.visible_volume_surfaces(), {
    policy: "filled",
    surfaces: "first_last_per_dimension"
  });
  assert.deepEqual(mesh.initial_bounds, { x: -1, y: -1, w: 2, h: 2 });
  const defaultOverlay = panel.add({ x: [240, 260], y: [220, 240], normalized: false });
  assert.equal(defaultOverlay.vertex_radius, 4);
  assert.equal(defaultOverlay.edge_radius, 2);
  assert.equal(defaultOverlay.vertex_pick_radius, 5);
  assert.equal(defaultOverlay.edge_pick_radius, 5);
  defaultOverlay.set_overlay({ vertex_width: 7, edge_width: 3 });
  assert.equal(defaultOverlay.vertex_radius, 7);
  assert.equal(defaultOverlay.edge_radius, 3);
  assert.equal(defaultOverlay.vertex_pick_radius, 7);
  assert.equal(defaultOverlay.edge_pick_radius, 5);
  defaultOverlay.set_overlay({ edge_pick_radius: 9 });
  assert.equal(defaultOverlay.edge_pick_radius, 9);
  defaultOverlay.add_vertices([0, 1]);
  defaultOverlay.add_edges([[0, 1]]);
  assert.equal(panel.pick([240, 224]).hover.vertex_id, 0);
  assert.equal(panel.pick([250, 225]).hover.edge_id, 0);
  assert.deepEqual(mesh.world_point(1), [180, 190, 0]);
  assert.deepEqual(panel.pick([100, 190]).hover, {
    object_id: mesh.id,
    vertex_id: 0,
    edge_id: -1,
    face_id: -1,
    mask: 9,
    kind: vkfUi.HOVER_VERTEX
  });
  assert.deepEqual(panel.pick([140, 190]).hover, {
    object_id: mesh.id,
    vertex_id: -1,
    edge_id: 0,
    face_id: -1,
    mask: 5,
    kind: vkfUi.HOVER_EDGE
  });
  assert.deepEqual(panel.pick([140, 160]).hover, {
    object_id: mesh.id,
    vertex_id: -1,
    edge_id: -1,
    face_id: 0,
    mask: 3,
    kind: vkfUi.HOVER_FACE
  });

  const dataBeforeTransform = {
    x: mesh.coords.x.slice(),
    y: mesh.coords.y.slice(),
    z: mesh.coords.z.slice()
  };
  const beforeVertex = mesh.world_points().map((p) => p.slice());
  const originBeforeVertex = mesh.world_inner_point(mesh.origin).slice(0, 2);
  const offsetBeforeVertex = mesh.offset.slice();
  const anchor = mesh.world_point(0);
  const cursor = [anchor[0] + 18, anchor[1] - 12];
  mesh.rotate_scale_at_vertex({ vertex: 0, cursor, trans: [18, -12] });
  assert.notDeepEqual(mesh.world_points(), beforeVertex);
  assert.deepEqual(mesh.offset, offsetBeforeVertex);
  assert.deepEqual(mesh.world_inner_point(mesh.origin).slice(0, 2).map(Math.round), originBeforeVertex.map(Math.round));
  assert.deepEqual(mesh.world_point(0).slice(0, 2).map(Math.round), cursor);
  assert.deepEqual(mesh.coords, dataBeforeTransform);

  const beforeEdge = mesh.world_points().map((p) => p.slice());
  const originBeforeEdge = mesh.world_inner_point(mesh.origin).slice(0, 2);
  const offsetBeforeEdge = mesh.offset.slice();
  const edgeA = mesh._parent_point_from_inner([-1, -1, 0]).slice(0, 2);
  const edgeB = mesh._parent_point_from_inner([1, -1, 0]).slice(0, 2);
  const edgeEx = edgeB[0] - edgeA[0];
  const edgeEy = edgeB[1] - edgeA[1];
  const edgeLen = Math.sqrt(edgeEx * edgeEx + edgeEy * edgeEy);
  const edgeNormal = [-edgeEy / edgeLen, edgeEx / edgeLen];
  const edgeAnchor = mesh._parent_point_from_inner([0, -1, 0]).slice(0, 2);
  const edgeCursor = [edgeAnchor[0] + edgeNormal[0] * 18, edgeAnchor[1] + edgeNormal[1] * 18];
  mesh.scale_edge({ edge: 0, local_anchor: edgeAnchor, local_cursor: edgeCursor, local_trans: [edgeNormal[0] * 18, edgeNormal[1] * 18] });
  assert.notDeepEqual(mesh.world_points(), beforeEdge);
  assert.deepEqual(mesh.offset, offsetBeforeEdge);
  assert.deepEqual(mesh.world_inner_point(mesh.origin).slice(0, 2).map(Math.round), originBeforeEdge.map(Math.round));
  assertApproxPoint(mesh._parent_point_from_inner([0, -1, 0]).slice(0, 2), edgeCursor);
  assert.deepEqual(mesh.coords, dataBeforeTransform);

  const originBeforeTranslate = mesh.world_inner_point(mesh.origin).slice(0, 2);
  mesh.translate({ trans: [7, -4] });
  assert.deepEqual(mesh.world_inner_point(mesh.origin).slice(0, 2).map(Math.round), [
    Math.round(originBeforeTranslate[0] + 7),
    Math.round(originBeforeTranslate[1] - 4)
  ]);
  assert.deepEqual(mesh.coords, dataBeforeTransform);

  const coordsBeforeVertexEdit = {
    x: mesh.coords.x.slice(),
    y: mesh.coords.y.slice(),
    z: mesh.coords.z.slice()
  };
  const transformOffsetBeforeVertexEdit = mesh.offset.slice();
  const geometryVersionBeforeVertexEdit = mesh.geometry_version;
  const editCursor = [mesh._parent_point_from_inner([-1, -1, 0])[0] + 12, mesh._parent_point_from_inner([-1, -1, 0])[1] + 6];
  mesh.move_vertex({ vertex: 0, local_cursor: editCursor });
  assert.equal(mesh.geometry_version, geometryVersionBeforeVertexEdit + 1);
  assert.deepEqual(mesh.offset, transformOffsetBeforeVertexEdit);
  assert.notDeepEqual(mesh.coords.x, coordsBeforeVertexEdit.x);
  assert.notDeepEqual(mesh.coords.y, coordsBeforeVertexEdit.y);
  assertApproxPoint(mesh._parent_point_from_inner([mesh.coords.x[0], mesh.coords.y[0], mesh.coords.z[0]]).slice(0, 2), editCursor);
  assert.deepEqual(mesh.edges, [[0, 1], [1, 2], [2, 0]]);
  assert.deepEqual(mesh.faces, [[0, 1, 2]]);

  const edgeCoordsBefore = {
    x0: mesh.coords.x[0],
    y0: mesh.coords.y[0],
    x1: mesh.coords.x[1],
    y1: mesh.coords.y[1],
    x2: mesh.coords.x[2],
    y2: mesh.coords.y[2]
  };
  const geometryVersionBeforeEdgeEdit = mesh.geometry_version;
  const edgeMove = [9, -7];
  const edge0Before = mesh._parent_point_from_inner([mesh.coords.x[0], mesh.coords.y[0], mesh.coords.z[0]]).slice(0, 2);
  const edge1Before = mesh._parent_point_from_inner([mesh.coords.x[1], mesh.coords.y[1], mesh.coords.z[1]]).slice(0, 2);
  mesh.translate_edge({ edge: 0, local_trans: edgeMove });
  assert.equal(mesh.geometry_version, geometryVersionBeforeEdgeEdit + 1);
  assert.deepEqual(mesh.offset, transformOffsetBeforeVertexEdit);
  assertApproxPoint(mesh._parent_point_from_inner([mesh.coords.x[0], mesh.coords.y[0], mesh.coords.z[0]]).slice(0, 2), [edge0Before[0] + edgeMove[0], edge0Before[1] + edgeMove[1]]);
  assertApproxPoint(mesh._parent_point_from_inner([mesh.coords.x[1], mesh.coords.y[1], mesh.coords.z[1]]).slice(0, 2), [edge1Before[0] + edgeMove[0], edge1Before[1] + edgeMove[1]]);
  assert.notEqual(mesh.coords.x[0], edgeCoordsBefore.x0);
  assert.notEqual(mesh.coords.y[0], edgeCoordsBefore.y0);
  assert.notEqual(mesh.coords.x[1], edgeCoordsBefore.x1);
  assert.notEqual(mesh.coords.y[1], edgeCoordsBefore.y1);
  assert.equal(mesh.coords.x[2], edgeCoordsBefore.x2);
  assert.equal(mesh.coords.y[2], edgeCoordsBefore.y2);
  assert.deepEqual(mesh.edges, [[0, 1], [1, 2], [2, 0]]);
  assert.deepEqual(mesh.faces, [[0, 1, 2]]);

  const childMesh = mesh.add({
    x: [-0.5, 0.5, 0],
    y: [-0.5, -0.4, 0.5],
    face_color: [1, 1, 1, 1],
    edge_color: [1, 1, 1, 1],
    vertex_color: [1, 1, 1, 1],
    vertex_radius: 4,
    edge_radius: 4
  });
  childMesh.add_vertices([0, 1, 2]);
  childMesh.add_edges([[0, 1], [1, 2], [2, 0]]);
  childMesh.add_faces([[0, 1, 2]]);
  assert.deepEqual(childMesh.offset.slice(0, 2), [0, 0]);
  const expectedChildPoint = mesh.world_inner_point([-0.5, -0.5, 0]).slice(0, 2);
  assert.deepEqual(childMesh.world_point(0).slice(0, 2).map(Math.round), expectedChildPoint.map(Math.round));
  const childBefore = childMesh.world_point(0).slice(0, 2);
  mesh.translate({ trans: [11, 13] });
  assert.deepEqual(childMesh.world_point(0).slice(0, 2).map(Math.round), [
    Math.round(childBefore[0] + 11),
    Math.round(childBefore[1] + 13)
  ]);
  const childMatOffset = childMesh.slot * shared.MAT4_F32;
  const childOriginWorld = childMesh.world_inner_point([0, 0, 0]).slice(0, 2);
  assert.deepEqual([
    Math.round(arena.mat4[childMatOffset + 12]),
    Math.round(arena.mat4[childMatOffset + 13])
  ], childOriginWorld.map(Math.round));
}

{
  const arena = shared.createTransformArena(8);
  const eventArena = shared.createEventArena(4);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena });
  const panel = runtime.ui.display.frame();
  runtime.ui.display.add_frame(panel, [0, 0, 1, 1]);

  const root = panel.add({
    x: [-1, 1, 1, -1],
    y: [-1, -1, 1, 1],
    bounds: [100, 80, 200, 160],
    origin: [0, 0, 0]
  });
  root.add_vertices([0, 1, 2, 3]);
  root.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]]);
  root.add_faces([[0, 1, 2, 3]]);
  root.rotate_scale_at_vertex({ vertex: 1, local_cursor: [320, 250], local_trans: [20, 10] });

  const child = root.add({
    x: [-0.5, 0.5, 0.5, -0.5],
    y: [-0.5, -0.5, 0.5, 0.5],
    origin: [0, 0, 0]
  });
  child.add_vertices([0, 1, 2, 3]);
  child.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]]);
  child.add_faces([[0, 1, 2, 3]]);

  const vertexBefore = child._parent_point_from_inner([0.5, -0.5, 0]).slice(0, 2);
  const vertexCursor = [vertexBefore[0] + 0.2, vertexBefore[1] - 0.35];
  child.rotate_scale_at_vertex({ vertex: 1, local_cursor: vertexCursor, local_trans: [0.2, -0.35] });
  assertApproxPoint(child._parent_point_from_inner([0.5, -0.5, 0]).slice(0, 2), vertexCursor);

  const rightEdgeA = child._parent_point_from_inner([0.5, -0.5, 0]).slice(0, 2);
  const rightEdgeB = child._parent_point_from_inner([0.5, 0.5, 0]).slice(0, 2);
  const rightEx = rightEdgeB[0] - rightEdgeA[0];
  const rightEy = rightEdgeB[1] - rightEdgeA[1];
  const rightLen = Math.sqrt(rightEx * rightEx + rightEy * rightEy);
  const rightNormal = [rightEy / rightLen, -rightEx / rightLen];
  const rightEdgeAnchor = child._parent_point_from_inner([0.5, 0, 0]).slice(0, 2);
  const rightEdgeCursor = [rightEdgeAnchor[0] + rightNormal[0] * 0.22, rightEdgeAnchor[1] + rightNormal[1] * 0.22];
  child.scale_edge({ edge: 1, local_anchor: rightEdgeAnchor, local_cursor: rightEdgeCursor, local_trans: [rightNormal[0] * 0.22, rightNormal[1] * 0.22] });
  assertApproxPoint(child._parent_point_from_inner([0.5, 0, 0]).slice(0, 2), rightEdgeCursor);

  const bottomEdgeA = child._parent_point_from_inner([-0.5, -0.5, 0]).slice(0, 2);
  const bottomEdgeB = child._parent_point_from_inner([0.5, -0.5, 0]).slice(0, 2);
  const bottomEx = bottomEdgeB[0] - bottomEdgeA[0];
  const bottomEy = bottomEdgeB[1] - bottomEdgeA[1];
  const bottomLen = Math.sqrt(bottomEx * bottomEx + bottomEy * bottomEy);
  const bottomNormal = [-bottomEy / bottomLen, bottomEx / bottomLen];
  const bottomEdgeAnchor = child._parent_point_from_inner([0, -0.5, 0]).slice(0, 2);
  const bottomEdgeCursor = [bottomEdgeAnchor[0] + bottomNormal[0] * 0.18, bottomEdgeAnchor[1] + bottomNormal[1] * 0.18];
  child.scale_edge({ edge: 0, local_anchor: bottomEdgeAnchor, local_cursor: bottomEdgeCursor, local_trans: [bottomNormal[0] * 0.18, bottomNormal[1] * 0.18] });
  assertApproxPoint(child._parent_point_from_inner([0, -0.5, 0]).slice(0, 2), bottomEdgeCursor);
}

{
  const arena = shared.createTransformArena(4);
  const eventArena = shared.createEventArena(4);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena });
  const panel = runtime.ui.display.frame();
  runtime.ui.display.add_frame(panel, [0, 0, 1, 1]);

  const mesh = panel.add({
    x: [-1, 1, 1, -1],
    y: [-1, -1, 1, 1],
    bounds: [100, 100, 100, 100],
    origin: [0, 0, 0]
  });
  mesh.add_vertices([0, 1, 2, 3]);
  mesh.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]]);
  mesh.add_faces([[0, 1, 2, 3]]);

  const bottomBefore = mesh._parent_point_from_inner([0, -1, 0]).slice(0, 2);
  const origin = mesh._parent_point_from_inner([0, 0, 0]).slice(0, 2);
  const bottomDist = [bottomBefore[0] - origin[0], bottomBefore[1] - origin[1]];
  const flippedCursor = [origin[0] - bottomDist[0] * 0.6, origin[1] - bottomDist[1] * 0.6];
  mesh.scale_edge({
    edge: 0,
    local_anchor: bottomBefore,
    local_cursor: flippedCursor,
    local_trans: [flippedCursor[0] - bottomBefore[0], flippedCursor[1] - bottomBefore[1]]
  });
  const bottomAfter = mesh._parent_point_from_inner([0, -1, 0]).slice(0, 2);
  assertApproxPoint(bottomAfter, flippedCursor);
  assert.ok(
    (bottomBefore[1] - origin[1]) * (bottomAfter[1] - origin[1]) < 0,
    "edge crossed to the opposite side of the origin"
  );
}

console.log("vf-vkf-ui-runtime tests passed");

