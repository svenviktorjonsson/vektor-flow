import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

function executable(directory, name) {
  return path.join(directory, process.platform === "win32" ? `${name}.exe` : name);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
    ...options,
  });
  assert.equal(result.status, 0, result.stderr || `${command} failed without diagnostics`);
  return result.stdout;
}

function compileSource(source) {
  const nativeBin = process.env.VKF_NATIVE_COMPILER_BIN;
  assert.ok(nativeBin, "VKF_NATIVE_COMPILER_BIN must name the focused compiler build");
  const tokens = run(executable(nativeBin, "vkf_lexer_cursor_smoke"), [source]);
  const ast = run(executable(nativeBin, "vkf_parser_token_stream_smoke"), [], { input: tokens });
  return JSON.parse(run(executable(nativeBin, "vkf_ast_to_ir_smoke"), [], { input: ast }));
}

function binding(module, name) {
  return module.body.find((candidate) =>
    candidate.kind === "store_binding" && candidate.name === name);
}

test("literal owner.get returns the matching concrete retained identity or null", () => {
  const typedIr = compileSource([
    ": .ui.display",
    "display: Display(dim:2)",
    "frame: display.add_frame(pos:[0, 0], size:[1, 1])",
    "button: Button(id:\"save\")",
    "found: frame.get(\"save\")",
    "missing: frame.get(\"missing\")",
  ].join("\n"));

  assert.equal(binding(typedIr, "button").value.type, "ui_component<Button>");
  assert.equal(binding(typedIr, "button").value.id, "save");
  assert.deepEqual(
    {
      kind: binding(typedIr, "found").value.kind,
      ownerKind: binding(typedIr, "found").value.owner_kind,
      id: binding(typedIr, "found").value.id.value,
      type: binding(typedIr, "found").type,
    },
    {
      kind: "ui_owner_get",
      ownerKind: "Frame",
      id: "save",
      type: "Button|null",
    },
  );
  assert.equal(binding(typedIr, "missing").type, "null");
});

test("dynamic owner.get returns the structural union of possible concrete identities plus null", () => {
  const typedIr = compileSource([
    ": .ui.display",
    "display: Display(dim:2)",
    "frame: display.add_frame(pos:[0, 0], size:[1, 1])",
    "save: Button(id:\"save\")",
    "panel: Div(id:\"panel\")",
    "lookup(owner:Frame<2>, name:str):",
    "    owner.get(name)",
  ].join("\n"));

  const lookup = typedIr.body.find(({ kind, name }) =>
    kind === "function" && name === "lookup");
  assert.ok(lookup, "lookup function must lower");
  assert.equal(
    lookup.return_type,
    "Button|Div|null",
  );
});

test("numeric retained ids narrow to geometry hierarchy identities plus null", () => {
  const typedIr = compileSource([
    ": .ui.display",
    "display: Display(dim:2)",
    "found: display.get(7)",
  ].join("\n"));

  assert.equal(binding(typedIr, "found").type, "Frame<2>|View|Layer|null");
});

test("static HTML lookup remains a concrete component union without an opaque wrapper", () => {
  const typedIr = compileSource([
    ": .ui.display",
    "display: Display(dim:2)",
    "frame: display.add_frame(pos:[0, 0], size:[1, 1])",
    'frame.load("ui/main.html")',
    'found: frame.get("save")',
  ].join("\n"));

  const members = binding(typedIr, "found").type.split("|");
  assert.ok(members.includes("Button"));
  assert.ok(members.includes("Div"));
  assert.equal(members.at(-1), "null");
  assert.equal(members.some((member) => member.includes("ui_component<")), false);
  assert.equal(members.includes("any"), false);
});
