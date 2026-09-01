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

test("homogeneous statement storage grows beyond fixed parser result aliases", () => {
  const rootWork = join(root, ".work");
  mkdirSync(rootWork, { recursive: true });
  const work = mkdtempSync(join(rootWork, "i117-tagged-dynamic-storage-"));
  try {
    copyFileSync(join(root, "compiler", "self_hosted", "parser.vkf"), join(work, "parser.vkf"));
    const harness = join(work, "probe.vkf");
    const artifact = join(work, `probe${suffix}`);
    writeFileSync(harness, [
      "parser: .parser",
      "build_storage():",
      "    storage: parser.tagged_statement_storage(\"å+1\\nbeta+2\")",
      "    .storage: parser.append_tagged_statement(storage, 0, 2, 1, 1, 1, 1, 1, 3)",
      "    index: 1",
      "    index < 128?>",
      "        .storage: parser.append_tagged_statement(storage, 5, 9, 1, index + 1, 2, 1, 2, 6)",
      "        .index: index + 1",
      "    @: storage",
      "storage: build_storage()",
      "first: parser.tagged_statement_node(storage, 0)",
      "last: parser.tagged_statement_node(storage, 127)",
      ":: storage.count",
      ":: storage.rows.length()",
      ":: first.left.name",
      ":: first.right.value",
      ":: last.left.name",
      ":: last.right.value",
      ":: last.span.stop.line",
      ":: last.span.stop.column",
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
      "128", "1024", "å", "1", "beta", "128", "2", "6",
    ]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
