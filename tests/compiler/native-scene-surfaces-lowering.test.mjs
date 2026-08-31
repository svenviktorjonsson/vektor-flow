import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const nativeSceneStager = process.env.VKF_NATIVE_SCENE_STAGER;
const workRoot = path.join(repositoryRoot, ".w", `g01o-native-surfaces-${process.pid}`);

after(() => rm(workRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));

function run(command, args = []) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || `${command} failed without diagnostics`);
  return result.stdout;
}

test("native scene source lowering retains planar surfaces referenced by reflected lights", async () => {
  assert.ok(nativeSceneStager, "VKF_NATIVE_SCENE_STAGER must name the focused stager executable");
  const source = path.join(repositoryRoot, "examples", "111_mirror_smoke.vkf");
  const overlayWeb = path.join(workRoot, "vf-ui");
  await mkdir(workRoot, { recursive: true });
  await cp(path.join(repositoryRoot, "web", "vf-ui"), overlayWeb, { recursive: true });

  const summary = JSON.parse(run(nativeSceneStager, ["--source", source, "--overlay-web", overlayWeb]));
  const page = await readFile(path.join(overlayWeb, ...summary.page_rel.split("/")), "utf8");
  const assignment = page.match(/window\.__vfNativeSceneConfig=(\{.*?\});window\.__vfNativeSceneArenaUrl=/su);
  assert.ok(assignment, "staged page must embed the lowered scene configuration");
  const scene = JSON.parse(assignment[1]).scene_ir;
  const mirror = scene.meshes.find(({ id }) => id === "back_mirror");

  assert.ok(mirror, "the referenced back_mirror surface must be a rendered mesh");
  assert.equal(mirror.kind, "quad");
  assert.equal(mirror.properties.surface_system.kind, "screen");
  assert.deepEqual(mirror.properties.size, [2.6, 2.2]);
  assert.equal(scene.lights.find(({ id }) => id === "virtual_light").properties.reflect_mirror_mesh_id, mirror.id);
});
