import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const suffix = process.platform === "win32" ? ".exe" : "";
const nativeBin = process.env.VKF_NATIVE_BIN
  ? resolve(process.env.VKF_NATIVE_BIN)
  : join(root, "build", "050-b00", "bin", "Release");
const compiler = join(nativeBin, `vkf-strict${suffix}`);

function makeWork(prefix) {
  const rootWork = join(root, ".work");
  mkdirSync(rootWork, { recursive: true });
  const work = mkdtempSync(join(rootWork, prefix));
  for (const name of [
    "lexer", "parser", "typed_ir", "machine_ir", "machine_ir_validation",
  ]) {
    copyFileSync(
      join(root, "compiler", "self_hosted", `${name}.vkf`),
      join(work, `${name}.vkf`),
    );
  }
  return work;
}

function compile(work, lines) {
  const harness = join(work, "probe.vkf");
  const artifact = join(work, `probe${suffix}`);
  writeFileSync(harness, [...lines, ""].join("\n"), "utf8");
  const compiled = spawnSync(
    compiler, ["-b", harness, "-o", artifact, "--optimizer-policy", "mask-0"],
    { cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true },
  );
  assert.equal(compiled.status, 0, compiled.stderr);
  return artifact;
}

test("dynamic first and last statements pass self-hosted stack validation", () => {
  const work = makeWork("i121-dynamic-validation-");
  try {
    const source = Array.from({ length: 32 }, (_, index) => `value${index}+${index + 1}`).join("\n");
    const artifact = compile(work, [
      "lexer: .lexer",
      "parser: .parser",
      "typed: .typed_ir",
      "mir: .machine_ir",
      "validation: .machine_ir_validation",
      `tokens: lexer.tagged_statement_token_tape(${JSON.stringify(source)})`,
      "parsed: parser.parse_tagged_token_tape(tokens.source, tokens.rows, tokens.count)",
      "typed_module: typed.typed_tagged_module(",
      "    parsed.module.body.source, parsed.module.body.rows, parsed.module.body.count",
      ")",
      "machine_module: mir.mir_tagged_module(",
      "    typed_module.source, typed_module.statements, typed_module.count",
      ")",
      "first: mir.mir_tagged_module_statement(machine_module, 0)",
      "last: mir.mir_tagged_module_statement(machine_module, 31)",
      ":: validation.machine_ir_tagged_statement_stack_maximum(",
      "    first.instructions.0.kind, first.instructions.1.kind,",
      "    first.instructions.2.kind, first.instructions.3.kind",
      ")",
      ":: validation.machine_ir_tagged_statement_stack_maximum(",
      "    last.instructions.0.kind, last.instructions.1.kind,",
      "    last.instructions.2.kind, last.instructions.3.kind",
      ")",
      ":: machine_module.count",
    ]);
    const executed = spawnSync(artifact, [], {
      cwd: work, encoding: "utf8", timeout: 3_000, windowsHide: true,
    });
    assert.equal(executed.status, 0, executed.stderr);
    assert.deepEqual(executed.stdout.trim().split(/\r?\n/u), ["2", "2", "32"]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("dynamic stack validation rejects underflow before assembly", () => {
  const work = makeWork("i121-dynamic-underflow-");
  try {
    const artifact = compile(work, [
      "validation: .machine_ir_validation",
      ":: validation.machine_ir_tagged_statement_stack_maximum(",
      "    \"add_f64\", \"push_f64\", \"load_local\", \"return_f64\"",
      ")",
    ]);
    const executed = spawnSync(artifact, [], {
      cwd: work, encoding: "utf8", timeout: 3_000, windowsHide: true,
    });
    assert.ok(readFileSync(artifact).includes(Buffer.from("machine IR stack underflow")));
    assert.notEqual(executed.status, 0);
    assert.equal(executed.stdout, "");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
