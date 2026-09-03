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
  `frame-add-webgpu-plan-${process.pid}`,
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

test("Frame add and push emit a specialized WebGPU scene without native_scene", async () => {
  await mkdir(workRoot, { recursive: true });
  const sourceText = [
    ": .ui.display",
    "display: Display(dim:2)",
    "frame: display.add_frame(pos:[0.08, 0.08], size:[0.84, 0.84])",
    "frame.add_camera(pos:[3.5, -5.0, 3.0], target:[0, 0, 0])",
    "u: [..32] / 16 - 1",
    "surface: frame.add(x:[u, u], y:[u * 0, u * 0 + 1], z:[u * 0, u * 0], id:\"surface\", color:[0.2, 0.7, 1, 1])",
    "view: frame.push()",
  ].join("\n");
  assert.doesNotMatch(sourceText, /native_scene/u);

  const source = path.join(workRoot, "surface.vkf");
  const typedIrPath = path.join(workRoot, "surface.typed-ir.json");
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

  assert.equal(manifest.runtime_surface.update_mode, "retained_scene_render");
  const renderPlan = manifest.runtime_surface.render_plan;
  assert.ok(renderPlan);
  assert.equal(
    renderPlan.derived_buffers.find(({ id }) => id === "derived_objects")
      .byte_size,
    256,
  );
  assert.match(wgsl, /@vertex\s+fn vkf_scene_vertex/u);
  assert.doesNotMatch(wgsl, /vkf_dom_only/u);
  assert.match(
    wgsl,
    /@group\(0\) @binding\([45]\)/u,
    "the retained shader ABI keeps stable planar-reflection fallback slots",
  );
  const sceneColor = renderPlan.passes.find(({ kind }) => kind === "scene_color");
  assert.ok(sceneColor, "Frame.add must retain the final scene color pass");
  const sceneColorGroup0 = sceneColor.bind_groups.find(
    ({ group }) => group === 0,
  );
  assert.ok(sceneColorGroup0, "scene_color must bind its scene resources");
  assert.deepEqual(
    sceneColorGroup0.entries
      .map(({ binding }) => binding)
      .filter((binding) => binding === 4 || binding === 5),
    [4, 5],
    "the no-mirror render plan must bind its shader-declared fallback slots",
  );
  assert.deepEqual(sceneColor.reflection_sources, []);
  assert.equal(sceneColor.pipeline, "retained_scene_hdr_msaa");
  assert.equal(sceneColor.color.target, "scene_hdr_msaa");
  assert.equal(sceneColor.color.resolve_target, "scene_hdr");
  const scenePresent = renderPlan.passes.find(
    ({ kind }) => kind === "scene_present",
  );
  assert.ok(scenePresent, "the linear HDR scene must have one composite pass");
  assert.equal(scenePresent.pipeline, "retained_scene_present");
  assert.equal(scenePresent.vertex_count, 3);
  assert.equal(scenePresent.color.target, "swap_chain");
  assert.equal(
    renderPlan.passes.filter(({ draw_list_id }) =>
      draw_list_id === "scene_visible").length,
    1,
    "HDR presentation must shade the retained scene exactly once",
  );
});
