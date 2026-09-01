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
const parserTool = join(nativeBin, `vkf_parser_token_stream_smoke${executableSuffix}`);
const irTool = join(nativeBin, `vkf_ast_to_ir_smoke${executableSuffix}`);

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
  assert.match(lexerSource, /cursor\.peek\(\)/);
  assert.match(lexerSource, /cursor\.advance\(\)/);
  assert.match(lexerSource, /cursor\.slice\(start, stop\)/);
  assert.doesNotMatch(lexerSource, /^peek\(cursor:StringCursor\)/m);
  assert.doesNotMatch(lexerSource, /^advance\(cursor:StringCursor\)/m);
  assert.doesNotMatch(lexerSource, /^slice\(cursor:StringCursor,/m);
  assert.match(nativeCursor, /struct StringCursor\s*\{/);
  assert.match(nativeCursor, /bool eof;/);
  assert.match(nativeLexer, /StringCursor cursor\{/);
});

test("StringCursor method calls lower to private cursor operations", () => {
  const work = mkdtempSync(join(tmpdir(), "vkf-i98-method-"));
  try {
    const sourcePath = join(work, "cursor-method.vkf");
    const tokenPath = join(work, "tokens.json");
    const astPath = join(work, "ast.json");
    writeFileSync(sourcePath, [
      "StringCursor(source:str):",
      "    (source:source, position:0, eof:false)",
      "",
      "_string_cursor_peek(cursor:StringCursor) -> str:",
      "    cursor.source",
      "",
      "observe(cursor:StringCursor) -> str:",
      "    cursor.peek()",
      "",
    ].join("\n"), "utf8");

    const lexed = spawnSync(lexerTool, ["--file", sourcePath, "<i98-method>"], {
      cwd: work, encoding: "utf8", timeout: 10_000, windowsHide: true,
    });
    assert.equal(lexed.status, 0, lexed.stderr);
    writeFileSync(tokenPath, lexed.stdout, "utf8");
    const parsed = spawnSync(parserTool, [tokenPath], {
      cwd: work, encoding: "utf8", timeout: 10_000, windowsHide: true,
    });
    assert.equal(parsed.status, 0, parsed.stderr);
    writeFileSync(astPath, parsed.stdout, "utf8");
    const lowered = spawnSync(irTool, [astPath], {
      cwd: work, encoding: "utf8", timeout: 10_000, windowsHide: true,
    });
    assert.equal(lowered.status, 0, lowered.stderr);

    const module = JSON.parse(lowered.stdout);
    const observe = module.body.find((statement) => statement.name === "observe");
    const call = observe.body.body.at(-1).expr;
    assert.equal(call.callee.name, "_string_cursor_peek");
    assert.deepEqual(call.arg_types, ["StringCursor"]);
    assert.equal(call.args[0].name, "cursor");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
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

test("StringCursor preserves the invalid UTF-8 lexer diagnostic", () => {
  const work = mkdtempSync(join(tmpdir(), "vkf-i98-invalid-"));
  try {
    const sourcePath = join(work, "invalid.vkf");
    writeFileSync(sourcePath, Buffer.from([0xc3, 0x28]));
    const run = spawnSync(lexerTool, ["--file", sourcePath, "<i98-invalid>"], {
      cwd: work,
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
    });
    assert.equal(run.status, 1);
    assert.equal(run.stderr.replace(/\r\n/g, "\n"), "invalid UTF-8 continuation byte\n");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
