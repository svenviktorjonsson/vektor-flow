"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const modifiers = require("../../web/vf-ui/vf-ui-modifiers.js");

test("ui modifiers canonicalize DOM events into the VKF keyboard mask", () => {
  const keyboard = modifiers.createUiModifierState();
  keyboard.set_event({ ctrlKey: true, shiftKey: true, altKey: false, metaKey: false });
  assert.equal(keyboard.mask, 3);
  assert.deepEqual(keyboard.modifiers, {
    ctrl: true,
    shift: true,
    alt: false,
    meta: false
  });
  keyboard.set_event({ ctrlKey: false, shiftKey: false, altKey: false, metaKey: false });
  assert.equal(keyboard.mask, 0);
});

test("ui modifiers expose stable bit assignments", () => {
  assert.deepEqual(modifiers.MODIFIER_BITS, {
    ctrl: 1,
    shift: 2,
    alt: 4,
    meta: 8
  });
});

test("ui.modifiers always reflects canonical keyboard state", () => {
  const ui = modifiers.createUiModifiers();

  ui.keyboard.set_event({ shiftKey: true, metaKey: true });

  assert.deepEqual(ui.modifiers, {
    ctrl: false,
    shift: true,
    alt: false,
    meta: true
  });
});
