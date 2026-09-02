import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nativeBin = process.env.VKF_NATIVE_COMPILER_BIN;
const nativeSceneStager = process.env.VKF_NATIVE_SCENE_STAGER;
if (!nativeBin || !nativeSceneStager) {
  throw new Error("VKF_NATIVE_COMPILER_BIN and VKF_NATIVE_SCENE_STAGER are required");
}

function executable(name, directory = nativeBin) {
  return path.join(directory, process.platform === "win32" ? `${name}.exe` : name);
}

function run(command, args = [], input, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    input,
    env,
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} failed`);
  }
  return result.stdout;
}

const galleryRoot = path.join(repositoryRoot, "examples", "material_ui_gallery");
const workRoot = path.join(repositoryRoot, ".w", "g01n-gallery-media-native");
const artifactRoot = path.join(workRoot, "artifact");
const captureRoot = path.join(workRoot, "captures");
const frameRoot = path.join(captureRoot, "frames");
const mediaRoot = path.join(repositoryRoot, "docs", "public", "images", "readme-ui");
const captureEvidencePath = path.join(captureRoot, "native-frame-capture.json");
const compiledApplication = path.join(artifactRoot, "material-ui-gallery-capture.exe");
await rm(workRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
await cp(galleryRoot, artifactRoot, { recursive: true });
await Promise.all([
  mkdir(frameRoot, { recursive: true }),
  mkdir(mediaRoot, { recursive: true }),
]);

const sourcePath = path.join(artifactRoot, "app.vkf");
const sourceText = await readFile(sourcePath, "utf8");
const tokens = run(executable("vkf_lexer_cursor_smoke"), [sourceText]);
const ast = run(executable("vkf_parser_token_stream_smoke"), [], tokens);
const typedIr = run(executable("vkf_ast_to_ir_smoke"), [], ast);
const typedIrPath = path.join(artifactRoot, "app.typed-ir.json");
await writeFile(typedIrPath, typedIr, "utf8");
const artifactArgs = ["--source", sourcePath, "--typed-ir", typedIrPath];
const wasm = JSON.parse(run(executable("vkf_wasm_artifact_smoke"), artifactArgs));
const webgpu = JSON.parse(run(executable("vkf_webgpu_artifact_smoke"), artifactArgs));
const packageBin = process.env.VKF_NATIVE_UI_PACKAGE || executable(
  "vkf-ui-package",
  path.dirname(nativeSceneStager),
);
run(packageBin, [
  "--package",
  "--source", sourcePath,
  "--typed-ir", typedIrPath,
  "--output", compiledApplication,
  "--wasm-artifact", wasm.artifact_path,
  "--wasm-manifest", wasm.manifest_path,
  "--webgpu-artifact", webgpu.artifact_path,
  "--webgpu-manifest", webgpu.manifest_path,
], undefined, {
  ...process.env,
  VKF_NATIVE_FRAME_CAPTURE_PATH: captureEvidencePath,
});

const captureSummary = JSON.parse(run(process.execPath, [
  path.join(repositoryRoot, "tests", "helpers", "capture_material_ui_gallery.js"),
  captureEvidencePath,
]));
const encodingSummary = JSON.parse(run("python", [
  path.join(repositoryRoot, "tools", "encode_native_frame_capture.py"),
  captureEvidencePath,
  frameRoot,
]));

const stillDestination = path.join(mediaRoot, "material-ui-gallery.png");
const webpDestination = path.join(mediaRoot, "material-ui-gallery.webp");
await cp(path.join(frameRoot, encodingSummary.still), stillDestination);
run("python", [
  path.join(repositoryRoot, "tools", "build_material_ui_gallery_webp.py"),
  frameRoot,
  webpDestination,
]);

const sourcePaths = [
  "examples/material_ui_gallery/app.vkf",
  "examples/material_ui_gallery/assets/source/ASSET_SOURCE.md",
  "examples/material_ui_gallery/assets/source/bun_zipper.ply",
  "compiler/native/vkf_retained_scene_packet.hpp",
  "compiler/native/vkf_native_scene_artifact_stager.cpp",
  "compiler/native/vkf_wasm_artifact_smoke.cpp",
  "compiler/native/vkf_webgpu_artifact_smoke.cpp",
  "native/VfOverlay/vf/release_overlay_host.cpp",
  "web/vf-ui/vf-compiled-webgpu-adapter.js",
  "web/vf-ui/vf-retained-event-adapter.js",
  "tests/helpers/capture_material_ui_gallery.js",
  "tools/encode_native_frame_capture.py",
  "tools/build_material_ui_gallery_webp.py",
  "scripts/build-material-ui-gallery-media.mjs",
];
const mediaPaths = [
  "docs/public/images/readme-ui/material-ui-gallery.png",
  "docs/public/images/readme-ui/material-ui-gallery.webp",
];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sources = {};
for (const relativePath of sourcePaths) {
  const bytes = await readFile(path.join(repositoryRoot, relativePath));
  sources[relativePath] = sha256(Buffer.from(
    bytes.toString("utf8").replaceAll("\r\n", "\n"),
  ));
}
const media = {};
for (const relativePath of mediaPaths) {
  const bytes = await readFile(path.join(repositoryRoot, relativePath));
  const webpMedia = relativePath.endsWith(".webp");
  media[relativePath] = {
    sha256: sha256(bytes),
    width: webpMedia ? bytes.readUIntLE(24, 3) + 1 : bytes.readUInt32BE(16),
    height: webpMedia ? bytes.readUIntLE(27, 3) + 1 : bytes.readUInt32BE(20),
    ...(webpMedia ? { frames: 2, loop: true, lossless: true } : {}),
  };
}

await writeFile(
  path.join(mediaRoot, "material-ui-gallery.manifest.json"),
  `${JSON.stringify({
    schema: "vkf-media-freshness/1",
    capture: {
      api: captureSummary.capture_api,
      execution: "native hidden WebView2/WebGPU host",
      boundary: captureSummary.boundary,
      fixture: "examples/material_ui_gallery/app.vkf",
      frame_id: "material_gallery_frame",
      interactions: captureSummary.states.map(({ view }) => view),
      states: captureSummary.states.map((state) => ({
        view: state.view,
        width: state.width,
        height: state.height,
        checksum: state.checksum,
        pixel_sha256: sha256(Buffer.from(state.rgba_base64, "base64")),
      })),
    },
    sources,
    media,
  }, null, 2)}\n`,
  "utf8",
);

process.stdout.write(JSON.stringify({
  captureApi: captureSummary.capture_api,
  execution: "native hidden WebView2/WebGPU host",
  boundary: captureSummary.boundary,
  states: encodingSummary.states,
  still: path.relative(repositoryRoot, stillDestination).replaceAll(path.sep, "/"),
  animation: path.relative(repositoryRoot, webpDestination).replaceAll(path.sep, "/"),
}));
