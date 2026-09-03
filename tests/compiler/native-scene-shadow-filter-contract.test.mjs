import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

test("compiled soft shadows use a deterministic full-disk quality kernel", async () => {
  const source = await readFile(path.join(
    repositoryRoot,
    "compiler/native/vkf_webgpu_artifact_smoke.cpp",
  ), "utf8");

  assert.match(source, /VKF_SHADOW_BLOCKER_SAMPLE_COUNT: u32 = 16u/u);
  assert.match(source, /VKF_SHADOW_FILTER_SAMPLE_COUNT: u32 = 32u/u);
  assert.match(source, /VKF_SHADOW_DISK: array<vec2<f32>, 32>/u);
  assert.doesNotMatch(
    source,
    /fn vkf_shadow_rotation|fract\(sin\(seed\)/u,
    "static shadows must not contain per-pixel random rotation",
  );
  assert.match(source, /VKF_SHADOW_DISK\[sample_index \* 2u\]/u);
  assert.match(source, /VKF_SHADOW_DISK\[sample_index\]/u);
  assert.match(
    source,
    /let search_radius_uv = clamp\([\s\S]*?4\.0 \* texel_radius,[\s\S]*?24\.0 \* texel_radius/u,
    "blocker search needs a stable multi-texel footprint for moving lights",
  );
  assert.match(
    source,
    /let filter_radius_uv = clamp\([\s\S]*?3\.0 \* texel_radius,[\s\S]*?32\.0 \* texel_radius/u,
    "shadow filtering must smooth sub-texel motion instead of flashing",
  );
});

test("fitted shadow views keep a stable up axis through horizontal light orbits", async () => {
  const source = await readFile(path.join(
    repositoryRoot,
    "compiler/native/vkf_webgpu_artifact_smoke.cpp",
  ), "utf8");

  assert.match(
    source,
    /fn vkf_adaptive_shadow_up\(direction: vec3<f32>\)[\s\S]*?vec3<f32>\(0\.0, 1\.0, 0\.0\),[\s\S]*?vec3<f32>\(0\.0, 0\.0, 1\.0\),[\s\S]*?abs\(unit_direction\.y\) > 0\.98/u,
    "a horizontal orbit must not trigger a discontinuous shadow-camera roll",
  );
  assert.doesNotMatch(
    source,
    /fn vkf_adaptive_shadow_up\(direction: vec3<f32>\)[\s\S]*?abs\(unit_direction\.z\) > 0\.98/u,
  );
});
