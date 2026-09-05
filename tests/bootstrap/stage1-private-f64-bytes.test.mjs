import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const bin = resolve(process.env.VKF_NATIVE_BIN ?? join(root, "build/native-windows/bin"));
const suffix = process.platform === "win32" ? ".exe" : "";

test("private f64 byte encoding preserves native IEEE bits", () => {
  const workRoot = resolve(process.env.VKF_TEST_WORK_ROOT ?? join(root, "build/bootstrap-tests"));
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "private-f64-bytes-"));
  try {
    copyFileSync(join(root, "compiler/self_hosted/machine_ir.vkf"), join(work, "machine_ir.vkf"));
    copyFileSync(join(root, "compiler/self_hosted/stdlib/io.vkf"), join(work, "io.vkf"));
    const probe = join(work, "probe.vkf"), artifact = join(work, `probe${suffix}`);
    writeFileSync(probe, [
      "machine: .machine_ir", "io: .io",
      "produce():",
      "    value: vkf_decimal_parse(io.read_line())",
      "    shift: vkf_decimal_parse(io.read_line()) - 1074",
      "    negative: vkf_decimal_parse(io.read_line())",
      "    (shift > 0)?>", "        .value*: 2", "        .shift-: 1",
      "    (shift < 0)?>", "        .value/: 2", "        .shift+: 1",
      "    negative = 1? .value*: -1",
      "    negative = 2? .value: value / value",
      "    negative = 3? .value: null",
      "    machine._bootstrap_f64_bytes(value)",
      "encoded: produce()",
      ":: encoded.valid", ":: encoded.bytes", "",
    ].join("\n"));
    const built = spawnSync(join(bin, `vkf-strict${suffix}`), ["-b", probe, "-o", artifact, "--optimizer-policy", "mask-0"], {
      cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
    });
    assert.equal(built.status, 0, built.error?.message ?? built.stderr);
    for (const [significand, shift, negative] of [
      [1, 0, 0], [0, 0, 0], [0.1, 0, 0], [7.5, 0, 0],
      [9007199254740991, 0, 0], [9007199254740991, 971, 0],
      [4503599627370496, -1074, 0], [4503599627370495, -1074, 0],
      [1, -1074, 0], [2, -1074, 0], [3, -1074, 0],
      [1, 0, 1], [0.1, 0, 1], [1, -1074, 1],
      [0, 0, 1],
      [1, 1024, 0], [1, 1024, 1],
      ...Array.from({ length: 52 }, (_, bit) => [4503599627370496 + 2 ** bit, -52, bit % 2]),
    ]) {
      const run = spawnSync(artifact, [], {
        cwd: work, encoding: "utf8", input: `${significand}\n${shift + 1074}\n${negative}\n`, timeout: 3_000, windowsHide: true,
      });
      assert.equal(run.status, 0, run.error?.message ?? run.stderr);
      assert.equal(run.stderr, "");
      const lines = run.stdout.trimEnd().split(/\r?\n/);
      assert.equal(lines[0], "true", `${significand} * 2^${shift}, sign ${negative}: ${run.stdout}`);
      const oracle = spawnSync(join(bin, `vkf_private_f64_bytes${suffix}`), [String(significand), String(shift), String(negative)], {
        cwd: work, encoding: "utf8", timeout: 3_000, windowsHide: true,
      });
      assert.equal(oracle.status, 0, oracle.error?.message ?? oracle.stderr);
      assert.equal(oracle.stderr, "");
      assert.deepEqual(JSON.parse(lines[1]), JSON.parse(oracle.stdout), `${significand} * 2^${shift}, sign ${negative}`);
    }
    // Reject NaN, including VKF's distinct null payload, rather than invent a
    // payload-canonicalization policy or silently encode another bit pattern.
    for (const mode of [2, 3]) {
      const run = spawnSync(artifact, [], {
        cwd: work, encoding: "utf8", input: `0\n1074\n${mode}\n`, timeout: 3_000, windowsHide: true,
      });
      assert.equal(run.status, 0, run.error?.message ?? run.stderr);
      assert.equal(run.stderr, "");
      assert.deepEqual(run.stdout.trimEnd().split(/\r?\n/), ["false", "[]"]);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
