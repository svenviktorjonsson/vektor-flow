(function (global) {
  "use strict";

  var RECT_SLOT = 0;
  var RECT_START_X = 120;
  var RECT_START_Y = 96;

  var vkfSource = [
    "rect_slot: 0",
    "rect_start: [120, 96]",
    "",
    "init(api):",
    "  api.transforms.set_translate_2d(rect_slot, rect_start)",
    "",
    "update(input, api):",
    "  dragging: input.pointer_down",
    "  dragging?",
    "    trans: input.cursor_px - input.pointer_anchor_px",
    "    api.transforms.set_translate_2d(rect_slot, rect_start + trans)"
  ].join("\n");

  function createVkfSharedRectProgram() {
    var dragging = false;
    var anchorX = 0;
    var anchorY = 0;
    var startX = RECT_START_X;
    var startY = RECT_START_Y;

    return {
      source: vkfSource,
      init: function (api) {
        api.transforms.setTranslate2D(RECT_SLOT, RECT_START_X, RECT_START_Y);
      },
      update: function (input, api) {
        if (input.pointerDown && !dragging) {
          dragging = true;
          anchorX = input.pointerX;
          anchorY = input.pointerY;
          startX = api.transforms.mat4[RECT_SLOT * 16 + 12];
          startY = api.transforms.mat4[RECT_SLOT * 16 + 13];
        }
        if (!input.pointerDown) {
          dragging = false;
          return;
        }
        api.transforms.setTranslate2D(
          RECT_SLOT,
          startX + input.pointerX - anchorX,
          startY + input.pointerY - anchorY
        );
      }
    };
  }

  global.VfSharedRectProgram = {
    source: vkfSource,
    create: createVkfSharedRectProgram
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
