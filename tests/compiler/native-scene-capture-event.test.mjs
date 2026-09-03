import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const nativeBin = process.env.VKF_NATIVE_COMPILER_BIN
  || path.join(repositoryRoot, "build", "041-line", "bin");
const stager = process.env.VKF_NATIVE_SCENE_STAGER
  || path.join(nativeBin, process.platform === "win32"
    ? "vkf_native_scene_artifact_stager.exe"
    : "vkf_native_scene_artifact_stager");
const workRoot = path.join(repositoryRoot, ".w", `041-capture-event-${process.pid}`);

after(() => rm(workRoot, { recursive: true, force: true }));

function executable(name) {
  return path.join(nativeBin, process.platform === "win32" ? `${name}.exe` : name);
}

function run(command, args = [], input) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    input,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || `${command} failed`);
  return result.stdout;
}

function compile(source) {
  const tokens = run(executable("vkf_lexer_cursor_smoke"), [source]);
  const ast = run(executable("vkf_parser_token_stream_smoke"), [], tokens);
  return JSON.parse(run(executable("vkf_ast_to_ir_smoke"), [], ast));
}

const sourceText = [
  ": .ui.display",
  "display: Display(dim:2)",
  "frame: display.add_frame(pos:[0.0, 0.0], size:[1.0, 1.0])",
  "surface: frame.add(x:[[-1, 1], [-1, 1]], y:[[0, 0], [2, 2]],",
  "    z:[[0, 0], [0, 0]], id:\"surface\", color:[0.2, 0.7, 1.0, 1.0])",
  "view: frame.push()",
  'frame.load("ui/main.html")',
  'capture_button: Button(id:"capture-frame")',
  "(event: capture_button.events.get())??>",
  "    ButtonClicked =>",
  "        image: frame.capture()",
  "        write_to_clipboard(image)",
].join("\n");

test("Frame.add scenes retain captured image results for generic clipboard sinks", async () => {
  const typedIr = compile(sourceText);
  const frame = typedIr.body.find(({ kind, name }) => kind === "store_binding" && name === "frame");
  assert.equal(frame.type, "Frame<2>");
  assert.equal(frame.value.kind, "const");
  assert.equal(frame.value.type, "Frame<2>");
  assert.equal(frame.value.value, 0);
  const loop = typedIr.body.find(({ expr }) => expr?.kind === "ui_owner_event_loop").expr;
  assert.deepEqual(loop.arms[0].body.body.map(({ kind }) => kind), [
    "store_binding",
    "expr_stmt",
  ]);
  assert.equal(loop.arms[0].body.body[0].value.kind, "ui_frame_capture");

  const artifact = path.join(workRoot, "artifact");
  const source = path.join(artifact, "app.vkf");
  const typedIrPath = path.join(artifact, "app.typed-ir.json");
  const overlay = path.join(artifact, "vf-ui");
  await Promise.all([
    mkdir(path.join(artifact, "ui"), { recursive: true }),
    cp(path.join(repositoryRoot, "web", "vf-ui"), overlay, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(source, `${sourceText}\n`, "utf8"),
    writeFile(typedIrPath, `${JSON.stringify(typedIr)}\n`, "utf8"),
    writeFile(path.join(artifact, "ui", "main.html"),
      '<button id="capture-frame">Capture</button>\n', "utf8"),
  ]);

  const summary = JSON.parse(run(stager, [
    "--source", source,
    "--overlay-web", overlay,
    "--typed-ir", typedIrPath,
  ]));
  const session = path.dirname(path.join(overlay, ...summary.page_rel.split("/")));
  const [program, mounts] = await Promise.all([
    readFile(path.join(session, "vf-event-program.json"), "utf8").then(JSON.parse),
    readFile(path.join(session, "vf-static-html-loads.json"), "utf8").then(JSON.parse),
  ]);
  assert.deepEqual(program.rules[0].actions, [
    { op: "capture_frame", target: "frame_0", result: "image" },
    { op: "write_clipboard", source: "image", format: "png" },
  ]);
  assert.equal(mounts[0].frame_id, "frame_0");

  const compiledOverlay = path.join(artifact, "compiled-vf-ui");
  await cp(path.join(repositoryRoot, "web", "vf-ui"), compiledOverlay, {
    recursive: true,
  });
  const artifactArgs = ["--source", source, "--typed-ir", typedIrPath];
  const wasm = JSON.parse(run(
    executable("vkf_wasm_artifact_smoke"), artifactArgs,
  ));
  const webGpu = JSON.parse(run(
    executable("vkf_webgpu_artifact_smoke"), artifactArgs,
  ));
  const compiledSummary = JSON.parse(run(stager, [
    "--source", source,
    "--overlay-web", compiledOverlay,
    "--typed-ir", typedIrPath,
    "--wasm-artifact", wasm.artifact_path,
    "--wasm-manifest", wasm.manifest_path,
    "--webgpu-artifact", webGpu.artifact_path,
    "--webgpu-manifest", webGpu.manifest_path,
  ]));
  const compiledSession = path.dirname(path.join(
    compiledOverlay,
    ...compiledSummary.page_rel.split("/"),
  ));
  const compiledPage = await readFile(
    path.join(compiledSession, "vkf-scene.html"),
    "utf8",
  );
  assert.match(compiledPage, /data-vf-static-html-loads="vf-static-html-loads\.json"/u);
  assert.match(compiledPage, /vf-runtime-packet-contract\.js/u);
  assert.match(compiledPage, /vf-retained-event-adapter\.js/u);
  assert.match(compiledPage, /vf-static-html-loader\.js/u);
  assert.deepEqual(
    JSON.parse(await readFile(
      path.join(compiledSession, "vf-event-program.json"),
      "utf8",
    )).rules[0].actions,
    program.rules[0].actions,
    "the compiled package must preserve Frame.capture and its image binding",
  );
});
