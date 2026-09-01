import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exampleId = process.argv[2];
const frameId = process.argv[3] || "frame_0";
const port = Number(process.argv[4] || "9480");
if (!exampleId) throw new Error("usage: node scripts/capture-scene-example.mjs <example-id> [frame-id] [port]");

const nativeBin = process.env.VKF_NATIVE_COMPILER_BIN;
const nativeSceneStager = process.env.VKF_NATIVE_SCENE_STAGER;
if (!nativeBin || !nativeSceneStager) {
  throw new Error("VKF_NATIVE_COMPILER_BIN and VKF_NATIVE_SCENE_STAGER are required");
}

const executable = (name) => path.join(nativeBin, process.platform === "win32" ? `${name}.exe` : name);
function run(command, args = [], input) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    input,
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${command} failed`);
  return result.stdout;
}

const exampleRoot = path.join(repositoryRoot, "examples", "scene_gallery", exampleId);
const workRoot = path.join(repositoryRoot, ".w", "scene-gallery", exampleId);
const artifactRoot = path.join(workRoot, "artifact");
const overlayWeb = path.join(artifactRoot, "vf-ui");
const mediaPath = path.join(repositoryRoot, "docs", "public", "images", "scene-gallery", `${exampleId}.png`);
await rm(workRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
await cp(exampleRoot, artifactRoot, { recursive: true });
await Promise.all([
  cp(path.join(repositoryRoot, "web", "vf-ui"), overlayWeb, { recursive: true }),
  mkdir(path.dirname(mediaPath), { recursive: true }),
]);

const sourcePath = path.join(artifactRoot, "app.vkf");
const source = await readFile(sourcePath, "utf8");
const tokens = run(executable("vkf_lexer_cursor_smoke"), [source]);
const ast = run(executable("vkf_parser_token_stream_smoke"), [], tokens);
const typedIr = run(executable("vkf_ast_to_ir_smoke"), [], ast);
const typedIrPath = path.join(artifactRoot, "app.typed-ir.json");
await writeFile(typedIrPath, typedIr, "utf8");
const staging = JSON.parse(run(nativeSceneStager, [
  "--source", sourcePath,
  "--overlay-web", overlayWeb,
  "--typed-ir", typedIrPath,
]));
const scenePath = path.join(overlayWeb, ...staging.page_rel.split("/"));
const capture = JSON.parse(run(process.execPath, [
  path.join(repositoryRoot, "tests", "helpers", "run_staged_ui_example.js"),
  scenePath,
  frameId,
  "renderer",
  String(port),
  mediaPath,
]));
const media = await readFile(mediaPath);
const normalizedSource = Buffer.from(source.replaceAll("\r\n", "\n"));
process.stdout.write(JSON.stringify({
  id: exampleId,
  sourceSha256: createHash("sha256").update(normalizedSource).digest("hex"),
  mediaPath: path.relative(repositoryRoot, mediaPath).replaceAll(path.sep, "/"),
  mediaSha256: createHash("sha256").update(media).digest("hex"),
  capture,
}));
