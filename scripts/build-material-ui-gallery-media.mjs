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

function executable(name) {
  return path.join(nativeBin, process.platform === "win32" ? `${name}.exe` : name);
}

function run(command, args = [], input, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    input,
    env,
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(result.stderr || `${command} failed`);
  return result.stdout;
}

const galleryRoot = path.join(repositoryRoot, "examples", "material_ui_gallery");
const workRoot = path.join(repositoryRoot, ".w", "g01n-gallery-media");
const artifactRoot = path.join(workRoot, "artifact");
const captureRoot = path.join(workRoot, "captures");
const overlayWeb = path.join(artifactRoot, "vf-ui");
const mediaRoot = path.join(repositoryRoot, "docs", "public", "images", "readme-ui");
await rm(workRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
await cp(galleryRoot, artifactRoot, { recursive: true });
await Promise.all([
  cp(path.join(repositoryRoot, "web", "vf-ui"), overlayWeb, { recursive: true }),
  mkdir(captureRoot, { recursive: true }),
  mkdir(mediaRoot, { recursive: true }),
]);

const sourcePath = path.join(artifactRoot, "app.vkf");
const sourceText = await readFile(sourcePath, "utf8");
const tokens = run(executable("vkf_lexer_cursor_smoke"), [sourceText]);
const ast = run(executable("vkf_parser_token_stream_smoke"), [], tokens);
const typedIr = run(executable("vkf_ast_to_ir_smoke"), [], ast);
const typedIrPath = path.join(artifactRoot, "app.typed-ir.json");
await writeFile(typedIrPath, typedIr, "utf8");
const summary = JSON.parse(run(nativeSceneStager, [
  "--source", sourcePath,
  "--overlay-web", overlayWeb,
  "--typed-ir", typedIrPath,
]));
const scenePath = path.join(overlayWeb, ...summary.page_rel.split("/"));
const captureSummary = JSON.parse(run(
  process.execPath,
  [path.join(repositoryRoot, "tests", "helpers", "capture_material_ui_gallery.js"), scenePath, captureRoot],
  undefined,
  { ...process.env, VF_CAPTURE_OFFSCREEN_GPU: "0" },
));

const stillDestination = path.join(mediaRoot, "material-ui-gallery.png");
const gifDestination = path.join(mediaRoot, "material-ui-gallery.gif");
await cp(path.join(captureRoot, captureSummary.still), stillDestination);
run("python", [
  path.join(repositoryRoot, "tools", "build_material_ui_gallery_gif.py"),
  captureRoot,
  gifDestination,
]);
const sourcePaths = [
  "examples/material_ui_gallery/app.vkf",
  "examples/material_ui_gallery/ui/main.html",
  "examples/material_ui_gallery/ui/gallery.css",
  "compiler/native/vkf_retained_scene_packet.hpp",
  "compiler/native/vkf_native_scene_artifact_stager.cpp",
  "web/vf-ui/vf-runtime-packet-contract.js",
  "web/vf-ui/vf-retained-event-adapter.js",
  "web/vf-ui/vf-static-html-loader.js",
  "tests/helpers/capture_material_ui_gallery.js",
  "tools/build_material_ui_gallery_gif.py",
  "scripts/build-material-ui-gallery-media.mjs",
];
const mediaPaths = [
  "docs/public/images/readme-ui/material-ui-gallery.png",
  "docs/public/images/readme-ui/material-ui-gallery.gif",
];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sources = {};
for (const relativePath of sourcePaths) {
  const bytes = await readFile(path.join(repositoryRoot, relativePath));
  sources[relativePath] = sha256(Buffer.from(bytes.toString("utf8").replaceAll("\r\n", "\n")));
}
const media = {};
for (const relativePath of mediaPaths) {
  const bytes = await readFile(path.join(repositoryRoot, relativePath));
  const gif = relativePath.endsWith(".gif");
  media[relativePath] = {
    sha256: sha256(bytes),
    width: gif ? bytes.readUInt16LE(6) : bytes.readUInt32BE(16),
    height: gif ? bytes.readUInt16LE(8) : bytes.readUInt32BE(20),
    ...(gif ? { frames: captureSummary.states.length, loop: true } : {}),
  };
}
await writeFile(
  path.join(mediaRoot, "material-ui-gallery.manifest.json"),
  `${JSON.stringify({
    schema: "vkf-media-freshness/1",
    capture: {
      api: "VfDisplay.__test.captureGeomFrameDataUrl",
      composite_api: "Page.captureScreenshot",
      execution: "headless Edge WebGPU",
      fixture: "examples/material_ui_gallery/app.vkf",
      frame_id: captureSummary.frameId,
      interactions: ["view-lighting", "view-mirror", "view-glass", "view-all", "glass-alpha=0.72"],
    },
    sources,
    media,
  }, null, 2)}\n`,
  "utf8",
);
process.stdout.write(JSON.stringify({
  ...captureSummary,
  still: path.relative(repositoryRoot, stillDestination).replaceAll(path.sep, "/"),
  animation: path.relative(repositoryRoot, gifDestination).replaceAll(path.sep, "/"),
}));
