import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const compilerBin = process.env.VKF_NATIVE_COMPILER_BIN;

function executable(name) {
  assert.ok(
    compilerBin,
    "VKF_NATIVE_COMPILER_BIN must name the focused compiler directory",
  );
  return path.join(
    compilerBin,
    process.platform === "win32" ? `${name}.exe` : name,
  );
}

function run(command, args = [], input) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    input,
    windowsHide: true,
  });
  assert.equal(result.error, undefined, `failed to start ${command}`);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function lex(source) {
  return JSON.parse(run(executable("vkf_lexer_cursor_smoke"), [source]));
}

function parse(source) {
  const tokens = JSON.stringify(lex(source));
  return JSON.parse(run(executable("vkf_parser_token_stream_smoke"), [], tokens));
}

test("a trailing comma is the lexical and AST distinction for a singleton struct", () => {
  const groupedTokens = lex(":: (a:1)").tokens;
  const structTokens = lex(":: (a:1,)").tokens;
  assert.deepEqual(
    groupedTokens.map(({ kind }) => kind),
    ["EMIT", "LPAREN", "IDENT", "COLON", "NUMBER", "RPAREN", "NEWLINE", "EOF"],
  );
  assert.deepEqual(
    structTokens.map(({ kind }) => kind),
    ["EMIT", "LPAREN", "IDENT", "COLON", "NUMBER", "COMMA", "RPAREN", "NEWLINE", "EOF"],
  );
  assert.equal(structTokens[5].location.column, 8);

  const ast = parse([
    "grouped: (a:1)",
    "singleton: (a:1,)",
    "pair: (a:1, b:2)",
    "one_tuple: (1,)",
  ].join("\n"));
  assert.equal(ast.body[0].value.kind, "bind_expr");
  assert.equal(ast.body[0].value.name, "a");
  assert.equal(ast.body[1].value.kind, "record_literal");
  assert.deepEqual(
    ast.body[1].value.fields.map(({ kind, name, value }) => ({
      kind,
      name,
      value: value.value,
    })),
    [{ kind: "record_field", name: "a", value: 1 }],
  );
  assert.equal(ast.body[2].value.kind, "record_literal");
  assert.deepEqual(ast.body[2].value.fields.map(({ name }) => name), ["a", "b"]);
  assert.equal(ast.body[3].value.kind, "tuple_literal");
  assert.equal(ast.body[3].value.elements.length, 1);
});

test("a second separator in a singleton struct reports its exact source position", () => {
  const tokens = JSON.stringify(lex(":: (a:1,,)"));
  const result = spawnSync(executable("vkf_parser_token_stream_smoke"), [], {
    cwd: repositoryRoot,
    encoding: "utf8",
    input: tokens,
    windowsHide: true,
  });
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^<cursor-smoke>:1:9: expected token IDENT\r?\n$/u);
});

test("the explicit event-drain loop preserves its grouped binding discriminant", () => {
  const ast = parse([
    "(event: events.get())??>",
    "    ButtonClicked => :: event",
  ].join("\n"));
  assert.equal(ast.body.length, 1);
  const loop = ast.body[0];
  assert.equal(loop.kind, "match_stmt");
  assert.equal(loop.loop, true);
  assert.equal(loop.catch, false);
  assert.deepEqual(loop.discriminant, {
    kind: "bind_expr",
    name: "event",
    value: {
      args: [],
      callee: {
        kind: "attribute",
        name: "get",
        object: { kind: "identifier", name: "events" },
      },
      kind: "call",
    },
  });
  assert.equal(loop.arms[0].condition.kind, "identifier");
  assert.equal(loop.arms[0].condition.name, "ButtonClicked");
});
