import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const nativeBin = process.env.VKF_NATIVE_COMPILER_BIN;
const fixture = path.join(repositoryRoot, "examples", "115_world_embedding_native.vkf");

function tool(name) {
  assert.ok(nativeBin, "VKF_NATIVE_COMPILER_BIN must name the focused native build directory");
  return path.join(nativeBin, process.platform === "win32" ? `${name}.exe` : name);
}

function run(name, args = [], input) {
  const result = spawnSync(tool(name), args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    input,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || `${name} failed without diagnostics`);
  return result.stdout;
}

function lowerFailure(source) {
  const tokens = run("vkf_lexer_cursor_smoke", [source]);
  const ast = run("vkf_parser_token_stream_smoke", [], tokens);
  const result = spawnSync(tool("vkf_ast_to_ir_smoke"), [], {
    cwd: repositoryRoot,
    encoding: "utf8",
    input: ast,
    windowsHide: true,
  });
  assert.notEqual(result.status, 0, "invalid World program unexpectedly lowered");
  return `${result.stdout}\n${result.stderr}`;
}

test("the canonical VKF World retains one object and appends its presentation without stepping", async () => {
  const source = await readFile(fixture, "utf8");
  const tokens = run("vkf_lexer_cursor_smoke", [source]);
  const ast = run("vkf_parser_token_stream_smoke", [], tokens);
  const typedIr = JSON.parse(run("vkf_ast_to_ir_smoke", [], ast));

  assert.match(source, /view: d\.append_world\(w, embedding\)/u);
  assert.deepEqual(typedIr.__vf_internal_world, {
    version: 1,
    worlds: [{
      id: 0,
      dimension: 2,
      em: false,
      gravity: false,
      rigid_collisions: false,
    }],
    operations: [{ kind: "add", world_id: 0, object_id: 0, object_type: "Particle" }],
  });
  assert.deepEqual(typedIr.ui_program.operations.map(({ kind }) => kind), [
    "add",
    "push",
    "show",
  ]);
  const add = typedIr.ui_program.operations[0];
  assert.deepEqual(add.source, {
    kind: "world_embedding",
    world_id: 0,
    object_id: 0,
    object_type: "Particle",
    embedding: "embedding",
  });
  assert.deepEqual(
    add.channels.map(({ value: _value, ...channel }) => channel),
    [
      { name: "p", semantic_axes: ["u", "c"], shape: [1, 2], value_kind: "position" },
      { name: "c", semantic_axes: ["u", "c"], shape: [1, 4], broadcast_axes: [], value_kind: "rgba" },
      { name: "s", semantic_axes: ["u"], shape: [1], broadcast_axes: [], measure_space: "data", value_kind: "size" },
    ],
  );
  assert.equal(typedIr.ui_program.result, "View");
});

test("append_world rejects an embedding whose fixed channel shape is incompatible", () => {
  const diagnostic = lowerFailure(`
: .ui.display
: .physics
Particle(position:[num:2], mass:num): (position:position, mass:mass)
embedding(particle:Particle):
    (p_u:[particle.position, particle.position], c_uc:[[1, 0, 0, 1]], s_u:[2], s_mode:data)
w: World(dim:2)
w.add(Particle([0, 1], 1))
d: Display(dim:2)
d.append_world(w, embedding)
`);
  assert.match(diagnostic, /World embedding p_u has an incompatible fixed numeric shape/u);
});

test("append_world rejects a World with no matching embedding overload", () => {
  const diagnostic = lowerFailure(`
: .ui.display
: .physics
Particle(position:[num:2], mass:num): (position:position, mass:mass)
embedding(value:int):
    (p_u:[[0, 1]], c_uc:[[1, 0, 0, 1]], s_u:[2], s_mode:data)
w: World(dim:2)
w.add(Particle([0, 1], 1))
d: Display(dim:2)
d.append_world(w, embedding)
`);
  assert.match(diagnostic, /append_world found no matching embedding overload/u);
});
