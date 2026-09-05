import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workRoot = join(root, "build/uncaught-assertion-audit");
mkdirSync(workRoot, { recursive: true });
const work = mkdtempSync(join(workRoot, "run-"));
copyFileSync(join(root, "compiler/self_hosted/stdlib/io.vkf"), join(work, "io.vkf"));
const suffix = process.platform === "win32" ? ".exe" : "";
const nativeBin = resolve(process.env.VKF_NATIVE_BIN ?? join(root, "build/native-windows/bin"));
const compiler = join(nativeBin, `vkf-strict${suffix}`);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const results = [];

for (const caught of [false, true]) {
  const name = caught ? "caught" : "uncaught";
  const path = join(work, `${name}.vkf`), artifact = join(work, `${name}${suffix}`);
  const source = [
    "io: .io", "errors: .errors", "check(value:str) -> bit:",
    '    (value = "ok")?! "first assertion"', '    false?! "second assertion"',
    "value: io.read_line()",
    ...(caught ? ['message: ""', "check(value)!?",
      "    errors.AssertionError => .message: $.message", ":: message"] : ["check(value)"]),
    "",
  ].join("\n");
  writeFileSync(path, source);
  const build = spawnSync(compiler, ["-b", path, "-o", artifact, "--optimizer-policy", "mask-0"], {
    cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
  });
  if (build.status !== 0) throw new Error(build.error?.message ?? build.stderr);
  for (const input of ["bad", "ok"]) {
    const run = spawnSync(artifact, [], {
      cwd: work, encoding: "utf8", input: `${input}\n`, timeout: 3_000, windowsHide: true,
    });
    const expectedMessage = input === "bad" ? "first assertion" : "second assertion";
    results.push({
      mode: name, input, status: run.status, stdout: run.stdout, stderr: run.stderr,
      error: run.error?.message,
      // This audits loss of authored text, not an approved diagnostic formatter.
      message_observed: (caught ? run.stdout : run.stderr).includes(expectedMessage),
      source_sha256: sha256(source), artifact_sha256: sha256(readFileSync(artifact)),
    });
  }
}
console.log(JSON.stringify({ compiler_sha256: sha256(readFileSync(compiler)), results }, null, 2));
process.exitCode = results.every((result) => result.message_observed) ? 0 : 1;
