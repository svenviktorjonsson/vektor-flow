import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const bin = resolve(process.env.VKF_NATIVE_BIN ?? join(root, "build/native-windows/bin"));
const suffix = process.platform === "win32" ? ".exe" : "";

test("private x64 entry prefix matches native emitter bytes", () => {
  const workRoot = resolve(process.env.VKF_TEST_WORK_ROOT ?? join(root, "build/bootstrap-tests"));
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "private-x64-prefix-"));
  try {
    copyFileSync(join(root, "compiler/self_hosted/machine_ir.vkf"), join(work, "machine_ir.vkf"));
    copyFileSync(join(root, "compiler/self_hosted/stdlib/io.vkf"), join(work, "io.vkf"));
    const source = join(work, "probe.vkf"), artifact = join(work, `probe${suffix}`);
    writeFileSync(source, [
      "machine: .machine_ir", "io: .io",
      "locals: vkf_decimal_parse(io.read_line()) - 1",
      "maximum: vkf_decimal_parse(io.read_line()) - 1",
      "value: vkf_decimal_parse(io.read_line())",
      `encoded: machine._bootstrap_x64_entry_prefix(locals, maximum, value, ${process.platform === "win32" ? "true" : "false"})`,
      ":: encoded.valid", ":: encoded.bytes", "",
    ].join("\n"));
    const built = spawnSync(join(bin, `vkf-strict${suffix}`), ["-b", source, "-o", artifact, "--optimizer-policy", "mask-0"], {
      cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
    });
    assert.equal(built.status, 0, built.error?.message ?? built.stderr);
    const overhead = process.platform === "win32" ? 15 : 7;
    for (const [locals, maximum, value] of [
      [0, 1, 7.5], [3, 4, 6.7], [20, 17, 9007199254740991],
      [511 - overhead, 1, 0.1], [0, 512 - overhead, 1],
      [512 - overhead, 1, 2],
      [1023 - overhead, 1, 0], [1, 1023 - overhead, 4],
      [4, 2048, 1.25],
    ]) {
      const run = spawnSync(artifact, [], {
        cwd: work, encoding: "utf8", input: `${locals + 1}\n${maximum + 1}\n${value}\n`, timeout: 3_000, windowsHide: true,
      });
      assert.equal(run.status, 0, run.error?.message ?? run.stderr);
      assert.equal(run.stderr, "");
      const [valid, encoded] = run.stdout.trimEnd().split(/\r?\n/);
      assert.equal(valid, "true", `locals=${locals}, maximum=${maximum}: ${run.stdout}`);
      const oracle = spawnSync(join(bin, `vkf_private_x64_prefix${suffix}`), [String(locals), String(maximum), String(value)], {
        cwd: work, encoding: "utf8", timeout: 3_000, windowsHide: true,
      });
      assert.equal(oracle.status, 0, oracle.error?.message ?? oracle.stderr);
      assert.equal(oracle.stderr, "");
      const actual = JSON.parse(encoded);
      const [expected, complete] = oracle.stdout.trimEnd().split(/\r?\n/).map(JSON.parse);
      assert.ok(expected.length > 0 && expected.length < complete.length, "native prefix is partial");
      assert.deepEqual(expected, complete.slice(0, expected.length));
      assert.deepEqual(actual, expected);
    }
    for (const [locals, maximum] of [[-1, 1], [0.5, 1], [0, 0], [0, 1.5], [268435456, 1], [0, 268435456]]) {
      const run = spawnSync(artifact, [], {
        cwd: work, encoding: "utf8", input: `${locals + 1}\n${maximum + 1}\n1\n`, timeout: 3_000, windowsHide: true,
      });
      assert.equal(run.status, 0, run.error?.message ?? run.stderr);
      assert.equal(run.stderr, "");
      assert.deepEqual(run.stdout.trimEnd().split(/\r?\n/), ["false", "[]"]);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
