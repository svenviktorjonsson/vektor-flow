(function (global) {
  "use strict";

  var MAT4_F32 = 16;
  var MOUSE_MOVE = 1;
  var MOUSE_DOWN = 2;
  var MOUSE_UP = 3;
  var MOUSE_DRAG = 4;

  function numberOrZero(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function intOrDefault(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n | 0 : fallback;
  }

  function rectFromArray(rect) {
    if (!rect || rect.length < 4) {
      throw new TypeError("rect expects [x, y, w, h]");
    }
    return {
      x: numberOrZero(rect[0]),
      y: numberOrZero(rect[1]),
      w: numberOrZero(rect[2]),
      h: numberOrZero(rect[3])
    };
  }

  function normalizedHover(sample) {
    var hover = sample && sample.hover ? sample.hover : {};
    var objectId = intOrDefault(
      hover.object_id != null ? hover.object_id : hover.object,
      -1
    );
    return Object.freeze({
      frame_id: intOrDefault(hover.frame_id != null ? hover.frame_id : hover.frame, -1),
      object_id: objectId,
      face_id: intOrDefault(hover.face_id != null ? hover.face_id : hover.face, -1),
      edge_id: intOrDefault(hover.edge_id != null ? hover.edge_id : hover.edge, -1),
      vertex_id: intOrDefault(hover.vertex_id != null ? hover.vertex_id : hover.vertex, -1),
      mask: objectId >= 0 ? 1 : 0
    });
  }

  function eventKind(sample) {
    if (!sample) {
      return MOUSE_MOVE;
    }
    if (sample.pointerDown && sample.buttons) {
      return MOUSE_DRAG;
    }
    return sample.pointerDown ? MOUSE_DOWN : MOUSE_MOVE;
  }

  function eventFromSample(sample) {
    sample = sample || {};
    var cursor = sample.cursorPx || [0, 0];
    var anchor = sample.pointerAnchorPx || cursor;
    return Object.freeze({
      event: eventKind(sample),
      cursor: Object.freeze([numberOrZero(cursor[0]), numberOrZero(cursor[1])]),
      trans: Object.freeze([
        numberOrZero(cursor[0]) - numberOrZero(anchor[0]),
        numberOrZero(cursor[1]) - numberOrZero(anchor[1])
      ]),
      hover: normalizedHover(sample),
      buttons: intOrDefault(sample.buttons, 0),
      sequence: intOrDefault(sample.sequence, 0),
      time_ms: numberOrZero(sample.timeMs)
    });
  }

  function RectRef(runtime, panel, slot, id, rect, color) {
    this.runtime = runtime;
    this.panel = panel;
    this.slot = slot;
    this.id = id;
    this.rect = rect;
    this.color = color || [1, 1, 1, 1];
  }

  RectRef.prototype.translate = function (args) {
    args = args || {};
    var trans = args.trans || [numberOrZero(args.dx), numberOrZero(args.dy)];
    this.rect.x += numberOrZero(trans[0]);
    this.rect.y += numberOrZero(trans[1]);
    this.runtime.arena.setTranslate2D(this.slot, this.rect.x, this.rect.y);
    return this;
  };

  function PanelRef(runtime, id, options) {
    this.runtime = runtime;
    this.id = id;
    this.options = options || {};
    this.rect = null;
    this.objects = Object.create(null);
  }

  PanelRef.prototype.add_rect = function (rectArray, options) {
    var rect = rectFromArray(rectArray);
    var slot = this.runtime.nextSlot++;
    if (slot >= this.runtime.arena.capacity()) {
      throw new RangeError("transform arena does not have capacity for another object");
    }
    var ref = new RectRef(
      this.runtime,
      this,
      slot,
      slot,
      rect,
      options && options.color
    );
    this.objects[ref.id] = ref;
    this.runtime.arena.setTranslate2D(slot, rect.x, rect.y);
    return ref;
  };

  PanelRef.prototype.get = function (hover) {
    if (!hover || hover.object_id == null || hover.object_id < 0) {
      return null;
    }
    return this.objects[hover.object_id] || null;
  };

  function Display(runtime) {
    this.runtime = runtime;
    this.nextFrameId = 0;
  }

  Display.prototype.frame = function (options) {
    return new PanelRef(this.runtime, this.nextFrameId++, options || {});
  };

  Display.prototype.add_frame = function (panel, rectArray) {
    panel.rect = rectFromArray(rectArray);
    return panel;
  };

  function EventQueue(eventArena) {
    this.eventArena = eventArena;
  }

  EventQueue.prototype.get = function () {
    return eventFromSample(this.eventArena.latestSample());
  };

  function Cursor() {
    this.mode = "default";
  }

  Cursor.prototype.set_mode = function (mode) {
    this.mode = String(mode || "default");
    return this.mode;
  };

  function createVkfUiRuntime(options) {
    var opts = options || {};
    if (!opts.arena || typeof opts.arena.setTranslate2D !== "function") {
      throw new TypeError("createVkfUiRuntime requires a transform arena");
    }
    if (!opts.eventArena || typeof opts.eventArena.latestSample !== "function") {
      throw new TypeError("createVkfUiRuntime requires an event arena");
    }
    var runtime = {
      arena: opts.arena,
      eventArena: opts.eventArena,
      nextSlot: 0
    };
    runtime.ui = Object.freeze({
      MOUSE_MOVE: MOUSE_MOVE,
      MOUSE_DOWN: MOUSE_DOWN,
      MOUSE_UP: MOUSE_UP,
      MOUSE_DRAG: MOUSE_DRAG,
      display: new Display(runtime),
      events: new EventQueue(opts.eventArena),
      cursor: new Cursor()
    });
    return runtime;
  }

  global.VfVkfUiRuntime = {
    MAT4_F32: MAT4_F32,
    createVkfUiRuntime: createVkfUiRuntime
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.VfVkfUiRuntime;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
