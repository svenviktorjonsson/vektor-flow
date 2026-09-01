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
const summary = JSON.parse(run(nativeSceneStager, [
  "--source", sourcePath,
  "--overlay-web", overlayWeb,
]));
const scenePath = path.join(overlayWeb, ...summary.page_rel.split("/"));
const captureSummary = JSON.parse(run(
  process.execPath,
  [path.join(repositoryRoot, "tests", "helpers", "capture_material_ui_gallery.js"), scenePath, captureRoot],
  undefined,
  { ...process.env, VF_CAPTURE_OFFSCREEN_GPU: "0" },
));

const stillDestination = path.join(mediaRoot, "material-ui-gallery.png");
const webpDestination = path.join(mediaRoot, "material-ui-gallery.webp");
const rendererWebpDestination = path.join(mediaRoot, "material-ui-gallery-renderer.webp");
const overlayStillDestination = path.join(mediaRoot, "ui-transparent-overlay-offscreen.png");
const overlayRendererStillDestination = path.join(
  mediaRoot, "ui-transparent-overlay-offscreen-renderer.png",
);
const overlayGifDestination = path.join(mediaRoot, "ui-transparent-overlay-offscreen.gif");
const overlayRendererGifDestination = path.join(
  mediaRoot, "ui-transparent-overlay-offscreen-renderer.gif",
);
const finalState = captureSummary.states.at(-1);
await Promise.all([
  cp(path.join(captureRoot, captureSummary.still), stillDestination),
  cp(path.join(captureRoot, finalState.compositeFile), overlayStillDestination),
  cp(path.join(captureRoot, finalState.rendererFile), overlayRendererStillDestination),
]);
run("python", [
  path.join(repositoryRoot, "tools", "build_material_ui_gallery_webp.py"),
  path.join(captureRoot, "composite"),
  webpDestination,
]);
run("python", [
  path.join(repositoryRoot, "tools", "build_material_ui_gallery_webp.py"),
  path.join(captureRoot, "renderer"),
  rendererWebpDestination,
]);
run("python", [
  path.join(repositoryRoot, "tools", "build_material_ui_gallery_gif.py"),
  path.join(captureRoot, "composite"),
  overlayGifDestination,
]);
run("python", [
  path.join(repositoryRoot, "tools", "build_material_ui_gallery_gif.py"),
  path.join(captureRoot, "renderer"),
  overlayRendererGifDestination,
]);
const sourcePaths = [
  "examples/material_ui_gallery/app.vkf",
  "examples/material_ui_gallery/assets/source/ASSET_SOURCE.md",
  "examples/material_ui_gallery/assets/source/bun_zipper.ply",
  "compiler/native/vkf_retained_scene_packet.hpp",
  "compiler/native/vkf_native_scene_artifact_stager.cpp",
  "web/vf-ui/vf-runtime-packet-contract.js",
  "web/vf-ui/vf-retained-event-adapter.js",
  "web/vf-ui/vf-static-html-loader.js",
  "web/vf-ui/vf-display.js",
  "web/vf-ui/geom/vf-geom-wgpu.js",
  "tests/helpers/capture_material_ui_gallery.js",
  "tools/build_material_ui_gallery_gif.py",
  "tools/build_material_ui_gallery_webp.py",
  "scripts/build-material-ui-gallery-media.mjs",
];
const mediaPaths = [
  "docs/public/images/readme-ui/material-ui-gallery.png",
  "docs/public/images/readme-ui/material-ui-gallery.webp",
  "docs/public/images/readme-ui/material-ui-gallery-renderer.webp",
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
  const webp = relativePath.endsWith(".webp");
  const animated = gif || webp;
  media[relativePath] = {
    sha256: sha256(bytes),
    width: webp ? bytes.readUIntLE(24, 3) + 1 : gif ? bytes.readUInt16LE(6) : bytes.readUInt32BE(16),
    height: webp ? bytes.readUIntLE(27, 3) + 1 : gif ? bytes.readUInt16LE(8) : bytes.readUInt32BE(20),
    ...(animated ? { frames: captureSummary.states.length, loop: true, ...(webp ? { lossless: true } : {}) } : {}),
  };
}
const overlayMediaPaths = [
  "docs/public/images/readme-ui/ui-transparent-overlay-offscreen.png",
  "docs/public/images/readme-ui/ui-transparent-overlay-offscreen-renderer.png",
  "docs/public/images/readme-ui/ui-transparent-overlay-offscreen.gif",
  "docs/public/images/readme-ui/ui-transparent-overlay-offscreen-renderer.gif",
];
const overlayMedia = {};
for (const relativePath of overlayMediaPaths) {
  const bytes = await readFile(path.join(repositoryRoot, relativePath));
  const gif = relativePath.endsWith(".gif");
  overlayMedia[relativePath] = {
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
      interactions: ["camera-default", "camera-wheel-detail"],
      surface_textures: captureSummary.surfaceTextures,
      surface_captures: captureSummary.surfaceCaptures,
      composite_states: captureSummary.states.map((state) => ({
        view: state.view,
        sha256: state.compositeSha256,
        static_html: state.staticHtml,
        frame_chrome: state.frameChrome,
        webgpu_canvas: state.webgpuCanvas,
      })),
    },
    sources,
    media,
  }, null, 2)}\n`,
  "utf8",
);
await writeFile(
  path.join(mediaRoot, "ui-transparent-overlay-offscreen.manifest.json"),
  `${JSON.stringify({
    schema: "vkf-media-freshness/1",
    capture: {
      api: "VfDisplay.__test.captureGeomFrameDataUrl",
      composite_api: "Page.captureScreenshot",
      execution: "headless Edge WebGPU",
      fixture: "examples/material_ui_gallery/app.vkf",
      frame_id: captureSummary.frameId,
      interactions: ["camera-default", "camera-wheel-detail"],
      pairs: captureSummary.states.map((state) => ({
        view: state.view,
        renderer_sha256: state.sha256,
        composite_sha256: state.compositeSha256,
        static_html: state.staticHtml,
        frame_chrome: state.frameChrome,
        webgpu_canvas: state.webgpuCanvas,
      })),
    },
    sources,
    media: overlayMedia,
  }, null, 2)}\n`,
  "utf8",
);
process.stdout.write(JSON.stringify({
  ...captureSummary,
  still: path.relative(repositoryRoot, stillDestination).replaceAll(path.sep, "/"),
  animation: path.relative(repositoryRoot, webpDestination).replaceAll(path.sep, "/"),
  rendererAnimation: path.relative(repositoryRoot, rendererWebpDestination).replaceAll(path.sep, "/"),
}));
