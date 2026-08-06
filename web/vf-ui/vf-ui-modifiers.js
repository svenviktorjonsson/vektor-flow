(function(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.VfUiModifiers = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  "use strict";

  var MODIFIER_BITS = Object.freeze({ ctrl: 1, shift: 2, alt: 4, meta: 8 });

  function modifierMask(event) {
    event = event || {};
    return (event.ctrlKey ? MODIFIER_BITS.ctrl : 0)
      | (event.shiftKey ? MODIFIER_BITS.shift : 0)
      | (event.altKey ? MODIFIER_BITS.alt : 0)
      | (event.metaKey ? MODIFIER_BITS.meta : 0);
  }

  function createUiModifierState() {
    return {
      mask: 0,
      modifiers: modifiersFromMask(0),
      set_mask: function(mask) {
        this.mask = Number(mask) | 0;
        this.modifiers = modifiersFromMask(this.mask);
        return this.modifiers;
      },
      set_event: function(event) {
        return this.set_mask(modifierMask(event));
      }
    };
  }

  function createUiModifiers() {
    var keyboard = createUiModifierState();
    var ui = { keyboard: keyboard };
    Object.defineProperty(ui, "modifiers", {
      enumerable: true,
      get: function() { return keyboard.modifiers; }
    });
    return ui;
  }

  function modifiersFromMask(mask) {
    return {
      ctrl: !!(mask & MODIFIER_BITS.ctrl),
      shift: !!(mask & MODIFIER_BITS.shift),
      alt: !!(mask & MODIFIER_BITS.alt),
      meta: !!(mask & MODIFIER_BITS.meta)
    };
  }

  return Object.freeze({
    MODIFIER_BITS: MODIFIER_BITS,
    createUiModifierState: createUiModifierState,
    createUiModifiers: createUiModifiers,
    modifierMask: modifierMask
  });
});
