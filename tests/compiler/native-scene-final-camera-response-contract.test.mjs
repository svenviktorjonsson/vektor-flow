import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

const cameraResponse = (linearRadiance) => {
  const exposed = Math.max(linearRadiance, 0) / 0.18;
  return exposed / (1 + exposed);
};

test("camera response maps physical middle gray to display middle gray", () => {
  assert.equal(cameraResponse(0.18), 0.5);
  assert.ok(cameraResponse(1) > 0.8);
});

test("final camera response preserves a visible direct-light delta in projected overlap", () => {
  const projectedContribution = 1.25;
  const directContribution = 1.75;
  const accumulatedRadiance = (directVisibility) =>
    projectedContribution + directVisibility * directContribution;
  const projectedOnly = accumulatedRadiance(0);
  const directAndProjected = accumulatedRadiance(1);

  assert.equal(
    directAndProjected - projectedOnly,
    directContribution,
    "the direct visibility term must remain an independent additive contribution",
  );

  assert.equal(
    Math.min(projectedOnly, 1),
    Math.min(directAndProjected, 1),
    "raw RGBA8 storage clips both physically different radiances to one value",
  );
  assert.ok(
    cameraResponse(directAndProjected) > cameraResponse(projectedOnly),
    "a monotone camera response must retain the positive direct-light contribution",
  );
  assert.ok(cameraResponse(directAndProjected) <= directAndProjected,
    "the display response must not create radiometric energy");
});

test("compiled scene tone maps only the final camera pass", async () => {
  const source = await readFile(path.join(
    repositoryRoot,
    "compiler/native/vkf_webgpu_artifact_smoke.cpp",
  ), "utf8");

  assert.match(source, /const VKF_FINAL_MIDDLE_GRAY: f32 = 0\.18/u);
  assert.match(
    source,
    /max\(linear_radiance, vec3<f32>\(0\.0\)\) \/ VKF_FINAL_MIDDLE_GRAY/u,
  );
  assert.match(source, /fn vkf_final_camera_response\(/u);
  assert.match(
    source,
    /fn vkf_present_fragment[\s\S]*vkf_final_camera_response\(linear\.rgb\)/u,
    "the fullscreen presentation pass must apply the final camera response",
  );
  assert.match(source, /return vec4<f32>\(shaded, material_color\.a\)/u);
  assert.doesNotMatch(
    source,
    /pass_state\.reflection_depth == 0u/u,
    "scene and reflection passes must both write linear HDR",
  );
  assert.doesNotMatch(
    source,
    /diffuse_rgb = diffuse_rgb \+ vkf_final_camera_response/u,
    "camera response must not alter additive per-light energy",
  );
});
