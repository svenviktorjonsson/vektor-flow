import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const bin = resolve(process.env.VKF_NATIVE_BIN ?? join(root, "build/native-windows/bin"));
const suffix = process.platform === "win32" ? ".exe" : "";

test("private expression facts match native typed IR", () => {
  const workRoot = resolve(process.env.VKF_TEST_WORK_ROOT ?? join(root, "build/bootstrap-tests"));
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "private-expression-types-"));
  try {
    for (const name of ["lexer", "parser", "typed_ir"]) copyFileSync(join(root, `compiler/self_hosted/${name}.vkf`), join(work, `${name}.vkf`));
    copyFileSync(join(root, "compiler/self_hosted/stdlib/io.vkf"), join(work, "io.vkf"));
    const probe = join(work, "probe.vkf"), artifact = join(work, `probe${suffix}`);
    writeFileSync(probe, [
      "lexer: .lexer", "parser: .parser", "typed: .typed_ir", "io: .io",
      "path: io.read_line()", "index: vkf_decimal_parse(io.read_line())", "source: io.read_text(path)",
      "tape: lexer.tagged_numeric_function_token_tape(source)",
      "shape: parser._bootstrap_record_function_shape(source, tape.rows, tape.count)",
      "tree: parser._bootstrap_expression_tree(source, tape.rows, tape.count, shape.expression_starts.(index), shape.expression_stops.(index))",
      "facts: typed._bootstrap_expression_types(source, tape.rows, tree.nodes, tree.arguments, shape.parameter_starts, shape.parameter_stops, shape.type_starts, shape.type_stops)",
      ":: facts.valid", ":: facts.error_index", ":: facts.types", ":: facts.parameters",
      ":: tree.root", ":: tree.nodes", ":: tree.arguments", ":: tape.rows",
      ":: shape.type_starts", ":: shape.type_stops", "",
    ].join("\n"));
    const built = spawnSync(join(bin, `vkf-strict${suffix}`), ["-b", probe, "-o", artifact, "--optimizer-policy", "mask-0"], {
      cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
    });
    assert.equal(built.status, 0, built.error?.message ?? built.stderr);
    for (const source of [
      "load(values:[str]):\n    (copy:values, original:values)\n",
      "swap(left:[num], right:[int]):\n    (second:right, first:left)\n",
      "constants(input:[str]):\n    (integer:7, decimal:1.0, fraction:2.5, grouped:(input))\n",
      "_compile_locked_valid_source_graph(sources:[str]):\n    (sources:sources, source_count:sources.length())\n",
      "measure(items:[num], flags:[bit]):\n    (other:flags.length(), count:(items).length())\n",
      "_compile_locked_valid_source_graph(sources:[str]):\n    (sources:sources, source_count:sources.length()+1)\n",
      "offset(items:[num]):\n    (mixed:items.length()+1.0, grouped:(2+3)+4.5, reverse:2.5+items.length())\n",
      "# Unicode: café\nspaced(items:[ num ]):\n    (call:(items.length)(), original:items)\n",
      "artifact_result(manifest_path:str, artifact_path:str, status:str):\n    (manifest_path:manifest_path, artifact_path:artifact_path, status:status)\n",
    ]) {
      const input = join(work, "input.vkf");
      writeFileSync(input, source);
      const lexed = spawnSync(join(bin, `vkf_lexer_cursor_smoke${suffix}`), ["--file", input, "<private-types>"], {
        encoding: "utf8", timeout: 3_000, windowsHide: true,
      });
      assert.equal(lexed.status, 0, lexed.stderr);
      const parsed = spawnSync(join(bin, `vkf_parser_token_stream_smoke${suffix}`), [], {
        input: lexed.stdout, encoding: "utf8", timeout: 3_000, windowsHide: true,
      });
      assert.equal(parsed.status, 0, parsed.stderr);
      const lowered = spawnSync(join(bin, `vkf_ast_to_ir_smoke${suffix}`), [], {
        input: parsed.stdout, encoding: "utf8", timeout: 3_000, windowsHide: true,
      });
      assert.equal(lowered.status, 0, lowered.stderr);
      const expected = JSON.parse(lowered.stdout).body[0].body.body[0].expr.fields;
      for (let field = 0; field < expected.length; field += 1) {
        const run = spawnSync(artifact, [], { cwd: work, encoding: "utf8", input: `${input}\n${field}\n`, timeout: 3_000, windowsHide: true });
        assert.equal(run.status, 0, run.error?.message ?? run.stderr);
        assert.equal(run.stderr, "");
        const lines = run.stdout.trimEnd().split(/\r?\n/);
        assert.equal(lines[0], "true", run.stdout);
        const types = JSON.parse(lines[2]), parameters = JSON.parse(lines[3]);
        const nodes = JSON.parse(lines[5]), rows = JSON.parse(lines[7]);
        const typeStarts = JSON.parse(lines[8]), typeStops = JSON.parse(lines[9]), bytes = Buffer.from(source);
        assert.equal(types.length, nodes.length / 5);
        assert.equal(parameters.length, types.length);
        const decode = (index) => {
          assert.ok(Number.isInteger(index) && index >= 0 && index < types.length);
          const [kind, token, left, right, value] = nodes.slice(index * 5, index * 5 + 5);
          if (kind === 2) {
            assert.ok(types[index] === 1 || types[index] === 2);
            return { kind: "const", type: types[index] === 1 ? "int" : "num", value };
          }
          if (kind === 6) {
            assert.equal(types[index], types[left]);
            return decode(left);
          }
          if (kind === 3) {
            assert.equal(types[index], 4);
            const object = decode(left);
            return { kind: "field_access", object, object_type: object.type, field: bytes.subarray(rows[token * 6 + 1], rows[token * 6 + 2]).toString(), type: "fn()->int" };
          }
          if (kind === 4) {
            assert.equal(types[index], 1);
            assert.equal(value, 0);
            const callee = decode(left);
            return { kind: "call", callee, callee_type: callee.type, args: [], arg_types: [], named_args: [], spread_args: [], type: "int" };
          }
          if (kind === 5) {
            const lhs = decode(left), rhs = decode(right);
            assert.ok(types[index] === 1 || types[index] === 2);
            return { kind: "binary_op", op: "PLUS", left: lhs, right: rhs, left_type: lhs.type, right_type: rhs.type, type: types[index] === 1 ? "int" : "num" };
          }
          assert.equal(kind, 1);
          if (types[index] === 5) {
            return {
              kind: "load",
              name: bytes.subarray(rows[token * 6 + 1], rows[token * 6 + 2]).toString(),
              type: "str",
            };
          }
          assert.equal(types[index], 3);
          const parameter = parameters[index];
          assert.ok(Number.isInteger(parameter) && parameter >= 0 && parameter < typeStarts.length);
          // The declaration stage validates [IDENT]; recover its canonical type
          // from that original token, retaining whitespace-independent meaning.
          const elements = Array.from({ length: rows.length / 6 }, (_, tokenIndex) => rows.slice(tokenIndex * 6, tokenIndex * 6 + 6))
            .filter(([tokenKind, start, stop]) => tokenKind === 1 && start >= typeStarts[parameter] && stop <= typeStops[parameter]);
          assert.equal(elements.length, 1);
          return {
            kind: "load",
            name: bytes.subarray(rows[token * 6 + 1], rows[token * 6 + 2]).toString(),
            type: `[${bytes.subarray(elements[0][1], elements[0][2]).toString()}]`,
          };
        };
        assert.deepEqual(decode(Number(lines[4])), expected[field].value);
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("private type facts reject unsupported inputs and malformed arena references in order", () => {
  const workRoot = resolve(process.env.VKF_TEST_WORK_ROOT ?? join(root, "build/bootstrap-tests"));
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "private-type-errors-"));
  try {
    for (const name of ["lexer", "parser", "typed_ir"]) copyFileSync(join(root, `compiler/self_hosted/${name}.vkf`), join(work, `${name}.vkf`));
    copyFileSync(join(root, "compiler/self_hosted/stdlib/io.vkf"), join(work, "io.vkf"));
    const probe = join(work, "probe.vkf"), artifact = join(work, `probe${suffix}`);
    writeFileSync(probe, [
      "lexer: .lexer", "parser: .parser", "typed: .typed_ir", "io: .io",
      "check(source:str, mode:str):",
      "    tape: lexer.tagged_numeric_function_token_tape(source)",
      "    shape: parser._bootstrap_record_function_shape(source, tape.rows, tape.count)",
      "    tree: parser._bootstrap_expression_tree(source, tape.rows, tape.count, shape.expression_starts.0, shape.expression_stops.0)",
      "    [num] nodes: tree.nodes", "    root: tree.root",
      '    mode = "future-child"? nodes.(root * 5 + 2): root',
      '    mode = "fractional-child"? nodes.(root * 5 + 2): 0.5',
      '    mode = "bad-argument-offset"? nodes.(root * 5 + 3): -1',
      '    mode = "bad-number-surface"? nodes.3: 2',
      '    mode = "later-corrupt"? nodes.6: tape.count + 1',
      "    facts: typed._bootstrap_expression_types(source, tape.rows, nodes, tree.arguments, shape.parameter_starts, shape.parameter_stops, shape.type_starts, shape.type_stops)",
      "    (valid:facts.valid, error_index:facts.error_index, rows:tape.rows)",
      "path: io.read_line()", "mode: io.read_line()", "result: check(io.read_text(path), mode)",
      ":: result.valid", ":: result.error_index", ":: result.rows", "",
    ].join("\n"));
    const built = spawnSync(join(bin, `vkf-strict${suffix}`), ["-b", probe, "-o", artifact, "--optimizer-policy", "mask-0"], {
      cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
    });
    assert.equal(built.status, 0, built.error?.message ?? built.stderr);
    for (const [expression, mode, badToken] of [
      ["missing+later", "none", "missing"],
      ["missing+later", "later-corrupt", "missing"],
      ["items.unknown()", "none", "unknown"],
      ["items.length(1)", "none", "("],
      ["items+1", "none", "+"],
      ["items.length()", "future-child", "("],
      ["items.length()", "fractional-child", "("],
      ["items.length()", "bad-argument-offset", "("],
      ["7", "bad-number-surface", "7"],
      ["items", "duplicate-parameter", "items"],
      ["missing", "duplicate-parameter", "items"],
    ]) {
      const source = mode === "duplicate-parameter"
        ? `check(items:[str], items:[num]):\n    (value:${expression}, original:items)\n`
        : `check(items:[num]):\n    (value:${expression}, original:items)\n`;
      const input = join(work, "input.vkf");
      writeFileSync(input, source);
      const run = spawnSync(artifact, [], { cwd: work, encoding: "utf8", input: `${input}\n${mode}\n`, timeout: 3_000, windowsHide: true });
      assert.equal(run.status, 0, run.error?.message ?? run.stderr);
      assert.equal(run.stderr, "");
      const lines = run.stdout.trimEnd().split(/\r?\n/), rows = JSON.parse(lines[2]);
      assert.equal(lines[0], "false", `${expression}; ${mode}; ${run.stdout}`);
      const expectedStart = mode === "duplicate-parameter" ? source.indexOf("items", source.indexOf("items") + 1)
        : source.indexOf("value:") + "value:".length + expression.indexOf(badToken);
      const expected = Array.from({ length: rows.length / 6 }, (_, index) => index).find((index) => rows[index * 6 + 1] === expectedStart);
      assert.notEqual(expected, undefined);
      assert.equal(Number(lines[1]), expected, `${expression}; ${mode}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
