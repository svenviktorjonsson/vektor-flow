import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const suffix = process.platform === "win32" ? ".exe" : "";
const nativeBin = process.env.VKF_NATIVE_BIN
  ? resolve(process.env.VKF_NATIVE_BIN)
  : join(root, "build", "native-compiler", "bin");
const compiler = join(nativeBin, `vkf-strict${suffix}`);

function compile(work, name, source) {
  const input = join(work, `${name}.vkf`);
  const artifact = join(work, `${name}${suffix}`);
  writeFileSync(input, source, "utf8");
  const result = spawnSync(
    compiler,
    ["-b", input, "-o", artifact, "--optimizer-policy", "mask-0"],
    { cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true },
  );
  return { artifact, result };
}

test("direct machine IR preserves canonical decimal parsing", () => {
  const work = mkdtempSync(join(tmpdir(), "vkf-direct-decimal-"));
  try {
    const cases = [
      ["hard-rounding", "128946864.8218311742", "128946864.82183118"],
      ["fraction", "6.7", "6.7000000000000002"],
      ["u64-wrap", "18446744073709551616", "0"],
      ["owned-slice", 'vkf_utf8_slice("x6.7y", 1, 4)', "6.7000000000000002"],
    ];
    for (const [name, source, expected] of cases) {
      const { artifact, result } = compile(
        work,
        name,
        source.startsWith("vkf_utf8_slice")
          ? `:: vkf_decimal_parse(${source})\n`
          : `:: vkf_decimal_parse("${source}")\n`,
      );
      assert.equal(result.status, 0, result.stderr);
      const executed = spawnSync(artifact, [], {
        cwd: work,
        encoding: "utf8",
        timeout: 3_000,
        windowsHide: true,
      });
      assert.equal(executed.status, 0, executed.stderr);
      assert.equal(executed.stdout.trim(), expected);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("direct decimal parsing reports exact arity and type diagnostics", () => {
  const work = mkdtempSync(join(tmpdir(), "vkf-direct-decimal-errors-"));
  try {
    const cases = [
      ["zero", ":: vkf_decimal_parse()\n", "wrong arity for runtime intrinsic vkf_decimal_parse: expected 1, got 0"],
      ["two", ":: vkf_decimal_parse(\"1\", \"2\")\n", "wrong arity for runtime intrinsic vkf_decimal_parse: expected 1, got 2"],
      ["type", ":: vkf_decimal_parse(1)\n", "machine IR vkf_decimal_parse source must be str"],
      [
        "named",
        ':: vkf_decimal_parse(value:"1")\n',
        "machine IR vkf_decimal_parse requires one positional argument; named and spread arguments are unsupported",
      ],
      [
        "spread",
        'values: ["1"]\n:: vkf_decimal_parse(:values)\n',
        "machine IR vkf_decimal_parse requires one positional argument; named and spread arguments are unsupported",
      ],
    ];
    for (const [name, source, expected] of cases) {
      const { result } = compile(work, name, source);
      assert.notEqual(result.status, 0, `${name} unexpectedly compiled`);
      assert.match(result.stderr, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
