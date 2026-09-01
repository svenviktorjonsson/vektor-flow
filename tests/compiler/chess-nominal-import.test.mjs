import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const nativeBin = process.env.VKF_NATIVE_COMPILER_BIN;
const nativeDriver = process.env.VKF_NATIVE_DRIVER;
const workRoot = path.join(repositoryRoot, ".work", `u16b-chess-${process.pid}`);

after(() => rm(workRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));

function executable(directory, name) {
  assert.ok(directory, "VKF_NATIVE_COMPILER_BIN must name the focused compiler directory");
  return path.join(directory, process.platform === "win32" ? `${name}.exe` : name);
}

function run(command, args = [], input, timeout = 120_000) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    input,
    timeout,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || `${command} failed without diagnostics`);
  return result.stdout;
}

function parseSource(source) {
  const tokens = run(executable(nativeBin, "vkf_lexer_cursor_smoke"), [source]);
  return JSON.parse(run(executable(nativeBin, "vkf_parser_token_stream_smoke"), [], tokens));
}

test("uppercase vector values remain bindings while fixed-vector aliases remain types", () => {
  const parsed = parseSource([
    "RoleNames: [\"none\", \"pawn\", \"king\"]",
    "BackRanks: [1, 8]",
    "RoleVector : [str:3]",
  ].join("\n"));
  assert.deepEqual(parsed.body.map(({ kind, name, target }) => ({
    kind,
    name: name ?? target?.name,
  })), [{
    kind: "bind",
    name: "RoleNames",
  }, {
    kind: "bind",
    name: "BackRanks",
  }, {
    kind: "type_alias",
    name: "RoleVector",
  }]);
});

test("foldered chess types import Piece into a native executable", {
  skip: process.platform !== "win32",
  timeout: 180_000,
}, async () => {
  assert.ok(nativeDriver, "VKF_NATIVE_DRIVER must name the focused strict native driver");
  const libraryDirectory = path.join(workRoot, "lib");
  await mkdir(libraryDirectory, { recursive: true });
  await copyFile(
    path.join(repositoryRoot, "examples", "programs", "vkf_chess_3d", "lib", "types.vkf"),
    path.join(libraryDirectory, "types.vkf"),
  );
  const source = path.join(workRoot, "nominal-smoke.vkf");
  await writeFile(source, [
    ": .lib.types",
    "piece: (side:1, role:6, file:5, rank:1, captured:false, tray_rank:0, has_moved:false)",
    ":: piece.side",
    ":: piece.role",
    ":: piece.file",
  ].join("\n"), "utf8");
  const artifact = path.join(workRoot, "nominal-smoke.exe");
  const buildOutput = run(nativeDriver, ["-b", source, "-o", artifact]);
  assert.match(buildOutput, /^Built /mu);
  assert.deepEqual(run(artifact).trim().split(/\r?\n/u), ["1", "6", "5"]);
});
