import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");

async function vkfSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return vkfSources(absolute);
    return entry.isFile() && entry.name.endsWith(".vkf") ? [absolute] : [];
  }));
  return nested.flat();
}

async function exampleSources() {
  const examples = path.join(repositoryRoot, "examples");
  return Promise.all((await vkfSources(examples)).map(async (absolute) => ({
    path: path.relative(repositoryRoot, absolute).replaceAll("\\", "/"),
    source: await readFile(absolute, "utf8"),
  })));
}

function matchingExamplePaths(sources, pattern) {
  return sources
    .filter(({ source }) => pattern.test(source))
    .map(({ path: sourcePath }) => sourcePath)
    .sort();
}

test("legacy public render syntax can only shrink during add/push migration", async () => {
  const sources = await exampleSources();
  assert.deepEqual(matchingExamplePaths(sources, /\bnative_scene\s*[:(]/u), [
    "examples/110_mirror_showcase.vkf",
    "examples/111_mirror_smoke.vkf",
    "examples/112_scene3d_smoke.vkf",
    "examples/114_grass_texture_cube.vkf",
    "examples/material_ui_gallery/app.vkf",
    "examples/physics_rigid_polygons_2d.vkf",
    "examples/scene_gallery/10-sun-reflection/app.vkf",
    "examples/scene_gallery/11-roughness/app.vkf",
    "examples/scene_gallery/12-layered-glass/app.vkf",
    "examples/scene_gallery/15-spot-light/app.vkf",
    "examples/scene_gallery/16-dice-texture/app.vkf",
    "examples/scene_gallery/19-wireframe-points/app.vkf",
    "examples/scene_gallery/20-rigid-body-snapshot/app.vkf",
  ]);
  assert.deepEqual(matchingExamplePaths(sources, /\.add_light\s*\(/u), [
    "examples/generated/physics_hard_disc_collision_single_frame.vkf",
    "examples/generated/physics_hard_sphere_gpu_10000.vkf",
    "examples/generated/physics_hard_sphere_gpu_50000.vkf",
    "examples/programs/vkf_chess_3d/lib/scene.vkf",
    "examples/programs/vkf_chess_3d/main.vkf",
    "examples/scene_gallery/02-lit-surface/app.vkf",
    "examples/scene_gallery/03-mirror/app.vkf",
    "examples/scene_gallery/04-tinted-glass/app.vkf",
    "examples/scene_gallery/05-checker-texture/app.vkf",
    "examples/scene_gallery/06-shadows/app.vkf",
    "examples/scene_gallery/07-multiple-lights/app.vkf",
    "examples/scene_gallery/08-grass/app.vkf",
    "examples/scene_gallery/09-html-controls/app.vkf",
    "examples/scene_gallery/13-saddle-plot/app.vkf",
  ]);
  assert.deepEqual(matchingExamplePaths(sources, /kind\s*:\s*"projected"/u), [
    "examples/111_mirror_smoke.vkf",
    "examples/material_ui_gallery/app.vkf",
    "examples/scene_gallery/10-sun-reflection/app.vkf",
  ]);
  assert.deepEqual(matchingExamplePaths(sources, /motion\s*:\s*"orbit"/u), [
    "examples/110_mirror_showcase.vkf",
    "examples/111_mirror_smoke.vkf",
    "examples/scene_gallery/10-sun-reflection/app.vkf",
  ]);
});
