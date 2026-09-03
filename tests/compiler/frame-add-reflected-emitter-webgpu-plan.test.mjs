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
  `frame-add-reflected-emitter-webgpu-plan-${process.pid}`,
);

after(() => rm(workRoot, { recursive: true, force: true }));

function compilerTool(name) {
  assert.ok(
    nativeBin,
    "VKF_NATIVE_COMPILER_BIN must name the focused native build directory",
  );
  return path.join(
    nativeBin,
    process.platform === "win32" ? `${name}.exe` : name,
  );
}

function run(name, args = [], input) {
  const result = spawnSync(compilerTool(name), args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    input,
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    result.stderr || `${name} failed without diagnostics`,
  );
  return result.stdout;
}

test("Frame mirrors derive two-bounce views of one geometry emitter", async () => {
  await mkdir(workRoot, { recursive: true });
  const sourceText = [
    ": .ui.display",
    "display: Display(dim:2)",
    "frame: display.add_frame(pos:[0.08, 0.08], size:[0.84, 0.84])",
    "frame.add_camera(pos:[4, -6, 4], target:[0, 0, 1])",
    "emitter: frame.add(x:[[-1, 1], [-1, 1]], y:[[-1, -1], [1, 1]], z:[[3, 3], [3, 3]], id:\"emitter\", color:[0.2, 0.2, 0.2, 1], emission:(wavelength:[460, 550, 610], radiance:[0.2, 0.4, 0.8]))",
    "receiver: frame.add(x:[[-2, 2], [-2, 2]], y:[[-2, -2], [2, 2]], z:[[0, 0], [0, 0]], id:\"receiver\", color:[0.8, 0.8, 0.8, 1])",
    "mirror_a: frame.add(x:[[-2, 2], [-2, 2]], y:[[0, 0], [0, 0]], z:[[0, 0], [3, 3]], id:\"mirror_a\", color:[0.2, 0.2, 0.2, 1], reflectivity:1.0)",
    "mirror_b: frame.add(x:[[0, 0], [0, 0]], y:[[-2, 2], [-2, 2]], z:[[0, 0], [3, 3]], id:\"mirror_b\", color:[0.2, 0.2, 0.2, 1], reflectivity:0.81)",
    "view: frame.push()",
  ].join("\n");
  assert.doesNotMatch(
    sourceText,
    /native_scene|add_light|kind:\s*"projected"/u,
  );

  const source = path.join(workRoot, "reflected-emitter.vkf");
  const typedIrPath = path.join(
    workRoot,
    "reflected-emitter.typed-ir.json",
  );
  await writeFile(source, `${sourceText}\n`, "utf8");
  const tokens = run("vkf_lexer_cursor_smoke", [sourceText]);
  const ast = run("vkf_parser_token_stream_smoke", [], tokens);
  await writeFile(typedIrPath, run("vkf_ast_to_ir_smoke", [], ast), "utf8");

  const summary = JSON.parse(run("vkf_webgpu_artifact_smoke", [
    "--source", source,
    "--typed-ir", typedIrPath,
  ]));
  const [wgsl, manifest] = await Promise.all([
    readFile(summary.artifact_path, "utf8"),
    readFile(summary.manifest_path, "utf8").then(JSON.parse),
  ]);

  const renderPlan = manifest.runtime_surface.render_plan;
  assert.equal(renderPlan.max_reflection_depth, 2);
  assert.equal(renderPlan.light_count, 5);
  assert.deepEqual(renderPlan.emitter_sources.map(({ id }) => id), [
    "emitter",
  ]);
  assert.deepEqual(renderPlan.emitter_views, [
    {
      id: "emitter@mirror_a",
      light_index: 1,
      source_id: "emitter",
      source_light_index: 0,
      source_object_index: 0,
      source_layer_id: 0,
      reflect_surface_id: "mirror_a",
      reflect_surface_object_index: 2,
      reflection_depth: 1,
      reflection_path: ["mirror_a"],
      kind_code: 2,
      casts_shadow: true,
      shadow_view_count: 1,
    },
    {
      id: "emitter@mirror_b",
      light_index: 2,
      source_id: "emitter",
      source_light_index: 0,
      source_object_index: 0,
      source_layer_id: 0,
      reflect_surface_id: "mirror_b",
      reflect_surface_object_index: 3,
      reflection_depth: 1,
      reflection_path: ["mirror_b"],
      kind_code: 2,
      casts_shadow: true,
      shadow_view_count: 1,
    },
    {
      id: "emitter@mirror_a>mirror_b",
      light_index: 3,
      source_id: "emitter",
      source_light_index: 1,
      source_object_index: 0,
      source_layer_id: 0,
      reflect_surface_id: "mirror_b",
      reflect_surface_object_index: 3,
      reflection_depth: 2,
      reflection_path: ["mirror_a", "mirror_b"],
      kind_code: 2,
      casts_shadow: true,
      shadow_view_count: 1,
    },
    {
      id: "emitter@mirror_b>mirror_a",
      light_index: 4,
      source_id: "emitter",
      source_light_index: 2,
      source_object_index: 0,
      source_layer_id: 0,
      reflect_surface_id: "mirror_a",
      reflect_surface_object_index: 2,
      reflection_depth: 2,
      reflection_path: ["mirror_b", "mirror_a"],
      kind_code: 2,
      casts_shadow: true,
      shadow_view_count: 1,
    },
  ]);

  const reflectionPasses = renderPlan.passes.filter(
    ({ kind }) => kind === "prepare_reflection_camera",
  );
  assert.deepEqual(
    reflectionPasses.map((pass) => ({
      path: pass.reflection_path,
      depth: pass.reflection_depth,
      object_index: pass.object_index,
      aperture_object_index: pass.pass_state.object_index,
      aperture_vertex_count: pass.aperture.vertex_count,
      aperture_byte_offset: pass.aperture.byte_offset,
    })),
    [
      { path: ["mirror_a"], depth: 1, object_index: 2,
        aperture_object_index: 2, aperture_vertex_count: 4,
        aperture_byte_offset: 368 },
      { path: ["mirror_b"], depth: 1, object_index: 3,
        aperture_object_index: 3, aperture_vertex_count: 4,
        aperture_byte_offset: 552 },
      { path: ["mirror_a", "mirror_b"], depth: 2, object_index: 3,
        aperture_object_index: 3, aperture_vertex_count: 4,
        aperture_byte_offset: 552 },
      { path: ["mirror_b", "mirror_a"], depth: 2, object_index: 2,
        aperture_object_index: 2, aperture_vertex_count: 4,
        aperture_byte_offset: 368 },
    ],
  );
  assert.match(wgsl, /let reflected_light_position = vkf_reflect_point\(/u);
  assert.match(wgsl, /let projected_near_plane = vkf_aperture_near_plane\(/u);
  assert.match(wgsl, /var projected_projection = vkf_off_axis_projection\(/u);
  assert.match(
    wgsl,
    /projected_projection = vkf_flip_clip_x\(\) \* projected_projection/u,
  );
});
