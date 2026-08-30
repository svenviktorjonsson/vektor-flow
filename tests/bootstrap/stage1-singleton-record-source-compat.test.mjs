import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const nativeBin = process.env.VKF_NATIVE_BIN
  ? resolve(process.env.VKF_NATIVE_BIN)
  : join(root, "build", "050-b00", "bin");
const compiler = join(nativeBin, `vkf-strict${executableSuffix}`);

test("self-hosted singleton record constructors remain importable", () => {
  const work = mkdtempSync(join(tmpdir(), "vkf-singleton-record-source-compat-"));
  try {
    for (const moduleName of ["typed_ir", "machine_ir"]) {
      copyFileSync(
        join(root, "compiler", "self_hosted", `${moduleName}.vkf`),
        join(work, `${moduleName}.vkf`),
      );
    }
    const source = join(work, "singleton-record-source-compat.vkf");
    const artifact = join(work, `singleton-record-source-compat${executableSuffix}`);
    writeFileSync(
      source,
      [
        "typed: .typed_ir",
        "mir: .machine_ir",
        'typed_name: typed.type_name("num")',
        'simple: mir.mir_simple("return_f64")',
        ":: typed_name.name",
        ":: simple.kind",
        "",
      ].join("\n"),
      "utf8",
    );

    const compiled = spawnSync(
      compiler,
      [
        "-b",
        source,
        "-o",
        artifact,
        "--diagnostics",
        "--optimizer-policy",
        "mask-0",
      ],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 120_000,
        windowsHide: true,
      },
    );
    assert.equal(compiled.error, undefined, `failed to start ${compiler}: ${compiled.error}`);
    assert.equal(compiled.status, 0, compiled.stderr);

    const run = spawnSync(artifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
    });
    assert.equal(run.error, undefined, `singleton-record probe did not start: ${run.error}`);
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(run.stdout.trim().split(/\r?\n/), ["num", "return_f64"]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
