import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const gallery = path.join(root, "examples", "material_ui_gallery");
const work = path.join(root, ".w", `material-stanford-${process.pid}`);
const stager = process.env.VKF_NATIVE_SCENE_STAGER;

after(() => rm(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));

test("material gallery stages the full Stanford Bunny and mirror studio", async () => {
  assert.ok(stager, "VKF_NATIVE_SCENE_STAGER is required");
  const artifact = path.join(work, "artifact");
  const overlay = path.join(artifact, "vf-ui");
  await cp(gallery, artifact, { recursive: true });
  await cp(path.join(root, "web", "vf-ui"), overlay, { recursive: true });
  const source = path.join(artifact, "app.vkf");
  const result = spawnSync(stager, ["--source", source, "--overlay-web", overlay], {
    cwd: root, encoding: "utf8", windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.scene_config_source, "vkf-native-scene-source-lowering");
  const session = path.dirname(path.join(overlay, ...summary.page_rel.split("/")));
  const [page, packets] = await Promise.all([
    readFile(path.join(session, "vkf-scene.html"), "utf8"),
    readFile(path.join(session, "vf-runtime-packets.json"), "utf8").then(JSON.parse),
  ]);
  const config = JSON.parse(
    page.match(/window\.__vfNativeSceneConfig=(\{.*?\});window\.__vfNativeSceneArenaUrl=/su)[1],
  ).scene_ir;
  const meshes = Object.fromEntries(config.meshes.map((mesh) => [mesh.id, mesh.properties]));
  assert.equal(meshes.stanford_bunny.vertices.length, 35947 * 10);
  assert.equal(meshes.stanford_bunny.indices.length, 69451 * 3);
  assert.equal(meshes.stanford_bunny.vertices.type, "float32");
  assert.equal(meshes.stanford_bunny.indices.type, "uint32");
  assert.equal(meshes.stanford_bunny.topology, "triangle-list");
  assert.equal(meshes.stanford_bunny.interpolation, true);
  assert.equal(meshes.stanford_bunny.casts_shadow, true);
  assert.equal(meshes.plane_0.texture.kind, "checker");
  assert.equal(meshes.studio_floor.surface_system.kind, "screen");
  assert.equal(meshes.upright_mirror.surface_system.kind, "screen");
  assert.deepEqual(config.shadow_receivers.map(({ receiver_mesh: id }) => id), [
    "plane_0", "studio_floor",
  ]);
  assert.ok(config.shadow_receivers.every(({ occluders }) => occluders[0] === "stanford_bunny"));
  assert.equal(config.lights.filter((light) => light.properties.casts_shadow).length, 1);
  const frame = packets[0].payload.commands[0].payload.spec;
  assert.equal(frame.title, "Stanford Bunny material studio");
  assert.ok(frame.body.some(({ id }) => id === "material-studio"));
});
