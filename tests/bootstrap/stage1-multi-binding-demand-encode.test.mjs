import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const suffix = process.platform === "win32" ? ".exe" : "";
const nativeBin = process.env.VKF_NATIVE_BIN
  ? resolve(process.env.VKF_NATIVE_BIN)
  : join(root, "build", "050-b00", "bin", "Release");
const compiler = join(nativeBin, `vkf-strict${suffix}`);
const newline = process.platform === "win32" ? "\r\n" : "\n";

function runDemand({ sourceText, statementCount, resolver, expectedDiagnostic = null }) {
  const rootWork = join(root, ".work");
  mkdirSync(rootWork, { recursive: true });
  const work = mkdtempSync(join(rootWork, "i125-multi-binding-"));
  try {
    for (const name of [
      "lexer", "parser", "typed_ir", "machine_ir", "machine_ir_validation",
    ]) {
      copyFileSync(
        join(root, "compiler", "self_hosted", `${name}.vkf`),
        join(work, `${name}.vkf`),
      );
    }

    const source = join(work, "producer.vkf");
    const artifact = join(work, `producer${suffix}`);
    writeFileSync(source, [
      "lexer: .lexer",
      "parser: .parser",
      "typed: .typed_ir",
      "mir: .machine_ir",
      "validation: .machine_ir_validation",
      `tokens: lexer.tagged_statement_token_tape(${JSON.stringify(sourceText)})`,
      "parsed: parser.parse_tagged_token_tape(tokens.source, tokens.rows, tokens.count)",
      "typed_module: typed.typed_tagged_module(",
      "    parsed.module.body.source, parsed.module.body.rows, parsed.module.body.count",
      ")",
      "dynamic_module: mir.mir_tagged_module(",
      "    typed_module.source, typed_module.statements, typed_module.count",
      ")",
      `(dynamic_module.count = ${statementCount})?! "multi-binding parser did not reach EOF"`,
      `closed: mir.${resolver}`,
      "maximum: validation.machine_ir_tagged_statement_stack_maximum(",
      "    closed.instructions.0.kind, closed.instructions.1.kind,",
      "    closed.instructions.2.kind, closed.instructions.3.kind",
      ")",
      "module: mir.mir_assemble_closed_tagged_module(closed, maximum)",
      ":: module.schema",
      ":: module.version",
      ":: module.output_kind",
      ":: module.output_count",
      ":: module.entry.name",
      ":: module.entry.max_stack",
      ":: module.entry.instructions.0.kind",
      ":: module.entry.instructions.0.value",
      ":: module.entry.instructions.1.kind",
      ":: module.entry.instructions.1.value",
      ":: module.entry.instructions.2.kind",
      ":: module.entry.instructions.3.kind",
      "",
    ].join("\n"), "utf8");
    const compiled = spawnSync(
      compiler,
      ["-b", source, "-o", artifact, "--diagnostics", "--optimizer-policy", "mask-0"],
      { cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true },
    );
    assert.equal(compiled.status, 0, compiled.stderr);

    const expected = [
      "vektorflow.machine_ir", "4", "f64", "1", "$entry", "2",
      "push_f64", "31", "push_f64", "1", "add_f64", "return_f64",
    ].join(newline) + newline;
    const oracle = join(work, "oracle.txt");
    writeFileSync(oracle, expected, "utf8");
    const output = join(work, `selected${suffix}`);
    const provenance = join(work, "provenance.json");
    const dispatched = spawnSync(
      compiler,
      [
        "--vkf-internal-stage-component",
        "machine_ir.closed_binding.typed_module_pipeline",
        artifact, source, oracle, output, provenance,
      ],
      { cwd: root, encoding: "utf8", timeout: 10_000, windowsHide: true },
    );
    if (expectedDiagnostic !== null) {
      assert.notEqual(dispatched.status, 0, "unresolved dependency was encoded");
      assert.match(dispatched.stderr, /VKF stage component failed/);
      assert.ok(readFileSync(artifact).includes(Buffer.from(expectedDiagnostic)));
      return;
    }
    assert.equal(dispatched.status, 0, dispatched.stderr);

    const executed = spawnSync(output, [], {
      cwd: work, encoding: "utf8", timeout: 3_000, windowsHide: true,
    });
    assert.equal(executed.status, 0, executed.stderr);
    assert.equal(executed.stdout, `32${newline}`);
    assert.equal(JSON.parse(readFileSync(provenance, "utf8")).exact_oracle_match, true);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

test("a later binding-expression pair is demanded and encoded from a multi-pair module", () => {
  runDemand({
    sourceText: "unused: 10\nunused + 2\nvalue: 31\nvalue + 1",
    statementCount: 4,
    resolver: "mir_tagged_closed_statement_from_previous_binding(dynamic_module, 3)",
  });
});

test("demand searches past an unrelated binding for the matching prior dependency", () => {
  runDemand({
    sourceText: "value: 31\nother: 10\nvalue + 1",
    statementCount: 3,
    resolver: "mir_tagged_closed_statement_from_prior_binding(dynamic_module, 2)",
  });
});

test("prior binding demand selects the nearest matching rebind", () => {
  runDemand({
    sourceText: "value: 5\nvalue: 31\nother: 10\nvalue + 1",
    statementCount: 4,
    resolver: "mir_tagged_closed_statement_from_prior_binding(dynamic_module, 3)",
  });
});

test("prior binding demand rejects an expression with no matching dependency", () => {
  runDemand({
    sourceText: "other: 31\nvalue + 1",
    statementCount: 2,
    resolver: "mir_tagged_closed_statement_from_prior_binding(dynamic_module, 1)",
    expectedDiagnostic: "closed Machine IR expression has no matching prior binding",
  });
});
