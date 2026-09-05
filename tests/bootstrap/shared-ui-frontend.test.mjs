import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadSharedFrontend } from "../../tools/verify-browser-frontend-parity.mjs";

const compiler = loadSharedFrontend();
const sourcePromise = readFile(new URL("../../examples/introduction/geometry.vkf", import.meta.url), "utf8");

test("README sine geometry uses the same inferred display and indexed channels on native and WASM", async () => {
  const api = await compiler;
  const source = await sourcePromise;
  const browser = api.browser(source);
  assert.deepEqual(browser, api.native(source));
  assert.equal(browser.ok, true, browser.message);
  assert.equal(browser.typed_ir.ui_program.displays[0].dimension, 2);
  const geometry = browser.typed_ir.ui_program.operations.find(operation => operation.kind === "add");
  assert.equal(geometry.properties.x_u.kind, "load");
  assert.equal(geometry.properties.x_u.name, "x");
  assert.equal(geometry.properties.y_u.kind, "load");
  assert.equal(geometry.properties.y_u.name, "y");
  assert.equal(Object.hasOwn(geometry.properties, "z"), false);
});

test("editing geometry variables and vector bounds changes canonical IR without a source template", async () => {
  const api = await compiler;
  const original = await sourcePromise;
  const edited = original
    .replaceAll("display", "surface")
    .replace(": .ui.surface", ": .ui.display")
    .replaceAll("frame", "viewport")
    .replace("add_viewport", "add_frame")
    .replace("x: 0.1[..100]", "samples: 0.2[..50]")
    .replace("y: sin(x)", "heights: sin(samples)")
    .replace("x_u:x", "x_u:samples")
    .replace("y_u:y", "y_u:heights");
  const browser = api.browser(edited);
  assert.deepEqual(browser, api.native(edited));
  assert.equal(browser.ok, true, browser.message);
  const geometry = browser.typed_ir.ui_program.operations.find(operation => operation.kind === "add");
  assert.equal(geometry.properties.x_u.name, "samples");
  assert.equal(geometry.properties.y_u.name, "heights");
  assert.notDeepEqual(browser, api.browser(original));
});

test("geometry rejection preserves exact native diagnostics in source order and recovers", async () => {
  const api = await compiler;
  const original = await sourcePromise;
  for (const [source, message] of [
    [original.replace("x_u:x,", "first_bad:0, second_bad:0, x_u:x,"), "Frame.add does not support `first_bad`"],
    [original.replace("x_u:x,", "second_bad:0, first_bad:0, x_u:x,"), "Frame.add does not support `second_bad`"],
    [original.replace("x_u:x,", "x_u:x, x_u:x,"), "Frame.add received duplicate `x_u`"],
  ]) {
    const browser = api.browser(source);
    assert.deepEqual(browser, api.native(source));
    assert.equal(browser.ok, false);
    assert.equal(browser.message, message);
  }
  assert.equal(api.browser(original).ok, true);
});

test("an explicit constant z infers three dimensions for automatic retained handles", async () => {
  const api = await compiler;
  const source = (await sourcePromise).replace("y_u:y,", "y_u:y, z:0,");
  const browser = api.browser(source);
  assert.deepEqual(browser, api.native(source));
  assert.equal(browser.ok, true, browser.message);
  assert.equal(browser.typed_ir.ui_program.displays[0].dimension, 3);
  const display = browser.typed_ir.body.find(statement => statement.name === "display");
  const frame = browser.typed_ir.body.find(statement => statement.name === "frame");
  assert.equal(display.type, "Display<3>");
  assert.equal(display.value.type, "Display<3>");
  assert.equal(frame.type, "Frame<3>");
  assert.equal(frame.value.type, "Frame<3>");
  const geometry = browser.typed_ir.ui_program.operations.find(operation => operation.kind === "add");
  assert.equal(geometry.properties.z.kind, "const");
  assert.equal(geometry.properties.z.value, 0);
  const explicit = api.browser(source.replace("Display()", "Display(dim:2)"));
  assert.deepEqual(explicit, api.native(source.replace("Display()", "Display(dim:2)")));
  assert.equal(explicit.ok, true, explicit.message);
  assert.equal(explicit.typed_ir.ui_program.displays[0].dimension, 2);
});

test("coordinate channels preserve approved semantic axes instead of recognizing only u", async () => {
  const api = await compiler;
  const source = (await sourcePromise)
    .replace("x_u:x", "x_v:x")
    .replace("y_u:y", "y_v:y, z_v:x");
  const browser = api.browser(source);
  assert.deepEqual(browser, api.native(source));
  assert.equal(browser.ok, true, browser.message);
  const geometry = browser.typed_ir.ui_program.operations.find(operation => operation.kind === "add");
  assert.equal(geometry.properties.x_v.name, "x");
  assert.equal(geometry.properties.y_v.name, "y");
  assert.equal(geometry.properties.z_v.name, "x");
  assert.equal(browser.typed_ir.ui_program.displays[0].dimension, 3);
});

test("topology, item and time axes preserve order and reject unknown axis names", async () => {
  const api = await compiler;
  const original = await sourcePromise;
  for (const axes of ["u", "v", "w", "i", "j", "k", "t", "uv", "vu", "iu", "tu"]) {
    const source = original
      .replace("x_u:x", `x_${axes}:${axes.length === 1 ? "x" : "[x,x]"}`)
      .replace("y_u:y", `y_${axes}:${axes.length === 1 ? "y" : "[y,y]"}`);
    const browser = api.browser(source);
    assert.deepEqual(browser, api.native(source), axes);
    assert.equal(browser.ok, true, `${axes}: ${browser.message}`);
    const properties = browser.typed_ir.ui_program.operations.find(operation => operation.kind === "add").properties;
    assert.ok(Object.hasOwn(properties, `x_${axes}`));
    assert.ok(Object.hasOwn(properties, `y_${axes}`));
    assert.equal(browser.typed_ir.ui_program.displays[0].dimension, 2);
  }
  for (const axes of ["q", "uu", "uc"]) {
    const source = original.replace("x_u:x", `x_${axes}:x`);
    const browser = api.browser(source);
    assert.deepEqual(browser, api.native(source));
    assert.equal(browser.ok, false);
    assert.equal(browser.message, `Frame.add does not support \`x_${axes}\``);
  }
});

test("complex scalar positions use p_u without a component axis or a public z channel", async () => {
  const api = await compiler;
  const source = (await sourcePromise).replace("x_u:x,\n    y_u:y,", "p_u:[1 + 2i, 3 + 4i],");
  const browser = api.browser(source);
  assert.deepEqual(browser, api.native(source));
  assert.equal(browser.ok, true, browser.message);
  assert.equal(browser.typed_ir.ui_program.displays[0].dimension, 2);
  const properties = browser.typed_ir.ui_program.operations.find(operation => operation.kind === "add").properties;
  assert.ok(Object.hasOwn(properties, "p_u"));
  assert.equal(Object.hasOwn(properties, "p_uc"), false);
  assert.equal(Object.hasOwn(properties, "z"), false);
  assert.equal(properties.p_u.kind, "list");
  assert.equal(properties.p_u.items.length, 2);
  for (const item of properties.p_u.items) assert.equal(item.type, "num");
});
