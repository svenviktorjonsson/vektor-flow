import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), "..", "..",
);

const executableName = (name) => process.platform === "win32" ? `${name}.exe` : name;
const firstExisting = (paths) => paths.find((candidate) => candidate && existsSync(candidate));

function nativeBin() {
  return firstExisting([
    process.env.VKF_NATIVE_BIN && path.resolve(process.env.VKF_NATIVE_BIN),
    path.join(repositoryRoot, ".w", "wasm-scene-build", "bin", "Release"),
    path.join(repositoryRoot, "build", "native-compiler", "bin", "Release"),
  ]);
}

test("retained mesh geometry is compiler-packed in WASM linear memory", async () => {
  const bin = nativeBin();
  assert.ok(bin, "build the native compiler or set VKF_NATIVE_BIN");
  const compiler = path.join(bin, executableName("vkf"));
  const wasmEmitter = path.join(bin, executableName("vkf_wasm_artifact_smoke"));
  for (const required of [compiler, wasmEmitter]) {
    assert.ok(existsSync(required), `compiler input is missing: ${required}`);
  }

  const work = mkdtempSync(path.join(os.tmpdir(), "vkf-wasm-scene-arena-"));
  const source = path.join(work, "scene.vkf");
  writeFileSync(source, [
    "native_scene: (",
    '    kind: "scene_3d",',
    '    frame_id: "arena_frame",',
    "    meshes: [(id: \"triangle\", kind: \"field_mesh\",",
    "        vertices: [0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0,",
    "                   1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0,",
    "                   0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0],",
    "        indices: [0, 1, 2])],",
    ")",
    "",
  ].join("\n"));

  const result = spawnSync(compiler, [
    "--source", source,
    "--wasm-artifact", wasmEmitter,
    "--emit-wasm",
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `WASM scene compilation failed:\n${result.stderr || result.stdout}`);
  const summary = JSON.parse(String(result.stdout).trim().split(/\r?\n/u).filter(Boolean).at(-1));
  const wasmBytes = readFileSync(summary.wasm_artifact_path);
  const manifest = JSON.parse(readFileSync(summary.wasm_manifest_path, "utf8"));
  const arena = manifest.runtime_surface?.retained_scene_arena;
  assert.ok(arena && typeof arena === "object", "manifest must describe the retained scene arena");

  const instance = await WebAssembly.instantiate(wasmBytes, {});
  const exports = instance.instance.exports;
  for (const key of [
    "metadata_ptr_export", "metadata_len_export", "arena_ptr_export", "arena_len_export",
  ]) {
    assert.equal(typeof arena[key], "string", `retained_scene_arena is missing ${key}`);
    assert.equal(typeof exports[arena[key]], "function", `WASM is missing ${arena[key]}`);
  }
  const metadataPtr = exports[arena.metadata_ptr_export]();
  const metadataLen = exports[arena.metadata_len_export]();
  const arenaPtr = exports[arena.arena_ptr_export]();
  const arenaLen = exports[arena.arena_len_export]();
  assert.ok(metadataLen > 0, "scene metadata must be present in WASM memory");
  assert.equal(arenaLen, 30 * 4 + 3 * 4, "arena must contain packed f32 vertices and u32 indices");

  const memory = new Uint8Array(exports.memory.buffer);
  const metadataText = new TextDecoder().decode(memory.subarray(metadataPtr, metadataPtr + metadataLen));
  assert.doesNotMatch(metadataText, /"vertices"\s*:\s*\[/u);
  assert.doesNotMatch(metadataText, /"indices"\s*:\s*\[/u);
  const metadata = JSON.parse(metadataText);
  assert.equal(metadata.schema, "vektor-flow/retained-scene-arena");
  assert.equal(metadata.version, 1);
  const mesh = metadata.scene.meshes[0];
  assert.deepEqual(mesh.vertices, { byte_offset: 0, length: 30, storage: "float32" });
  assert.deepEqual(mesh.indices, { byte_offset: 120, length: 3, storage: "uint32" });

  assert.deepEqual(
    [...new Float32Array(exports.memory.buffer, arenaPtr + mesh.vertices.byte_offset, mesh.vertices.length)],
    [
      0, 0, 0, 0, 0, 1, 1, 0, 0, 1,
      1, 0, 0, 0, 0, 1, 0, 1, 0, 1,
      0, 1, 0, 0, 0, 1, 0, 0, 1, 1,
    ],
  );
  assert.deepEqual(
    [...new Uint32Array(exports.memory.buffer, arenaPtr + mesh.indices.byte_offset, mesh.indices.length)],
    [0, 1, 2],
  );
});
