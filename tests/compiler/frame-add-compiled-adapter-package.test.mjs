import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const nativeBin = process.env.VKF_NATIVE_COMPILER_BIN;
const nativeSceneStager = process.env.VKF_NATIVE_SCENE_STAGER;
const workRoot = path.join(repositoryRoot, ".w", `frame-add-compiled-${process.pid}`);

after(() => rm(workRoot, { recursive: true, force: true }));

function compilerTool(name) {
  assert.ok(nativeBin, "VKF_NATIVE_COMPILER_BIN must name the focused native build directory");
  return path.join(nativeBin, process.platform === "win32" ? `${name}.exe` : name);
}

function run(executable, args = [], input) {
  const result = spawnSync(executable, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    input,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || `${executable} failed without diagnostics`);
  return result.stdout;
}

function compile(sourceText) {
  const tokens = run(compilerTool("vkf_lexer_cursor_smoke"), [sourceText]);
  const ast = run(compilerTool("vkf_parser_token_stream_smoke"), [], tokens);
  return JSON.parse(run(compilerTool("vkf_ast_to_ir_smoke"), [], ast));
}

test("canonical Frame.add package selects the compiled retained-scene adapter", async () => {
  assert.ok(nativeSceneStager, "VKF_NATIVE_SCENE_STAGER must name the focused stager executable");
  const sourceText = [
    ": .ui.display",
    "display: Display(dim:2)",
    "frame: display.add_frame(pos:[0.08, 0.08], size:[0.84, 0.84])",
    "surface: frame.add(x:[[-1, 1], [-1, 1]], y:[[0, 0], [2, 2]], z:[[0, 0], [0, 0]], id:\"surface\", color:[0.2, 0.7, 1.0, 1.0])",
  ].join("\n");
  const root = path.join(workRoot, "package");
  const sourcePath = path.join(root, "app.vkf");
  const typedIrPath = path.join(root, "app.typed-ir.json");
  const overlayWeb = path.join(root, "vf-ui");
  await mkdir(root, { recursive: true });
  await writeFile(sourcePath, `${sourceText}\n`, "utf8");
  const typedIr = compile(sourceText);
  await Promise.all([
    writeFile(typedIrPath, `${JSON.stringify(typedIr)}\n`, "utf8"),
    cp(path.join(repositoryRoot, "web", "vf-ui"), overlayWeb, { recursive: true }),
  ]);

  const wasm = JSON.parse(run(compilerTool("vkf_wasm_artifact_smoke"), [
    "--source", sourcePath,
    "--typed-ir", typedIrPath,
  ]));
  const webgpu = JSON.parse(run(compilerTool("vkf_webgpu_artifact_smoke"), [
    "--source", sourcePath,
    "--typed-ir", typedIrPath,
  ]));
  const manifest = JSON.parse(await readFile(wasm.manifest_path, "utf8"));
  assert.ok(manifest.runtime_surface.retained_scene_arena);
  assert.ok(manifest.runtime_surface.render_parameter_arena);

  const staged = JSON.parse(run(nativeSceneStager, [
    "--source", sourcePath,
    "--overlay-web", overlayWeb,
    "--typed-ir", typedIrPath,
    "--wasm-artifact", wasm.artifact_path,
    "--wasm-manifest", wasm.manifest_path,
    "--webgpu-artifact", webgpu.artifact_path,
    "--webgpu-manifest", webgpu.manifest_path,
  ]));
  const pagePath = path.join(overlayWeb, ...staged.page_rel.split("/"));
  const sessionDirectory = path.dirname(pagePath);
  const page = await readFile(pagePath, "utf8");
  assert.match(page, /data-vf-runtime-shell="compiled-scene"/u);
  assert.match(page, /compiledScriptDeps/u);
  assert.doesNotMatch(page, /vf-runtime-source\.js/u);
  const launch = JSON.parse(await readFile(
    path.join(sessionDirectory, "vf-launch-manifest.json"),
    "utf8",
  ));
  assert.deepEqual(launch.frames.map(({ id }) => id), ["frame_0"]);
  assert.equal(
    (await readdir(sessionDirectory)).some((name) =>
      /^vf-native-scene-configs-.*\.json$/u.test(name)),
    false,
  );
  assert.doesNotMatch(page, /__vfCompiledSceneConfigsUrl/u);
  assert.match(page, /scene_ir:Object\.assign\(\{\},retained/u);
});
