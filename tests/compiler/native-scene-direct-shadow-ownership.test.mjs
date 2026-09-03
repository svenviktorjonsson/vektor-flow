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
  `direct-shadow-ownership-${process.pid}`,
);

after(() => rm(workRoot, { recursive: true, force: true }));

function tool(name) {
  assert.ok(
    nativeBin,
    "VKF_NATIVE_COMPILER_BIN must name the focused native build directory",
  );
  return path.join(nativeBin, process.platform === "win32" ? `${name}.exe` : name);
}

function stage(name, input, args = []) {
  const result = spawnSync(tool(name), args, {
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

test("geometry emitter owns direct and mirror-reflected shadow views", async () => {
  await mkdir(workRoot, { recursive: true });
  const source = path.join(workRoot, "direct-shadow.vkf");
  const sourceText = [
    ": .ui.display",
    "display: Display(dim:2)",
    "frame: display.add_frame(pos:[0.08, 0.08], size:[0.84, 0.84])",
    "frame.add_camera(pos:[4, -6, 4], target:[0, 3, 1])",
    "floor: frame.add(x:[[-4, 4], [-4, 4]], y:[[-4, -4], [10, 10]], z:[[0, 0], [0, 0]], id:\"floor\", color:[0.8, 0.8, 0.8, 1], casts_shadow:false, receives_shadow:true)",
    "mirror: frame.add(x:[[-3, 3], [-3, 3]], y:[[3, 3], [3, 3]], z:[[0, 0], [3.5, 3.5]], id:\"mirror\", color:[0.34, 0.34, 0.34, 1], reflectivity:1.0, casts_shadow:true)",
    "sun: frame.add(x:[[-4.1, -3.9], [-4.1, -3.9]], y:[[-0.1, -0.1], [0.1, 0.1]], z:[[5, 5], [5, 5]], id:\"sun\", color:[1, 1, 1, 1], emission:[1, 1, 1], casts_shadow:true)",
    "view: frame.push()",
    "",
  ].join("\n");
  assert.doesNotMatch(
    sourceText,
    /native_scene|add_light|kind:\s*"projected"/u,
  );
  await writeFile(source, sourceText, "utf8");

  const tokens = stage("vkf_lexer_cursor_smoke", undefined, [sourceText]);
  const ast = stage("vkf_parser_token_stream_smoke", tokens);
  const typedIr = stage("vkf_ast_to_ir_smoke", ast);
  const typedIrPath = path.join(workRoot, "direct-shadow.typed-ir.json");
  await writeFile(typedIrPath, typedIr, "utf8");
  const summary = JSON.parse(stage("vkf_webgpu_artifact_smoke", undefined, [
    "--source",
    source,
    "--typed-ir",
    typedIrPath,
  ]));
  const [wgsl, manifest] = await Promise.all([
    readFile(summary.artifact_path, "utf8"),
    readFile(summary.manifest_path, "utf8").then(JSON.parse),
  ]);

  const shadowPasses = manifest.runtime_surface.render_plan.passes
    .filter(({ kind }) => kind === "shadow_depth");
  assert.deepEqual(
    manifest.runtime_surface.render_plan.emitter_views.map((view) => ({
      id: view.id,
      source_id: view.source_id,
      source_light_index: view.source_light_index,
      reflect_surface_id: view.reflect_surface_id,
      reflect_surface_object_index: view.reflect_surface_object_index,
    })),
    [{
      id: "sun@mirror",
      source_id: "sun",
      source_light_index: 0,
      reflect_surface_id: "mirror",
      reflect_surface_object_index: 1,
    }],
  );
  const directPasses = shadowPasses.filter(({ light_id }) => light_id === "sun");
  assert.equal(directPasses.length, 1);
  assert.ok(directPasses.every(({ draw_list_id }) =>
    draw_list_id === "shadow_casters"
  ));
  assert.deepEqual(directPasses[0].shadow_view, {
    coverage: "fitted_scene",
    projection: "perspective",
  });
  assert.deepEqual(
    shadowPasses.filter(({ light_id }) => light_id === "sun@mirror")
      .map(({ light_id, draw_list_id }) => ({ light_id, draw_list_id })),
    [{ light_id: "sun@mirror", draw_list_id: "shadow_casters" }],
  );
  assert.match(wgsl, /fn vkf_fit_direct_shadow_view_projection\(/);
  assert.match(
    wgsl,
    /VKF_DIRECT_SHADOW_BOUNDS_MIN: vec3<f32> = vec3<f32>\(-4\.09999990, -4\.00000000, 0\.00000000\)/,
  );
  assert.match(
    wgsl,
    /VKF_DIRECT_SHADOW_BOUNDS_MAX: vec3<f32> = vec3<f32>\(4\.00000000, 10\.00000000, 5\.00000000\)/,
  );
  assert.doesNotMatch(
    wgsl,
    /vkf_perspective\(1\.5707963267948966, 1\.0, near_plane, far_plane\)/,
    "a fixed square 90-degree light camera can truncate the receiver",
  );
  assert.match(
    wgsl,
    /vkf_fit_direct_shadow_view_projection\(\s*derived_lights\[light_index\]/,
    "direct shadows fit the receiver/caster scene instead of using a fixed aperture",
  );
});
