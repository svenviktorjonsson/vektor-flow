import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const defaultNativeBin = process.platform === "win32"
  ? join(root, "build", "050-b00", "bin", "Release")
  : join(root, "build", "050-b00", "bin");
const nativeBin = process.env.VKF_NATIVE_BIN
  ? resolve(process.env.VKF_NATIVE_BIN)
  : defaultNativeBin;
const lexerTool = join(nativeBin, `vkf_lexer_cursor_smoke${executableSuffix}`);

test("StringCursor is the scalar-safe cursor used by the self-hosted lexer", () => {
  const lexerSource = readFileSync(
    join(root, "compiler", "self_hosted", "lexer.vkf"),
    "utf8",
  );
  const nativeCursor = readFileSync(
    join(root, "compiler", "native", "vkf_string_primitives.hpp"),
    "utf8",
  );
  const nativeLexer = readFileSync(
    join(root, "compiler", "native", "vkf_lexer_cursor_smoke.cpp"),
    "utf8",
  );

  assert.match(lexerSource, /^StringCursor\(source:str\):/m);
  assert.match(lexerSource, /peek\(cursor:StringCursor\)/);
  assert.match(lexerSource, /advance\(cursor:StringCursor\)/);
  assert.match(lexerSource, /slice\(cursor:StringCursor,/);
  assert.match(nativeCursor, /struct StringCursor\s*\{/);
  assert.match(nativeLexer, /StringCursor cursor\{/);
});

test("the lexer advances and slices multibyte scalars without splitting them", () => {
  const work = mkdtempSync(join(tmpdir(), "vkf-i98-cursor-"));
  try {
    const sourcePath = join(work, "unicode.vkf");
    writeFileSync(sourcePath, '"é🙂"\nalpha\n', "utf8");
    const run = spawnSync(lexerTool, ["--file", sourcePath, "<i98>"], {
      cwd: work,
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
    });
    assert.equal(run.error, undefined, `lexer did not start: ${run.error}`);
    assert.equal(run.status, 0, run.stderr);

    const payload = JSON.parse(run.stdout);
    assert.deepEqual(
      payload.tokens.map(({ kind, value, location }) => ({
        kind,
        value,
        line: location.line,
        column: location.column,
      })),
      [
        { kind: "STRING", value: "é🙂", line: 1, column: 1 },
        { kind: "NEWLINE", value: null, line: 2, column: 1 },
        { kind: "IDENT", value: "alpha", line: 2, column: 1 },
        { kind: "NEWLINE", value: null, line: 3, column: 1 },
        { kind: "EOF", value: null, line: 3, column: 1 },
      ],
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
