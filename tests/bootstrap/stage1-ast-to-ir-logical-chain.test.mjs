import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import test from "node:test";

const executableSuffix = process.platform === "win32" ? ".exe" : "";
const nativeBin = process.env.VKF_NATIVE_BIN
  ? resolve(process.env.VKF_NATIVE_BIN)
  : resolve("build", "050-b00", "bin", process.platform === "win32" ? "Release" : "");
const tool = (name) => join(nativeBin, `${name}${executableSuffix}`);

test("native typed IR lowers a source-ordered logical chain without overflowing", () => {
  const source = [
    "matches(ch:str) -> bit:",
    "    ch = \"a\" \\/ ch = \"b\" \\/ ch = \"c\" \\/ ch = \"d\" \\/ ch = \"e\" \\/ ch = \"f\" \\/ ch = \"g\"",
  ].join("\n");
  const lexed = spawnSync(tool("vkf_lexer_cursor_smoke"), [source, "<logical-chain>"], {
    encoding: "utf8", windowsHide: true,
  });
  assert.equal(lexed.status, 0, lexed.stderr);
  const parsed = spawnSync(tool("vkf_parser_token_stream_smoke"), [], {
    input: lexed.stdout, encoding: "utf8", windowsHide: true,
  });
  assert.equal(parsed.status, 0, parsed.stderr);
  const lowered = spawnSync(tool("vkf_ast_to_ir_smoke"), [], {
    input: parsed.stdout, encoding: "utf8", windowsHide: true,
  });
  assert.equal(lowered.error, undefined, `${lowered.error}`);
  assert.equal(lowered.status, 0, lowered.stderr);

  const fn = JSON.parse(lowered.stdout).body.find(({ name }) => name === "matches");
  assert.equal(fn.return_type, "bit");
  assert.equal(fn.body.body.at(-1).expr.type, "bit");
});
