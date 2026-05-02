const assert = require("node:assert/strict");
const shared = require("../../web/vf-ui/vf-shared-runtime.js");
const vkfUi = require("../../web/vf-ui/vf-vkf-ui-runtime.js");

{
  const arena = shared.createTransformArena(2);
  const eventArena = shared.createEventArena(4);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena });
  const ui = runtime.ui;

  const panel = ui.display.frame({ title: "VKF rect" });
  ui.display.add_frame(panel, [0.18, 0.18, 0.42, 0.34]);
  const rect = panel.add_rect([120, 96, 180, 118], {
    color: [0.2, 0.82, 0.49, 1.0]
  });

  eventArena.writeInputSample({
    sequence: 1,
    cursorPx: [150, 116],
    pointerAnchorPx: [120, 96],
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
    assert.deepEqual(e.trans, [30, 20]);
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
      x: [100, 180, 140],
      y: [120, 120, 190]
    },
    {
      color: [0.8, 0.5, 0.2, 1],
      vertex_width: 10,
      edge_width: 6
    }
  );
  mesh.add_vertices([0, 1, 2]);
  mesh.add_edges([[0, 1], [1, 2], [2, 0]]);
  mesh.add_faces([[0, 1, 2]]);

  assert.equal(mesh.vertex_width, 10);
  assert.equal(mesh.edge_width, 6);
  assert.deepEqual(mesh.world_point(1), [180, 120, 0]);
  assert.deepEqual(panel.pick([100, 120]).hover, {
    object_id: mesh.id,
    vertex_id: 0,
    edge_id: -1,
    face_id: -1
  });
  assert.deepEqual(panel.pick([140, 120]).hover, {
    object_id: mesh.id,
    vertex_id: -1,
    edge_id: 0,
    face_id: -1
  });
  assert.deepEqual(panel.pick([140, 145]).hover, {
    object_id: mesh.id,
    vertex_id: -1,
    edge_id: -1,
    face_id: 0
  });

  const beforeVertex = mesh.world_points().map((p) => p.slice());
  mesh.rotate_scale_at_vertex({ vertex: 0, trans: [18, -12] });
  assert.notDeepEqual(mesh.world_points(), beforeVertex);

  const beforeEdge = mesh.world_points().map((p) => p.slice());
  mesh.scale_edge({ edge: 0, trans: [0, 18] });
  assert.notDeepEqual(mesh.world_points(), beforeEdge);
}

console.log("vf-vkf-ui-runtime tests passed");
