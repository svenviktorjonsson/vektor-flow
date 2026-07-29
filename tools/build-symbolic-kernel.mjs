import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const outputDirectory = join(root, "web", "vf-ui", "artifacts");
const wasmTarget = join(outputDirectory, "vkf-symbolic-kernel.wasm");
const manifestTarget = join(outputDirectory, "vkf-symbolic-kernel.json");
const work = mkdtempSync(join(tmpdir(), "vkf-symbolic-"));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: options.binary ? null : "utf8",
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    throw new Error(`${command} failed with status ${result.status}`);
  }
  return result.stdout;
}

function findCompiler() {
  const candidates = [
    process.env.CXX,
    process.platform === "win32" ? "clang++" : "g++",
    "clang++",
    "g++",
    "c++",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0) {
      return candidate;
    }
  }
  throw new Error("a C++17 compiler is required to build the symbolic kernel");
}

function compile(compiler, output, ...sources) {
  run(compiler, [
    "-std=c++17",
    "-Wall",
    "-Wextra",
    "-pedantic",
    "-I",
    root,
    "-I",
    join(root, "native", "VfOverlay"),
    ...sources.map((source) => join(root, source)),
    "-o",
    output,
  ]);
}

function assertIdentical(actual, expected, label) {
  const generated = readFileSync(actual);
  const committed = readFileSync(expected);
  if (!generated.equals(committed)) {
    throw new Error(`${label} is stale; run npm run build:symbolic-kernel`);
  }
}

try {
  const compiler = findCompiler();
  const lexer = join(work, process.platform === "win32" ? "lexer.exe" : "lexer");
  const parser = join(work, process.platform === "win32" ? "parser.exe" : "parser");
  const lower = join(work, process.platform === "win32" ? "lower.exe" : "lower");
  const artifact = join(work, process.platform === "win32" ? "artifact.exe" : "artifact");
  const json = "native/VfOverlay/vf/json.cpp";
  compile(compiler, lexer, "compiler/native/vkf_lexer_cursor_smoke.cpp");
  compile(compiler, parser, "compiler/native/vkf_parser_token_stream_smoke.cpp", json);
  compile(compiler, lower, "compiler/native/vkf_ast_to_ir_smoke.cpp", json);
  compile(compiler, artifact, "compiler/native/vkf_symbolic_kernel_artifact.cpp", json);

  const source = join(root, "compiler", "self_hosted", "symbolic_expression.vkf");
  const tokens = run(lexer, ["--file", source, source]);
  const ast = run(parser, [], { input: tokens });
  const typed = run(lower, [], { input: ast });
  const typedPath = join(work, "symbolic.typed.json");
  const wasmPath = join(work, basename(wasmTarget));
  const manifestPath = join(work, basename(manifestTarget));
  writeFileSync(typedPath, typed, "utf8");
  run(artifact, [
    "--typed-ir",
    typedPath,
    "--wasm",
    wasmPath,
    "--manifest",
    manifestPath,
    "--entry",
    "symbolic_compile",
  ]);

  if (check) {
    assertIdentical(wasmPath, wasmTarget, "symbolic WASM");
    assertIdentical(manifestPath, manifestTarget, "symbolic manifest");
  } else {
    mkdirSync(outputDirectory, { recursive: true });
    writeFileSync(wasmTarget, readFileSync(wasmPath));
    writeFileSync(manifestTarget, readFileSync(manifestPath));
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
