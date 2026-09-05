import assert from "node:assert/strict";
import test from "node:test";
import { loadSharedFrontend } from "../../tools/verify-browser-frontend-parity.mjs";

const compiler = loadSharedFrontend();
const setup = `: .ui.display
display: Display()
frame: display.add_frame(pos:[0.08,0.08], size:[0.84,0.84])
x: 0.1[..100]
`;
const add = `frame.add(x_u:x, y_u:x, id:"once", color:[0.12,0.72,1,1])\n`;

test("canonical retained handle aliases load the existing identity without replaying creation", async () => {
  const api = await compiler;
  const direct = api.native(setup + add);
  assert.equal(direct.ok, true, direct.message);
  const source = setup + "alias: frame\n" + add.replace("frame.add", "alias.add");
  const native = api.native(source);
  assert.deepEqual(api.browser(source), native);
  assert.equal(native.ok, true, native.message);
  assert.deepEqual(native.typed_ir.ui_program, direct.typed_ir.ui_program);
  const alias = native.typed_ir.body.find(statement => statement.name === "alias");
  assert.deepEqual(alias.value, {kind:"load", name:"frame", type:"Frame<2>"});
  assert.equal(Object.hasOwn(native, "execution_ir"), false);
});

test("unresolved or shadowing handle parameters preserve their exact alias diagnostic", async () => {
  const api = await compiler;
  for (const source of [
    ": .ui.display\ninvalid(frame:Frame<2>):\n    alias: frame\n",
    setup + "invalid(frame:Frame<2>):\n    alias: frame\n",
    setup + "invalid(frame:Display<2>):\n    alias: frame\n",
  ]) {
    const expected = {message:"in function invalid: missing field value in UI handle", ok:false};
    assert.deepEqual(api.native(source), expected);
    assert.deepEqual(api.browser(source), expected);
  }
});
