import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const nativeBin = process.env.VKF_NATIVE_BIN
  ? resolve(process.env.VKF_NATIVE_BIN)
  : resolve(root, "build", "native-compiler-clang", "bin");
const outputFlag = process.argv.indexOf("--output");
const outputDirectory = outputFlag >= 0 && process.argv[outputFlag + 1]
  ? resolve(process.argv[outputFlag + 1])
  : join(root, "web", "playground", "artifacts");
const work = mkdtempSync(join(tmpdir(), "vkf-browser-compiler-build-"));

function executable(name) {
  return join(nativeBin, `${name}${executableSuffix}`);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `${command} failed with status ${result.status}`);
  }
  return result.stdout;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

try {
  const manifest = JSON.parse(readFileSync(
    join(root, "compiler", "self_hosted", "vf-compiler-bootstrap.json"),
    "utf8",
  ));
  for (const source of manifest.sources) {
    const original = join(root, source.path);
    const bytes = readFileSync(original);
    const canonical = Buffer.from(bytes.toString("utf8").replace(/\r\n/gu, "\n"));
    if (sha256(canonical) !== source.source_sha256) {
      throw new Error(`locked compiler source hash mismatch: ${source.path}`);
    }
    const copied = join(work, source.path);
    mkdirSync(dirname(copied), { recursive: true });
    copyFileSync(original, copied);
  }

  const compilerSource = join(work, "compiler", "self_hosted", "compiler.vkf");
  const nativeArtifact = join(work, `compiler-stage${executableSuffix}`);
  const compiled = JSON.parse(run(executable("vkf-strict"), [
    "-b",
    compilerSource,
    "-o",
    nativeArtifact,
    "--diagnostics",
    "--optimizer-policy",
    "mask-0",
  ]));

  mkdirSync(outputDirectory, { recursive: true });
  run(executable("vkf_symbolic_kernel_artifact"), [
    "--typed-ir",
    compiled.typed_ir_path,
    "--wasm",
    join(outputDirectory, "vkf-browser-compiler.wasm"),
    "--manifest",
    join(outputDirectory, "vkf-browser-compiler.json"),
    "--entry",
    "run_tagged_browser_source",
    "--prune-to-entry",
  ]);
} finally {
  rmSync(work, { recursive: true, force: true });
}
