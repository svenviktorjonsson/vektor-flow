import assert from "node:assert/strict";
import test from "node:test";
import { loadSharedFrontend } from "../../tools/verify-browser-frontend-parity.mjs";

// Source-level prerequisites, not runtime-effect proof. The accompanying packet
// specifies the native/WASM execution gates still required after these turn green.
const compiler = loadSharedFrontend("build/shared-ui-probe");
const productionCompiler = loadSharedFrontend();
const setup = `: .ui.display
:.math
display: Display()
frame: display.add_frame(pos:[0.08,0.08], size:[0.84,0.84])
x: 0.1[..100]
y: sin(x)
`;
const mark = `mark(label:int, values:[num:101]) -> [num:101]:
    :: label
    values
`;

async function compile(source) {
  const api = await compiler;
  const native = api.native(source);
  const wasm = api.browser(source);
  assert.deepEqual(wasm, native, "native and WASM must lower the same authored source");
  assert.equal(native.ok, true, native.message);
  const production = await productionCompiler;
  const canonical = production.native(source);
  assert.deepEqual(production.browser(source), canonical);
  assert.deepEqual({ ok: native.ok, typed_ir: native.typed_ir }, canonical,
    "private inspection must not change the canonical serialized typed IR");
  assert.equal(JSON.stringify(native.typed_ir), JSON.stringify(canonical.typed_ir),
    "canonical JSON key order and values remain byte-for-byte identical");
  assert.equal(Object.hasOwn(canonical, "execution_ir"), false,
    "the production response must not expose compiler-private effects");
  assert.equal(nodes(canonical.typed_ir).some(({ value }) => value.kind === "retained_ui_effect"), false);
  assert.deepEqual(erasePrivateEffects(native.execution_ir), native.typed_ir,
    "private effect wrappers must preserve every canonical value and metadata field");
  return native.execution_ir;
}

function erasePrivateEffects(value) {
  if (!value || typeof value !== "object") return value;
  if (value.kind === "retained_ui_effect") return erasePrivateEffects(value.result);
  if (Array.isArray(value)) return value.map(erasePrivateEffects);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, erasePrivateEffects(child)]));
}

function nodes(value, ancestors = []) {
  if (!value || typeof value !== "object") return [];
  const own = Array.isArray(value) ? [] : [{ value, ancestors }];
  return own.concat(Object.values(value).flatMap(child => nodes(child, [...ancestors, value])));
}

function effects(ir, kind) {
  // Never traverse ui_program: its expressions are metadata, not execution sites.
  const found = nodes(ir.body).filter(({ value }) => value.kind === "retained_ui_effect");
  return found.filter(({ value }) => kind === "display"
    ? Object.hasOwn(value, "display_id")
    : ir.ui_program.operations[value.operation_index]?.kind === kind);
}

function requireAdds(ir, count, behavior) {
  const found = effects(ir, "add");
  assert.equal(found.length, count,
    `${behavior}: retained calls must remain at their typed-body execution sites, not disappear into handle constants`);
  return found;
}

test("UI snapshot prerequisites retain each add around an ordinary binding update", async () => {
  const ir = await compile(setup + `frame.add(x_u:x, y_u:y, id:"before", color:[0.12,0.72,1,1])
.y: y + 1
frame.add(x_u:x, y_u:y, id:"after", color:[0.12,0.72,1,1])
`);
  const additions = requireAdds(ir, 2, "before/after snapshots");
  const body = ir.body;
  const positions = additions.map(({ ancestors }) => body.findIndex(item => ancestors.includes(item)));
  const update = body.findIndex(item => item.kind === "store_binding" && item.name === "y" && item.update);
  assert.ok(positions[0] < update && update < positions[1], "capture values on the correct side of the update");
  assert.notEqual(additions[0].value.operation_index, additions[1].value.operation_index);
});

test("UI named operands retain authored order rather than property-map order", async () => {
  const ir = await compile(mark + setup + `frame.add(y_u:mark(1,y), x_u:mark(2,x), id:"ordered", color:[0.12,0.72,1,1])
`);
  const [{ value }] = requireAdds(ir, 1, "ordered operand effects");
  assert.deepEqual(value.arguments.map(argument => argument.name), ["y_u", "x_u", "id", "color"]);
  assert.equal(value.arguments[0].value.kind, "call");
  assert.equal(value.arguments[1].value.kind, "call");
});

test("a failing first UI operand stays before later operand effects and packet emission", async () => {
  const ir = await compile(mark + `fail(values:[num:101], index:int) -> [num:101]:
    :: values.(index)
    values
` + setup + `index: 101
frame.add(y_u:fail(y,index), x_u:mark(2,x), id:"must-not-emit", color:[0.12,0.72,1,1])
`);
  const [{ value }] = requireAdds(ir, 1, "failing operand");
  assert.deepEqual(value.arguments.map(argument => argument.name), ["y_u", "x_u", "id", "color"]);
  assert.equal(value.arguments[0].value.callee.name, "fail");
  assert.equal(value.arguments[1].value.callee.name, "mark");
});

test("a conditional UI add remains inside its untaken branch", async () => {
  const ir = await compile(setup + `enabled: false
enabled? frame.add(x_u:x, y_u:y, id:"hidden", color:[0.12,0.72,1,1])
frame.add(x_u:x, y_u:y, id:"visible", color:[0.12,0.72,1,1])
`);
  const additions = requireAdds(ir, 2, "conditional execution");
  const isConditional = ({ ancestors }) => ancestors.some(node =>
    ["if_expr", "if", "if_stmt"].includes(node.kind));
  assert.equal(isConditional(additions[0]), true, "hidden add must not be hoisted out of its condition");
  assert.equal(isConditional(additions[1]), false);
});

test("copying a retained handle does not copy its creation effect", async () => {
  const ir = await compile(setup + `alias: frame
alias.add(x_u:x, y_u:y, id:"once", color:[0.12,0.72,1,1])
`);
  assert.equal(effects(ir, "display").length, 1, "Display must execute once");
  assert.equal(effects(ir, "add_frame").length, 1, "handle alias must not replay add_frame");
  requireAdds(ir, 1, "aliased handle");
  const alias = ir.body.find(statement => statement.name === "alias");
  assert.equal(alias.value.kind, "load", "alias references the existing handle, not its initializer");
});
