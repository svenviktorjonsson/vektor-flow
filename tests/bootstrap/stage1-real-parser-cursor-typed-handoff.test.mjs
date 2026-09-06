import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const suffix = process.platform === "win32" ? ".exe" : "";
const nativeBin = resolve(process.env.VKF_NATIVE_BIN ?? join(root, "build/native-windows/bin"));
const compiler = join(nativeBin, `vkf-strict${suffix}`);

test("real parser cursor preserves tagged expression values and spans into typed IR", () => {
  const workRoot = resolve(process.env.VKF_TEST_WORK_ROOT ?? join(root, "build/bootstrap-tests"));
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "real-parser-cursor-typed-"));
  try {
    for (const name of ["lexer", "parser", "typed_ir"]) {
      copyFileSync(join(root, `compiler/self_hosted/${name}.vkf`), join(work, `${name}.vkf`));
    }
    const source = join(work, "probe.vkf");
    const artifact = join(work, `probe${suffix}`);
    writeFileSync(source, [
      "lexer: .lexer",
      "parser: .parser",
      "typed: .typed_ir",
      'tokens: lexer.bounded_parser_expression_stream("alpha+42")',
      "left: parser.tagged_cursor(tokens.tokens.0)",
      "operator: parser.tagged_advance(left, tokens.tokens.1)",
      "right: parser.tagged_advance(operator, tokens.tokens.2)",
      "parsed: parser.parse_module_from_cursor(left, operator, right)",
      "expression: parsed.module.body.0",
      "typed_expression: typed.typed_tagged_ast_binary_expression(",
      "    expression.left.name, expression.op, expression.right.value,",
      "    expression.span.start.file, expression.span.start.line,",
      "    expression.span.start.column, expression.span.stop.line,",
      "    expression.span.stop.column",
      ")",
      "matches: (parsed.module.kind = \"module\" /\\ expression.left.name = \"alpha\" /\\",
      "    expression.op = \"+\" /\\ expression.right.value = 42 /\\",
      "    expression.span.start.line = 1 /\\ expression.span.start.column = 1 /\\",
      "    expression.span.stop.line = 1 /\\ expression.span.stop.column = 7 /\\",
      "    typed_expression.left.name = \"alpha\" /\\ typed_expression.op = \"+\" /\\",
      "    typed_expression.right.value = 42 /\\",
      "    typed_expression.span.start.column = 1 /\\ typed_expression.span.stop.column = 7)",
      'matches?! "real parser cursor lost tagged AST or typed IR values/spans"',
      ":: typed_expression.right.value",
      "",
    ].join("\n"), "utf8");

    const compiled = spawnSync(compiler, ["-b", source, "-o", artifact, "--optimizer-policy", "mask-0"], {
      cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
    });
    assert.equal(compiled.status, 0, compiled.stderr);
    const executed = spawnSync(artifact, [], {
      cwd: work, encoding: "utf8", timeout: 3_000, windowsHide: true,
    });
    assert.equal(executed.status, 0, executed.stderr);
    assert.equal(executed.stdout.trim(), "42");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("real parser cursor preserves a numeric binding into typed IR", () => {
  const workRoot = resolve(process.env.VKF_TEST_WORK_ROOT ?? join(root, "build/bootstrap-tests"));
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "real-parser-binding-typed-"));
  try {
    for (const name of ["lexer", "parser", "typed_ir"]) {
      copyFileSync(join(root, `compiler/self_hosted/${name}.vkf`), join(work, `${name}.vkf`));
    }
    const source = join(work, "probe.vkf");
    const artifact = join(work, `probe${suffix}`);
    writeFileSync(source, [
      "lexer: .lexer",
      "parser: .parser",
      "typed: .typed_ir",
      'tokens: lexer.bounded_parser_binding_stream("answer:42")',
      "target: parser.tagged_cursor(tokens.tokens.0)",
      "colon: parser.tagged_advance(target, tokens.tokens.1)",
      "value: parser.tagged_advance(colon, tokens.tokens.2)",
      "newline: parser.tagged_advance(value, tokens.tokens.3)",
      "parsed: parser.parse_module_from_cursor(target, colon, value, newline)",
      "binding: parsed.module.body.0",
      "typed_binding: typed.typed_tagged_ast_numeric_binding(",
      "    binding.target.name, binding.value.value, binding.span.start.file,",
      "    binding.span.start.line, binding.span.start.column,",
      "    binding.span.stop.line, binding.span.stop.column",
      ")",
      "matches: (parsed.module.kind = \"module\" /\\ binding.kind = \"bind\" /\\",
      "    binding.target.name = \"answer\" /\\ binding.value.value = 42 /\\",
      "    binding.span.start.line = 1 /\\ binding.span.start.column = 1 /\\",
      "    binding.span.stop.line = 1 /\\ binding.span.stop.column = 8 /\\",
      "    typed_binding.kind = \"store_binding\" /\\ typed_binding.name = \"answer\" /\\",
      "    typed_binding.value.value = 42 /\\ typed_binding.span.start.column = 1 /\\",
      "    typed_binding.span.stop.column = 8)",
      'matches?! "real parser cursor lost binding AST or typed IR values/spans"',
      ":: typed_binding.value.value",
      "",
    ].join("\n"), "utf8");

    const compiled = spawnSync(compiler, ["-b", source, "-o", artifact, "--optimizer-policy", "mask-0"], {
      cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
    });
    assert.equal(compiled.status, 0, compiled.stderr);
    const executed = spawnSync(artifact, [], {
      cwd: work, encoding: "utf8", timeout: 3_000, windowsHide: true,
    });
    assert.equal(executed.status, 0, executed.stderr);
    assert.equal(executed.stdout.trim(), "42");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
