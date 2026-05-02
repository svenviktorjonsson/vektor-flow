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

console.log("vf-vkf-ui-runtime tests passed");
