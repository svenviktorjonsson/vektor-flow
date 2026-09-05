import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const bin = resolve(process.env.VKF_NATIVE_BIN ?? join(root, "build/native-windows/bin"));
const suffix = process.platform === "win32" ? ".exe" : "";

test("private expression parser builds native-equivalent syntax trees", () => {
  const workRoot = resolve(process.env.VKF_TEST_WORK_ROOT ?? join(root, "build/bootstrap-tests"));
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "private-expression-tree-"));
  try {
    for (const name of ["lexer", "parser"]) copyFileSync(join(root, `compiler/self_hosted/${name}.vkf`), join(work, `${name}.vkf`));
    copyFileSync(join(root, "compiler/self_hosted/stdlib/io.vkf"), join(work, "io.vkf"));
    const probe = join(work, "probe.vkf"), artifact = join(work, `probe${suffix}`);
    writeFileSync(probe, [
      "lexer: .lexer", "parser: .parser", "io: .io", "path: io.read_line()", "index: vkf_decimal_parse(io.read_line())",
      "source: io.read_text(path)", "tape: lexer.tagged_numeric_function_token_tape(source)",
      "shape: parser._bootstrap_record_function_shape(source, tape.rows, tape.count)",
      "tree: parser._bootstrap_expression_tree(source, tape.rows, tape.count, shape.expression_starts.(index), shape.expression_stops.(index))",
      ":: tree.valid", ":: tree.root", ":: tree.nodes", ":: tree.arguments", ":: tape.rows", ":: tree.error_index", "",
    ].join("\n"));
    const compiled = spawnSync(join(bin, `vkf-strict${suffix}`), ["-b", probe, "-o", artifact, "--optimizer-policy", "mask-0"], {
      cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
    });
    assert.equal(compiled.status, 0, compiled.error?.message ?? compiled.stderr);
    for (const source of [
      "_compile_locked_valid_source_graph(sources:[str]):\n    (sources:sources, source_count:sources.length())\n",
      "describe(items:[Widget]):\n    (size:items.measure(), originals:items)\n",
      "inspect(values:[num]):\n    (nested:values.view.size(), member:values.view)\n",
      "literal(input:[str]):\n    (value:2.5, grouped:(input), method:(input).size())\n",
      "invoke(data:[str]):\n    (applied:outer(data, inner(2)), chained:factory().view(data))\n",
      "_compile_locked_valid_source_graph(sources:[str]):\n    (sources:sources, source_count:sources.length() + 1)\n",
      "accumulate(numbers:[num]):\n    (value:(numbers.total()+1)+2.5+1.0, nested:call(numbers.size()+1, other(2+3)))\n",
      "# Unicode prefix: café\nrenamed(input:[Widget]):\n    (last:input.end+3, first:input.start)\n",
    ]) {
      const input = join(work, "input.vkf");
      writeFileSync(input, source);
      const lexed = spawnSync(join(bin, `vkf_lexer_cursor_smoke${suffix}`), ["--file", input, "<private-expression>"], {
        encoding: "utf8", timeout: 3_000, windowsHide: true,
      });
      assert.equal(lexed.status, 0, lexed.stderr);
      const parsed = spawnSync(join(bin, `vkf_parser_token_stream_smoke${suffix}`), [], {
        encoding: "utf8", input: lexed.stdout, timeout: 3_000, windowsHide: true,
      });
      assert.equal(parsed.status, 0, parsed.stderr);
      const expected = JSON.parse(parsed.stdout).body[0].body.fields;
      for (let field = 0; field < expected.length; field += 1) {
        const run = spawnSync(artifact, [], {
          cwd: work, encoding: "utf8", input: `${input}\n${field}\n`, timeout: 3_000, windowsHide: true,
        });
        assert.equal(run.status, 0, run.error?.message ?? run.stderr);
        const lines = run.stdout.trimEnd().split(/\r?\n/);
        assert.equal(lines[0], "true", run.stdout);
        const nodes = JSON.parse(lines[2]), args = JSON.parse(lines[3]), rows = JSON.parse(lines[4]);
        assert.equal(nodes.length % 5, 0);
        const bytes = Buffer.from(source);
        const nativeTokens = JSON.parse(lexed.stdout).tokens;
        const name = (token) => {
          assert.ok(Number.isInteger(token) && token >= 0 && (token + 1) * 6 <= rows.length);
          const [, start, stop, , line, column] = rows.slice(token * 6, token * 6 + 6);
          assert.ok(Number.isInteger(start) && Number.isInteger(stop) && start >= 0 && stop > start && stop <= bytes.length);
          assert.ok(nativeTokens.some((item) => item.location.line === line && item.location.column === column));
          return bytes.subarray(start, stop).toString();
        };
        const visited = new Set();
        // Test-only serialization of the private arena, never a VKF evaluator.
        const decode = (index) => {
          assert.ok(Number.isInteger(index) && index >= 0 && index * 5 < nodes.length);
          assert.ok(!visited.has(index), "private tree must not contain cycles/shared mutable nodes");
          visited.add(index);
          const [kind, token, left, right, value] = nodes.slice(index * 5, index * 5 + 5);
          name(token); // Every node retains an original, bounds-checked source token.
          const child = (childIndex) => {
            assert.ok(childIndex < index, "children must precede parents in the arena");
            return decode(childIndex);
          };
          if (kind === 1) return { kind: "identifier", name: name(token) };
          if (kind === 2) return { kind: "number_literal", value, is_integer_surface: right === 1 };
          if (kind === 3) return { kind: "attribute", name: name(token), object: child(left) };
          if (kind === 4) {
            assert.ok(Number.isInteger(right) && Number.isInteger(value) && right >= 0 && value >= 0 && right + value <= args.length);
            return { kind: "call", callee: child(left), args: args.slice(right, right + value).map(child) };
          }
          if (kind === 5) {
            assert.equal(rows[token * 6], 2);
            return { kind: "binary_op", op: "PLUS", left: child(left), right: child(right) };
          }
          if (kind === 6) return { ...child(left), parenthesized: true };
          assert.fail(`unknown private node ${kind}`);
        };
        assert.deepEqual(decode(Number(lines[1])), expected[field].value);
        assert.equal(visited.size, nodes.length / 5);
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("private expression parser preserves first errors and rejects malformed spans", () => {
  const workRoot = resolve(process.env.VKF_TEST_WORK_ROOT ?? join(root, "build/bootstrap-tests"));
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "private-expression-errors-"));
  try {
    for (const name of ["lexer", "parser"]) copyFileSync(join(root, `compiler/self_hosted/${name}.vkf`), join(work, `${name}.vkf`));
    copyFileSync(join(root, "compiler/self_hosted/stdlib/io.vkf"), join(work, "io.vkf"));
    const probe = join(work, "probe.vkf"), artifact = join(work, `probe${suffix}`);
    writeFileSync(probe, [
      "lexer: .lexer", "parser: .parser", "io: .io",
      "check(source:str, mode:str):",
      "    tape: lexer.tagged_numeric_function_token_tape(source)",
      "    [num] rows: tape.rows", "    start: 0", "    stop: rows.((tape.count - 1) * 6 + 2)",
      '    mode = "later-span"? rows.20: stop + 1',
      '    mode = "negative"? .start: -1',
      '    mode = "fractional"? .start: 0.5',
      '    mode = "past-end"? .stop+: 1',
      "    parser._bootstrap_expression_tree(source, rows, tape.count, start, stop)",
      "source: io.read_line()", "mode: io.read_line()", "tree: check(source, mode)",
      ":: tree.valid", ":: tree.error_index", "",
    ].join("\n"));
    const built = spawnSync(join(bin, `vkf-strict${suffix}`), ["-b", probe, "-o", artifact, "--optimizer-policy", "mask-0"], {
      cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
    });
    assert.equal(built.status, 0, built.error?.message ?? built.stderr);
    const cases = [
      ["items.+later", "later-span", 2],
      ["items.", "none", 2],
      ["outer(items, , later)", "none", 4],
      ["outer(items,)", "none", 4],
      ...["true", "false", "null"].map((source) => [source, "none", 0]),
      ...["true", "false", "null"].map((name) => [`items.${name}`, "none", 2]),
      ["items + * later", "none", 2],
      ["items +", "none", 2],
      ["(items + 1", "none", 4],
      ["outer(items] )", "none", 3],
      ...["negative", "fractional", "past-end"].map((mode) => ["items", mode, 0]),
    ];
    for (const [source, mode, expected] of cases) {
      const run = spawnSync(artifact, [], {
        cwd: work, encoding: "utf8", input: `${source}\n${mode}\n`, timeout: 3_000, windowsHide: true,
      });
      assert.equal(run.status, 0, run.error?.message ?? run.stderr);
      assert.equal(run.stdout.replace(/\r\n/g, "\n"), `false\n${expected}\n`, `${source}; ${mode}`);
      assert.equal(run.stderr, "");
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
