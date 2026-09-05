import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const suffix = process.platform === "win32" ? ".exe" : "";
const nativeBin = resolve(process.env.VKF_NATIVE_BIN ?? join(root, "build/native-windows/bin"));
const compiler = join(nativeBin, `vkf-strict${suffix}`);
const oracle = join(nativeBin, `vkf_lexer_cursor_smoke${suffix}`);
const lexerSource = resolve(process.env.VKF_LEXER_SOURCE ?? join(root, "compiler/self_hosted/lexer.vkf"));

function checkTokenProducers(source, functionNewlines, apis = [
  "tagged_numeric_function_token_tape", "tagged_statement_token_tape",
]) {
  const workRoot = resolve(process.env.VKF_TEST_WORK_ROOT ?? join(root, "build/bootstrap-tests"));
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "comment-producer-"));
  try {
    copyFileSync(lexerSource, join(work, "lexer.vkf"));
    copyFileSync(join(root, "compiler/self_hosted/stdlib/io.vkf"), join(work, "io.vkf"));
    const inputPath = join(work, "input.vkf");
    writeFileSync(inputPath, source);
    const canonical = spawnSync(oracle, ["--file", inputPath, "<comments>"], {
      cwd: work, encoding: "utf8", timeout: 3_000, windowsHide: true,
    });
    assert.equal(canonical.status, 0, canonical.stderr);
    // These existing tape APIs have distinct layout-token contracts. Compare
    // their ordinary tokens against the canonical lexer, then separately check
    // byte spans and newline/EOF preservation; do not claim full-stream parity.
    const kinds = { 1: "IDENT", 2: "PLUS", 3: "NUMBER", 25: "STRING" };
    const expected = JSON.parse(canonical.stdout).tokens
      .filter((token) => Object.values(kinds).includes(token.kind))
      .map((token) => [token.kind, token.value, token.location.line, token.location.column]);
    for (const api of apis) {
      const harness = join(work, `${api}.vkf`);
      const artifact = join(work, `${api}${suffix}`);
      writeFileSync(harness, [
        "lexer: .lexer", "io: .io", "path: io.read_line()", "source: io.read_text(path)",
        `tape: lexer.${api}(source)`, ":: tape.rows", "",
      ].join("\n"));
      const built = spawnSync(compiler, ["-b", harness, "-o", artifact, "--optimizer-policy", "mask-0"], {
        cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
      });
      assert.equal(built.status, 0, `${api}: ${built.error?.message ?? built.stderr}`);
      const run = spawnSync(artifact, [], {
        cwd: work, encoding: "utf8", input: `${inputPath}\n`, timeout: 3_000, windowsHide: true,
      });
      assert.equal(run.status, 0, `${api}: ${run.error?.message ?? run.stderr}\n${run.stdout}`);
      const values = JSON.parse(run.stdout);
      const rows = Array.from({ length: values.length / 6 }, (_, index) => values.slice(index * 6, index * 6 + 6));
      const bytes = Buffer.from(source);
      assert.deepEqual(rows.filter(([kind]) => kind in kinds).map(([kind, start, stop, value, line, column]) => [
        kinds[kind], kind === 1 ? bytes.subarray(start, stop).toString()
          : kind === 3 ? value
          : kind === 25 ? JSON.parse(bytes.subarray(start, stop).toString())
          : null, line, column,
      ]), expected, api);
      const lines = source.split("\n");
      assert.deepEqual(rows.at(-1), [5, bytes.length, bytes.length, 0, lines.length, lines.at(-1).length + 1], api);
      assert.equal(rows.filter(([kind]) => kind === 4).length,
        api === "tagged_statement_token_tape" ? 2 : functionNewlines, api);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

test("compiled VKF token producers preserve tokens and locations across line comments", () => {
  const header = readFileSync(join(root, "compiler/self_hosted/lexer.vkf"), "utf8")
    .replace(/\r\n/g, "\n").split("\n\n", 1)[0];
  const source = `${header}\n\nalpha+2 # inline λ\nbeta+3 # EOF`;
  checkTokenProducers(source, source.split("\n").length - 1);
});

test("compiled VKF token producers preserve tokens across multiline comments", () => {
  checkTokenProducers("## header\nλ ##alpha+##middle\ncomment##2\nbeta+3 ##EOF##", 1);
});

test("comment markers inside strings remain string contents", () => {
  checkTokenProducers('"#"+"##" # EOF', 0, ["tagged_numeric_function_token_tape"]);
});

test("compiled VKF comment errors preserve the canonical message through error propagation", () => {
  const workRoot = resolve(process.env.VKF_TEST_WORK_ROOT ?? join(root, "build/bootstrap-tests"));
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "comment-error-"));
  try {
    copyFileSync(lexerSource, join(work, "lexer.vkf"));
    copyFileSync(join(root, "compiler/self_hosted/stdlib/io.vkf"), join(work, "io.vkf"));
    for (const api of ["tagged_numeric_function_token_tape", "tagged_statement_token_tape"]) {
      const harness = join(work, `${api}.vkf`);
      const artifact = join(work, `${api}${suffix}`);
      writeFileSync(harness, [
        "lexer: .lexer", "io: .io", "errors: .errors",
        "path: io.read_line()", "source: io.read_text(path)", 'message: ""',
        `lexer.${api}(source)!?`,
        "    errors.AssertionError => .message: $.message", ":: message", "",
      ].join("\n"));
      const built = spawnSync(compiler, ["-b", harness, "-o", artifact, "--optimizer-policy", "mask-0"], {
        cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
      });
      assert.equal(built.status, 0, `${api}: ${built.error?.message ?? built.stderr}`);
      for (const source of ["##", "## unclosed\nλ", "alpha+2 ## unclosed #"]) {
        const inputPath = join(work, "input.vkf");
        writeFileSync(inputPath, source);
        const canonical = spawnSync(oracle, ["--file", inputPath, "<comments>"], {
          cwd: work, encoding: "utf8", timeout: 3_000, windowsHide: true,
        });
        assert.notEqual(canonical.status, 0);
        assert.equal(canonical.stderr.replace(/\r\n/g, "\n"), "Unterminated multiline comment\n");
        const run = spawnSync(artifact, [], {
          cwd: work, encoding: "utf8", input: `${inputPath}\n`, timeout: 3_000, windowsHide: true,
        });
        assert.equal(run.status, 0, `${api}: ${run.error?.message ?? run.stderr}`);
        assert.equal(run.stderr, "");
        assert.equal(run.stdout.replace(/\r\n/g, "\n"), canonical.stderr.replace(/\r\n/g, "\n"), api);
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
