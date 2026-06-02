const assert = require("node:assert/strict");
const benchmark = require("../../web/vf-ui/vf-ui-scene-fps-benchmark.js");

const payload = benchmark.runUiSceneFpsBenchmark({
  frames: 6,
  warmupFrames: 2,
  cases: [
    {
      name: "test_scene_space_sample",
      objectTypes: { rects: 2, meshes: 3, points: 24, edges: 32, faces: 12 },
      vertices: 48,
      edges: 56,
      faces: 18,
      viewChangesPerFrame: 3,
      objectChangesPerFrame: 5,
      effects: { lights: 2, shadows: true, reflections: true }
    }
  ]
});

assert.equal(payload.contract.metric, "ui_scene_config_space_fps");
assert.deepEqual(payload.contract.units.fps, "frames_per_second");
assert.equal(payload.summary.cases, 1);
assert.ok(payload.summary.min_p95_budgeted_fps > 0);

const scene = payload.cases[0];
assert.equal(scene.name, "test_scene_space_sample");
assert.deepEqual(scene.object_types, { rects: 2, meshes: 3, points: 24, edges: 32, faces: 12 });
assert.deepEqual(scene.geometry, { vertices: 48, edges: 56, faces: 18 });
assert.deepEqual(scene.changes_per_frame, { view: 3, object: 5 });
assert.deepEqual(scene.effects, { lights: 2, shadows: true, reflections: true });
assert.equal(scene.frame_ms.count, 6);
assert.ok(scene.frame_ms.mean > 0);
assert.ok(scene.frame_ms.p95 >= scene.frame_ms.min);
assert.ok(scene.fps_possible.median > 0);
assert.ok(scene.fps_possible.p95_budgeted > 0);
assert.ok(scene.dirty_vertices.mean >= 1);
assert.ok(scene.dirty_transforms.mean >= 1);
assert.ok(scene.approximation_model.includes("lighting evaluation"));
assert.ok(scene.approximation_model.includes("reflection pass overhead"));
