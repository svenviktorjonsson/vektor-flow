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

test("material gallery keeps floor and mirror reflections direct", async () => {
  await mkdir(workRoot, { recursive: true });
  const sourcePath = path.join(
    repositoryRoot,
    "examples",
    "material_ui_gallery",
    "app.vkf",
  );
  const source = await readFile(sourcePath, "utf8");
  const tokens = stage("vkf_lexer_cursor_smoke", undefined, [source]);
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
    [["studio_floor"], ["upright_mirror"]],
  );
  assert.ok(reflectionPasses.every(({ reflection_sources }) =>
    reflection_sources.every(({ target }) =>
      target === "transparent_reflection_fallback"
    )
  ));
  assert.ok(render.targets.every(({ id }) =>
    !id.includes("studio_floor__upright_mirror") &&
    !id.includes("upright_mirror__studio_floor")
  ));
  assert.equal(render.emitter_sources.length, 2);
  assert.equal(render.emitter_views.length, 8);
  assert.equal(
    render.passes.filter(({ kind }) => kind === "shadow_depth").length,
    5,
  );
});
