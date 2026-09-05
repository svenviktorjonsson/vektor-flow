import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const suffix = process.platform === "win32" ? ".exe" : "";
const nativeBin = resolve(process.env.VKF_NATIVE_BIN ?? join(root, "build/native-windows/bin"));
const compiler = join(nativeBin, `vkf-strict${suffix}`);
const oracle = join(nativeBin, `vkf_lexer_cursor_smoke${suffix}`);
const workRoot = join(root, "build/bootstrap-token-inventory");
mkdirSync(workRoot, { recursive: true });
const work = mkdtempSync(join(workRoot, "run-"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifest = JSON.parse(readFileSync(join(root, "compiler/self_hosted/vf-compiler-bootstrap.json"), "utf8"));
copyFileSync(join(root, "compiler/self_hosted/lexer.vkf"), join(work, "lexer.vkf"));
copyFileSync(join(root, "compiler/self_hosted/stdlib/io.vkf"), join(work, "io.vkf"));
const harness = join(work, "probe.vkf"), artifact = join(work, `probe${suffix}`);
const harnessSource = [
  "lexer: .lexer", "io: .io", "errors: .errors", "path: io.read_line()",
  "source: io.read_text(path)", 'message: ""',
  "lexer.tagged_numeric_function_token_tape(source)!?",
  "    errors.AssertionError => .message: $.message", ":: message", "",
].join("\n");
writeFileSync(harness, harnessSource);
const built = spawnSync(compiler, ["-b", harness, "-o", artifact, "--optimizer-policy", "mask-0"], {
  cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
});
if (built.status !== 0) throw new Error(built.error?.message ?? built.stderr);

const observations = [];
for (const item of manifest.sources) {
  const source = readFileSync(join(root, item.path), "utf8").replace(/\r\n/g, "\n");
  if (sha256(source) !== item.source_sha256) throw new Error(`stale source: ${item.path}`);
  const input = join(work, "input.vkf");
  writeFileSync(input, source);
  const native = spawnSync(oracle, ["--file", input, item.path], {
    cwd: work, encoding: "utf8", timeout: 3_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true,
  });
  const run = spawnSync(artifact, [], {
    cwd: work, encoding: "utf8", input: `${input}\n`, timeout: 3_000, windowsHide: true,
  });
  const observation = {
    path: item.path, source_sha256: item.source_sha256,
    native: { status: native.status, stderr: native.stderr, error: native.error?.message },
    token_producer: { status: run.status, stdout: run.stdout, stderr: run.stderr, error: run.error?.message },
  };
  if (process.argv.includes("--localize") && run.status === 0 && run.stdout.trim()) {
    // Each prefix is a separate input starting at byte zero. Nothing is removed
    // or skipped from the whole-source observation above. This localizes its
    // first matching failure; it is not a replacement acceptance input.
    const lines = source.split("\n");
    for (let count = 1; count <= lines.length; count += 1) {
      writeFileSync(input, lines.slice(0, count).join("\n"));
      const prefix = spawnSync(artifact, [], {
        cwd: work, encoding: "utf8", input: `${input}\n`, timeout: 3_000, windowsHide: true,
      });
      if (prefix.status !== 0) {
        observation.localization_failure = { line: count, status: prefix.status, error: prefix.error?.message };
        break;
      }
      if (prefix.stdout === run.stdout) {
        observation.first_matching_prefix = { line: count, source_line: lines[count - 1] };
        break;
      }
    }
  }
  observations.push(observation);
}
console.log(JSON.stringify({
  scope: "Whole locked sources, no preprocessing or unsupported-token skipping; not token-stream parity or bootstrap completion",
  bundle_sha256: manifest.bundle_sha256, compiler_sha256: sha256(readFileSync(compiler)),
  probe_source_sha256: sha256(harnessSource), probe_artifact_sha256: sha256(readFileSync(artifact)), observations,
}, null, 2));
