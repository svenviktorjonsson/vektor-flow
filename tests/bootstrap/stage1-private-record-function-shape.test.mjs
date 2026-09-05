import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const bin = resolve(process.env.VKF_NATIVE_BIN ?? join(root, "build/native-windows/bin"));
const suffix = process.platform === "win32" ? ".exe" : "";

test("private parser reads general vector-parameter record shape from runtime token tape", () => {
  const workRoot = resolve(process.env.VKF_TEST_WORK_ROOT ?? join(root, "build/bootstrap-tests"));
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "private-record-shape-"));
  try {
    for (const name of ["lexer", "parser"]) copyFileSync(join(root, `compiler/self_hosted/${name}.vkf`), join(work, `${name}.vkf`));
    copyFileSync(join(root, "compiler/self_hosted/stdlib/io.vkf"), join(work, "io.vkf"));
    const sourceFile = join(work, "probe.vkf"), artifact = join(work, `probe${suffix}`);
    writeFileSync(sourceFile, [
      "lexer: .lexer", "parser: .parser", "io: .io", "path: io.read_line()", "source: io.read_text(path)",
      "tape: lexer.tagged_numeric_function_token_tape(source)",
      "shape: parser._bootstrap_record_function_shape(tape.source, tape.rows, tape.count)",
      ":: shape.valid", ":: shape.name", ":: shape.parameter_starts", ":: shape.parameter_stops",
      ":: shape.type_starts", ":: shape.type_stops", ":: shape.field_starts", ":: shape.field_stops",
      ":: shape.expression_starts", ":: shape.expression_stops", "",
    ].join("\n"));
    const compiled = spawnSync(join(bin, `vkf-strict${suffix}`), ["-b", sourceFile, "-o", artifact, "--optimizer-policy", "mask-0"], {
      cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
    });
    assert.equal(compiled.status, 0, compiled.error?.message ?? compiled.stderr);
    const actualFunction = readFileSync(join(root, "compiler/self_hosted/compiler.vkf"), "utf8")
      .replace(/\r\n/g, "\n").match(/^_compile_locked_valid_source_graph\(sources:\[str\]\):\n[^\n]+/m)?.[0];
    assert.ok(actualFunction);
    const cases = [
      { source: `${actualFunction}\n`, expressions: ["sources", "sources.length()"] },
      { source: "summarize(items:[str]):\n    (size:items.length(), originals:items)\n", expressions: ["items.length()", "items"] },
      { source: "combine(left:[str], right:[str]):\n    (second:right, count:(left.length() + 1), first:left)\n", expressions: ["right", "(left.length() + 1)", "left"] },
      { source: "# λ location prefix\ncollect_42(values_7:[Widget]):\n    (nested:pair(values_7, [values_7, values_7]), original:values_7)\n", expressions: ["pair(values_7, [values_7, values_7])", "values_7"] },
    ];
    for (const fixture of cases) {
      const input = join(work, "input.vkf");
      writeFileSync(input, fixture.source);
      const lexed = spawnSync(join(bin, `vkf_lexer_cursor_smoke${suffix}`), ["--file", input, "<private-shape>"], {
        encoding: "utf8", timeout: 3_000, windowsHide: true,
      });
      assert.equal(lexed.status, 0, lexed.stderr);
      const parsed = spawnSync(join(bin, `vkf_parser_token_stream_smoke${suffix}`), [], {
        encoding: "utf8", input: lexed.stdout, timeout: 3_000, windowsHide: true,
      });
      assert.equal(parsed.status, 0, parsed.stderr);
      const expected = JSON.parse(parsed.stdout).body[0];
      assert.equal(expected.kind, "function_definition");
      assert.equal(expected.body.kind, "record_literal");
      const executed = spawnSync(artifact, [], {
        cwd: work, encoding: "utf8", input: `${input}\n`, timeout: 3_000, windowsHide: true,
      });
      assert.equal(executed.status, 0, executed.error?.message ?? executed.stderr);
      const lines = executed.stdout.trimEnd().split(/\r?\n/);
      assert.equal(lines[0], "true");
      assert.equal(lines[1], expected.name);
      const bytes = Buffer.from(fixture.source);
      const spans = (line) => {
        const starts = JSON.parse(lines[line]), stops = JSON.parse(lines[line + 1]);
        assert.equal(starts.length, stops.length);
        return starts.map((start, index) => {
          assert.ok(Number.isInteger(start) && Number.isInteger(stops[index]));
          assert.ok(start >= 0 && stops[index] > start && stops[index] <= bytes.length);
          const prefix = bytes.subarray(0, start).toString().split("\n");
          const location = { line: prefix.length, column: Array.from(prefix.at(-1)).length + 1 };
          assert.ok(JSON.parse(lexed.stdout).tokens.some((token) =>
            token.location.line === location.line && token.location.column === location.column),
          `span must begin at a canonical native token location: ${JSON.stringify(location)}`);
          return bytes.subarray(start, stops[index]).toString();
        });
      };
      assert.deepEqual(spans(2), expected.params.map((param) => param.name));
      assert.deepEqual(spans(4), expected.params.map((param) => param.type.name));
      assert.deepEqual(spans(6), expected.body.fields.map((field) => field.name));
      assert.deepEqual(spans(8), fixture.expressions);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("private shape parser rejects malformed spans and delimiters at their first token", () => {
  const workRoot = resolve(process.env.VKF_TEST_WORK_ROOT ?? join(root, "build/bootstrap-tests"));
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "private-shape-errors-"));
  try {
    for (const name of ["lexer", "parser"]) copyFileSync(join(root, `compiler/self_hosted/${name}.vkf`), join(work, `${name}.vkf`));
    copyFileSync(join(root, "compiler/self_hosted/stdlib/io.vkf"), join(work, "io.vkf"));
    const probe = join(work, "probe.vkf"), artifact = join(work, `probe${suffix}`);
    writeFileSync(probe, [
      "lexer: .lexer", "parser: .parser", "io: .io",
      "check(source:str, mode:str):",
      "    tape: lexer.tagged_numeric_function_token_tape(source)",
      "    [num] rows: tape.rows", "    count: tape.count",
      '    mode = "negative"? rows.1: -1',
      '    mode = "past-end"? rows.2: rows.((count - 1) * 6 + 2) + 1',
      '    mode = "reversed"? rows.2: rows.1 - 1',
      '    mode = "fractional"? rows.1: 0.5',
      '    mode = "empty-span"? rows.2: rows.1',
      '    mode = "count"? .count+: 1',
      '    mode = "extra-eof"?',
      '        .rows: rows & [5, rows.((count - 1) * 6 + 1), rows.((count - 1) * 6 + 2), 0, 3, 1]',
      '        .count+: 1',
      '    mode = "later-bad-span"? rows.38: rows.((count - 1) * 6 + 2) + 1',
      "    parser._bootstrap_record_function_shape(source, rows, count)",
      "path: io.read_line()", "mode: io.read_line()", "source: io.read_text(path)",
      "shape: check(source, mode)",
      ":: shape.valid", ":: shape.error_index", "",
    ].join("\n"));
    const compiled = spawnSync(join(bin, `vkf-strict${suffix}`), ["-b", probe, "-o", artifact, "--optimizer-policy", "mask-0"], {
      cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
    });
    assert.equal(compiled.status, 0, compiled.error?.message ?? compiled.stderr);
    const valid = "inspect(items:[str]):\n    (original:items)\n";
    const cases = [
      ...["negative", "past-end", "reversed", "fractional", "empty-span", "count"].map((mode) => ({ source: valid, mode, error: 0 })),
      { source: valid, mode: "extra-eof", error: 16 },
      { source: "inspect items:[str]):\n    (original:items)\n", mode: "later-bad-span", error: 1 },
      { source: "inspect(items:[str]):\n    (original:([items)]))\n", mode: "none", error: 16 },
      { source: "inspect(items:[str]):\n    (original:)\n", mode: "none", error: 13 },
      { source: "inspect(items:[str]):\n    ()\n", mode: "none", error: 11 },
    ];
    for (const fixture of cases) {
      const input = join(work, "input.vkf");
      writeFileSync(input, fixture.source);
      const run = spawnSync(artifact, [], {
        cwd: work, encoding: "utf8", input: `${input}\n${fixture.mode}\n`, timeout: 3_000, windowsHide: true,
      });
      assert.equal(run.status, 0, `${fixture.mode}: ${run.error?.message ?? run.stderr}`);
      assert.equal(run.stdout.replace(/\r\n/g, "\n"), `false\n${fixture.error}\n`, fixture.mode);
      assert.equal(run.stderr, "");
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
