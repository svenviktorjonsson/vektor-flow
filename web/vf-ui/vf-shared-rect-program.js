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
    var panel = null;
    var activeTarget = null;

    return {
      source: vkfSource,
      init: function (api) {
        var ui = api.ui;
        panel = ui.display.frame({
          title: "VKF rect",
          draggable: true,
          closable: true,
          resizable: true,
          dockable: true,
          dock_loc: "bl",
          alpha: 0.96,
          master: true
        });
        ui.display.add_frame(panel, [0.18, 0.18, 0.42, 0.34]);
        panel.add_rect([RECT_START_X, RECT_START_Y, 180, 118], {
          color: [0.20, 0.82, 0.49, 1.0]
        });
      },
      update: function (input, api) {
        var e = api.ui.events.get();
        if (!input.pointerDown) {
          activeTarget = null;
          return;
        }
        activeTarget = activeTarget || panel.get(e.hover);
        if (activeTarget) {
          activeTarget.translate({ trans: e.trans });
        }
      }
    };
  }

  global.VfSharedRectProgram = {
    source: vkfSource,
    create: createVkfSharedRectProgram
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
