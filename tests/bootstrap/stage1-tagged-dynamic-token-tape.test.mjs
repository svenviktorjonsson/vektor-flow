import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const suffix = process.platform === "win32" ? ".exe" : "";
const nativeBin = process.env.VKF_NATIVE_BIN
  ? resolve(process.env.VKF_NATIVE_BIN)
  : join(root, "build", "050-b00", "bin", "Release");
const compiler = join(nativeBin, `vkf-strict${suffix}`);

test("lexer emits an arbitrary homogeneous token tape through EOF", () => {
  const rootWork = join(root, ".work");
  mkdirSync(rootWork, { recursive: true });
  const work = mkdtempSync(join(rootWork, "i118-tagged-token-tape-"));
  try {
    copyFileSync(join(root, "compiler", "self_hosted", "lexer.vkf"), join(work, "lexer.vkf"));
    const source = Array.from({ length: 32 }, (_, index) => `value${index}+${index + 1}`).join("\n");
    const harness = join(work, "probe.vkf");
    const artifact = join(work, `probe${suffix}`);
    writeFileSync(harness, [
      "lexer: .lexer",
      `tape: lexer.tagged_statement_token_tape(${JSON.stringify(source)})`,
      ":: tape.count",
      ":: tape.rows.length()",
      ":: tape.rows.(0)",
      ":: tape.rows.((tape.count - 1) * 6)",
      ":: tape.rows.((tape.count - 2) * 6)",
      "",
    ].join("\n"), "utf8");

    const compiled = spawnSync(
      compiler, ["-b", harness, "-o", artifact, "--optimizer-policy", "mask-0"],
      { cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true },
    );
    assert.equal(compiled.status, 0, compiled.stderr);
    const executed = spawnSync(artifact, [], {
      cwd: work, encoding: "utf8", timeout: 3_000, windowsHide: true,
    });
    assert.equal(executed.status, 0, executed.stderr);
    assert.deepEqual(executed.stdout.trim().split(/\r?\n/u), [
      "129", "774", "1", "5", "4",
    ]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
