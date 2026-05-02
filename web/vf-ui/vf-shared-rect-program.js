(function (global) {
  "use strict";

  var RECT_SLOT = 0;
  var RECT_START_X = 120;
  var RECT_START_Y = 96;

  var vkfSource = [
    "ui: .ui",
    "t: .time",
    "events: ui.events",
    "d: ui.display",
    "",
    "panel: d.frame(",
    "  title: \"VKF rect\",",
    "  draggable: true,",
    "  closable: true,",
    "  resizable: true,",
    "  dockable: true,",
    "  dock_loc: \"bl\",",
    "  alpha: 0.96,",
    "  master: true",
    ")",
    "",
    "d.add_frame(panel, [0.18, 0.18, 0.42, 0.34])",
    "",
    "rect: panel.add_rect([120, 96, 180, 118], color: [0.20, 0.82, 0.49, 1.0])",
    "rect.set_interaction(cursor: \"open_hand\", pressed_cursor: \"closed_hand\", border: 0.03)",
    "",
    "drag(e):",
    "  target: panel.get(e.hover)",
    "  target?",
    "    target.translate(trans: e.trans)",
    "",
    "(e: events.get())??>",
    "  ui.MOUSE_DOWN =>",
    "    ui.cursor.set_mode(\"closed_hand\")",
    "  ui.MOUSE_MOVE =>",
    "    ui.cursor.set_mode(\"open_hand\")",
    "  ui.MOUSE_DRAG =>",
    "    drag(e)",
    "  ui.MOUSE_UP =>",
    "    ui.cursor.set_mode(\"open_hand\")",
    "  t.sleep(0.016)"
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
