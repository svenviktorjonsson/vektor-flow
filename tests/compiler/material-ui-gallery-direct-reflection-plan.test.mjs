import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const nativeBin = process.env.VKF_NATIVE_COMPILER_BIN;
const workRoot = path.join(
  repositoryRoot,
  ".w",
  `material-gallery-direct-reflection-${process.pid}`,
);

after(() => rm(workRoot, { recursive: true, force: true }));

function compilerTool(name) {
  assert.ok(
    nativeBin,
    "VKF_NATIVE_COMPILER_BIN must name the focused native build directory",
  );
  return path.join(nativeBin, process.platform === "win32" ? `${name}.exe` : name);
}

function stage(name, input, args = []) {
  const result = spawnSync(compilerTool(name), args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    input,
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || `${name} failed`);
  return result.stdout;
}

test("material gallery terminates direct reflections without fallback textures", async () => {
  await mkdir(workRoot, { recursive: true });
  const sourcePath = path.join(
    repositoryRoot,
    "examples",
    "material_ui_gallery",
    "app.vkf",
  );
  const tokens = stage("vkf_lexer_cursor_smoke", undefined, ["--file", sourcePath]);
  const ast = stage("vkf_parser_token_stream_smoke", tokens);
  const typedIr = stage("vkf_ast_to_ir_smoke", ast);
  const typedIrPath = path.join(workRoot, "gallery.typed-ir.json");
  await writeFile(typedIrPath, typedIr, "utf8");
  const summary = JSON.parse(stage("vkf_webgpu_artifact_smoke", undefined, [
    "--source",
    sourcePath,
    "--typed-ir",
    typedIrPath,
  ]));
  const manifest = JSON.parse(await readFile(summary.manifest_path, "utf8"));
  const wgsl = await readFile(summary.artifact_path, "utf8");
  const render = manifest.runtime_surface.render_plan;

  assert.equal(render.max_reflection_depth, 1);
  assert.deepEqual(
    render.passes
      .filter(({ kind }) => kind === "prepare_reflection_camera")
      .map(({ reflection_path, parent_camera_state_index }) => ({
        reflection_path,
        parent_camera_state_index,
      })),
    [
      { reflection_path: ["studio_floor"], parent_camera_state_index: null },
      { reflection_path: ["upright_mirror"], parent_camera_state_index: null },
    ],
  );
  const reflectionPasses = render.passes.filter(
    ({ kind }) => kind === "planar_reflection",
  );
  assert.deepEqual(
    reflectionPasses.map(({ reflection_path }) => reflection_path),
    [
      ["studio_floor"],
      ["upright_mirror"],
    ],
  );
  assert.ok(reflectionPasses.every((pass) =>
    pass.pipeline === "retained_scene_terminal_hdr" &&
    pass.fragment_entry === "vkf_terminal_scene_fragment" &&
    pass.reflection_sources === undefined &&
    pass.bind_resources.every((resource) => resource !== "reflection_sources") &&
    pass.bind_groups.every(({ entries }) => entries.every(({ binding }) =>
      binding !== 4 && binding !== 5
    ))
  ), "a terminal reflection pass must terminate without reflection bindings");
  assert.ok(render.targets.every(({ id }) =>
    !id.includes("fallback") &&
    !id.includes("studio_floor__upright_mirror") &&
    !id.includes("upright_mirror__studio_floor")
  ));
  assert.doesNotMatch(
    JSON.stringify(render),
    /fallback/iu,
    "the reflection plan must not contain a fallback concept",
  );
  const scenePass = render.passes.find(({ kind }) => kind === "scene_color");
  assert.equal(scenePass.terminal_pipeline, "retained_scene_terminal_hdr_msaa");
  assert.ok(scenePass.terminal_bind_groups.every(({ entries }) =>
    entries.every(({ binding }) => binding !== 4 && binding !== 5)
  ), "non-reflective Scene Instances must use a pipeline with no reflection binding");
  assert.ok(scenePass.terminal_bind_groups
    .find(({ group }) => group === 2).entries
    .every(({ binding }) => binding !== 2),
  "terminal material shading must not bind the raw object transform arena");
  assert.ok(scenePass.bind_groups
    .find(({ group }) => group === 2).entries
    .every(({ binding }) => binding !== 2),
  "reflective shading must also consume only the derived Scene Instance transform");
  assert.deepEqual(
    scenePass.bind_groups.find(({ group }) => group === 3).entries
      .map(({ binding, source }) => ({ binding, source })),
    [{ binding: 2, source: "derived_objects" }],
    "lighting must bind the one derived Scene Instance transform arena",
  );
  assert.match(wgsl, /fn vkf_terminal_scene_fragment\(/u);
  assert.match(
    wgsl,
    /const VKF_BACKGROUND_RADIANCE: vec4<f32> = vec4<f32>\(0\.01200000, 0\.01800000, 0\.03200000, 1\.00000000\);/u,
    "terminal reflection color must be the authored background",
  );
  assert.match(
    wgsl,
    /fn vkf_terminal_scene_fragment\([\s\S]*if \(object\.reflectivity >= 0\.999\) \{[\s\S]*return VKF_BACKGROUND_RADIANCE;[\s\S]*return vkf_shade_authored_material/u,
    "a terminal mirror becomes background while a partially reflective floor keeps its authored material",
  );
  assert.match(
    wgsl,
    /fn vkf_light_aperture_position\([\s\S]*let model = derived_objects\[light\.aperture_object_index\]\.value\.model;[\s\S]*return \(model \* vec4<f32>\(local_position, 1\.0\)\)\.xyz;/u,
    "emitter apertures must reuse the Scene Instance transform derived once per frame",
  );
  assert.doesNotMatch(
    wgsl,
    /fn vkf_light_aperture_position\([\s\S]*raw_objects\[object_base/su,
    "lighting must not reconstruct a second transform from raw object fields",
  );
  assert.equal(render.emitter_sources.length, 2);
  assert.deepEqual(
    render.emitter_views.map(({ source_id, reflection_path }) => ({
      source_id,
      reflection_path,
    })),
    [
      { source_id: "red_emitter", reflection_path: ["studio_floor"] },
      { source_id: "red_emitter", reflection_path: ["upright_mirror"] },
      { source_id: "green_emitter", reflection_path: ["studio_floor"] },
      { source_id: "green_emitter", reflection_path: ["upright_mirror"] },
    ],
    "visual reflections and reflected LightViews must consume the same " +
      "canonical direct optical paths",
  );
  assert.equal(
    render.passes.filter(({ kind }) => kind === "shadow_depth").length,
    6,
    "both emitters and their direct floor/mirror views cast shadows",
  );
  assert.match(
    wgsl,
    /let reflected_roughness = clamp\(mirror_material\.roughness, 0\.0, 1\.0\);[\s\S]*let reflected_coherence = \(1\.0 - reflected_roughness\) \*\s*\(1\.0 - reflected_roughness\);[\s\S]*reflected_power \* reflected_coherence/u,
    "rough mirrors must attenuate the coherent caustic instead of projecting a hard full-strength contour",
  );
  assert.match(
    wgsl,
    /let reflected_radius = source\.target_and_radius\.w \+[\s\S]*reflected_roughness \* length\([\s\S]*aperture_center - source\.position_and_range\.xyz[\s\S]*target_and_radius = vec4<f32>\([\s\S]*aperture_center,[\s\S]*reflected_radius/u,
    "rough mirrors must broaden the reflected LightView footprint",
  );
  assert.match(
    wgsl,
    /var strongest_plane_normal = vec3<f32>\(0\.0\);[\s\S]*let candidate_plane_normal = cross\([\s\S]*if \(dot\(candidate_plane_normal, candidate_plane_normal\) >[\s\S]*dot\(strongest_plane_normal, strongest_plane_normal\)\)[\s\S]*strongest_plane_normal = candidate_plane_normal/u,
    "row-major floor vertices must select a non-cancelling transformed plane",
  );
  assert.doesNotMatch(
    wgsl,
    /fn vkf_aperture_normal\(/u,
    "reflection cameras must not replace Geometry truth with stale vertex normals",
  );
  assert.match(
    wgsl,
    /let reflected_view = vkf_look_at\([\s\S]*reflected_eye,[\s\S]*reflected_target,[\s\S]*vec3<f32>\(raw_camera\[6\], raw_camera\[7\], raw_camera\[8\]\)/u,
    "reflected cameras must preserve the authored world-up direction",
  );
  assert.doesNotMatch(
    wgsl,
    /texture_y_orientation|reflected_up/u,
    "reflection sampling must not apply a second orientation transform",
  );
});
