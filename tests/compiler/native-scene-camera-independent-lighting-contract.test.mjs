import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const compilerSource = readFileSync(
  new URL("../../compiler/native/vkf_webgpu_artifact_smoke.cpp", import.meta.url),
  "utf8",
);

function subtract(a, b) {
  return a.map((value, index) => value - b[index]);
}

function dot(a, b) {
  return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(value) {
  const magnitude = Math.sqrt(dot(value, value));
  return value.map((component) => component / magnitude);
}

function projectToNdc(camera, worldPosition, aspect = 1784 / 995) {
  const zAxis = normalize(subtract(camera.eye, camera.target));
  const xAxis = normalize(cross(camera.up, zAxis));
  const yAxis = cross(zAxis, xAxis);
  const relative = subtract(worldPosition, camera.eye);
  const viewDepth = -dot(zAxis, relative);
  const focal = 1 / Math.tan((camera.fov * Math.PI) / 360);
  return [
    (focal / aspect) * dot(xAxis, relative) / viewDepth,
    focal * dot(yAxis, relative) / viewDepth,
  ];
}

function lambertRadianceAtProbe({ position, normal }, light) {
  const toLight = subtract(light.position, position);
  const distance = Math.sqrt(dot(toLight, toLight));
  const direction = normalize(toLight);
  const rangeRatio = Math.min(distance / light.range, 1);
  const fade = 1 - rangeRatio * rangeRatio;
  const attenuation = distance >= light.range
    ? 0
    : light.intensity / Math.max(distance * distance, 1e-6) * fade * fade;
  return light.color.map((channel) =>
    channel * attenuation * light.visibility * Math.max(dot(normal, direction), 0));
}

test("emitter viewport visibility cannot change world-space diffuse radiance", () => {
  const visibleCamera = {
    eye: [0, -8.3, 4.6],
    target: [0, 0.45, 1.45],
    up: [0, 0, 1],
    fov: 43,
  };
  const offscreenCamera = {
    eye: [-9.169651, 0.45, 3],
    target: visibleCamera.target,
    up: visibleCamera.up,
    fov: visibleCamera.fov,
  };
  const light = {
    position: [-4, 0.3, 4.8],
    color: [1, 0.72, 0.36],
    intensity: 38.4,
    range: 20,
    visibility: 0.625,
  };
  const floorProbe = { position: [3, -2, 0], normal: [0, 0, 1] };

  const visibleNdc = projectToNdc(visibleCamera, light.position);
  const offscreenNdc = projectToNdc(offscreenCamera, light.position);
  assert.ok(Math.abs(visibleNdc[0]) < 1 && Math.abs(visibleNdc[1]) < 1);
  assert.ok(Math.abs(offscreenNdc[1]) > 1.3);

  const visibleRadiance = lambertRadianceAtProbe(floorProbe, light);
  const offscreenRadiance = lambertRadianceAtProbe(floorProbe, light);
  assert.deepEqual(offscreenRadiance, visibleRadiance);
});

test("sub-unit scenes retain physical inverse-square light transport", () => {
  const light = {
    position: [0, 0, 0.5],
    color: [1, 1, 1],
    intensity: 1,
    range: 1000,
    visibility: 1,
  };
  const near = lambertRadianceAtProbe(
    { position: [0, 0, 0], normal: [0, 0, 1] },
    light,
  )[0];
  const far = lambertRadianceAtProbe(
    { position: [0, 0, -0.5], normal: [0, 0, 1] },
    light,
  )[0];

  assert.ok(Math.abs(near / far - 4) < 1e-5);
  assert.match(
    compilerSource,
    /intensity \/ max\(distance \* distance, 1\.0e-6\)/u,
  );
  assert.match(
    compilerSource,
    /max\(raw_lights\[base \+ 11u\], 0\.0\)/u,
  );
  assert.doesNotMatch(
    compilerSource,
    /max\(raw_lights\[base \+ 11u\], 1\.0e-3\)/u,
  );
});

test("generated lighting keeps camera projection out of diffuse, aperture, and shadow ownership", () => {
  const sceneFragment = compilerSource.slice(
    compilerSource.indexOf("fn vkf_scene_fragment("),
    compilerSource.indexOf("struct FlareVertexOut"),
  );
  const diffuseAccumulation = sceneFragment.slice(
    sceneFragment.indexOf("var diffuse_rgb"),
    sceneFragment.indexOf("var shaded"),
  );
  const flareVertex = compilerSource.slice(
    compilerSource.indexOf("fn vkf_flare_billboard_vertex("),
    compilerSource.indexOf("@vertex\nfn vkf_emitter_vertex"),
  );

  assert.match(diffuseAccumulation, /let radiance = light\.color_and_intensity\.rgb \*\s*attenuation \* visibility;/u);
  assert.match(diffuseAccumulation, /diffuse_rgb = diffuse_rgb \+ radiance \* diffuse;/u);
  assert.doesNotMatch(diffuseAccumulation, /view_projection|source_clip|is_in_front/u);
  assert.match(
    flareVertex,
    /let frustum_visibility = vkf_flare_frustum_visibility\(\s*source_clip, flare_extent_ndc\);/u,
  );
  assert.match(
    flareVertex,
    /out\.enabled = is_physical \* is_enabled \* frustum_visibility;/u,
  );
  assert.match(compilerSource, /const VKF_FINAL_MIDDLE_GRAY: f32 = 0\.18;/u);
  assert.match(compilerSource, /vkf_planar_reflection\(\s*input\.world_position, input\.reflection_camera_index\)/u);
});
