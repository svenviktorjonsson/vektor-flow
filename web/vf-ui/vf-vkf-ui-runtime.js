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

  function copyRect(rect) {
    return { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  }

  function RectRef(runtime, panel, slot, id, rect, color, parent) {
    this.runtime = runtime;
    this.panel = panel;
    this.slot = slot;
    this.id = id;
    this.local = rect;
    this.world = copyRect(rect);
    this.color = color || [1, 1, 1, 1];
    this.parent = parent || null;
    this.children = [];
  }

  RectRef.prototype._sync_world = function () {
    if (this.parent) {
      var parentWorld = this.parent.world;
      this.world.x = parentWorld.x + this.local.x;
      this.world.y = parentWorld.y + this.local.y;
    } else {
      this.world.x = this.local.x;
      this.world.y = this.local.y;
    }
    this.world.w = this.local.w;
    this.world.h = this.local.h;
    this.runtime.arena.setTranslate2D(this.slot, this.world.x, this.world.y);
    for (var i = 0; i < this.children.length; i++) {
      this.children[i]._sync_world();
    }
  };

  RectRef.prototype.world_rect = function () {
    return copyRect(this.world);
  };

  RectRef.prototype.translate = function (args) {
    args = args || {};
    var trans = args.trans || [numberOrZero(args.dx), numberOrZero(args.dy)];
    this.local.x += numberOrZero(trans[0]);
    this.local.y += numberOrZero(trans[1]);
    this._sync_world();
    return this;
  };

  RectRef.prototype.add_rect = function (rectArray, options) {
    return this.panel._add_rect(rectArray, options, this);
  };

  function copyIndexList(values, arity, name) {
    if (!Array.isArray(values)) {
      throw new TypeError(name + " expects an array of indices");
    }
    return values.map(function (entry) {
      var tuple = Array.isArray(entry) ? entry : [entry];
      if (arity != null && tuple.length !== arity) {
        throw new TypeError(name + " expects index tuples of length " + arity);
      }
      return tuple.map(function (value) {
        var index = Number(value);
        if (!Number.isInteger(index) || index < 0) {
          throw new TypeError(name + " indices must be non-negative integers");
        }
        return index;
      });
    });
  }

  function coordsFromSpec(spec) {
    spec = spec || {};
    var x = Array.isArray(spec.x) ? spec.x.map(numberOrZero) : [];
    var y = Array.isArray(spec.y) ? spec.y.map(numberOrZero) : [];
    var z = Array.isArray(spec.z) ? spec.z.map(numberOrZero) : [];
    var n = Math.max(x.length, y.length, z.length);
    if (n <= 0) {
      throw new TypeError("add expects at least one coordinate vector");
    }
    while (x.length < n) { x.push(0); }
    while (y.length < n) { y.push(0); }
    while (z.length < n) { z.push(0); }
    return { x: x, y: y, z: z };
  }

  function MeshRef(runtime, panel, slot, id, coords) {
    this.runtime = runtime;
    this.panel = panel;
    this.slot = slot;
    this.id = id;
    this.coords = coords;
    this.vertices = [];
    this.edges = [];
    this.faces = [];
    this.volumes = [];
    this.volume_policy = "filled";
  }

  MeshRef.prototype.add_vertices = function (indices) {
    this.vertices = copyIndexList(indices, 1, "add_vertices").map(function (tuple) {
      return tuple[0];
    });
    return this;
  };

  MeshRef.prototype.add_edges = function (indices) {
    this.edges = copyIndexList(indices, 2, "add_edges");
    return this;
  };

  MeshRef.prototype.add_faces = function (indices) {
    this.faces = copyIndexList(indices, null, "add_faces");
    return this;
  };

  MeshRef.prototype.add_volumes = function (indices) {
    this.volumes = copyIndexList(indices, null, "add_volumes");
    this.volume_policy = "filled";
    return this;
  };

  MeshRef.prototype.translate = function (args) {
    args = args || {};
    var trans = args.trans || [numberOrZero(args.dx), numberOrZero(args.dy), numberOrZero(args.dz)];
    this.runtime.arena.setTranslate2D(this.slot, numberOrZero(trans[0]), numberOrZero(trans[1]));
    return this;
  };

  function PanelRef(runtime, id, options) {
    this.runtime = runtime;
    this.id = id;
    this.options = options || {};
    this.rect = null;
    this.objects = Object.create(null);
  }

  PanelRef.prototype._add_rect = function (rectArray, options, parent) {
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
      options && options.color,
      parent || null
    );
    if (parent) {
      parent.children.push(ref);
    }
    this.objects[ref.id] = ref;
    this.runtime.rects.push(ref);
    ref._sync_world();
    return ref;
  };

  PanelRef.prototype.add_rect = function (rectArray, options) {
    return this._add_rect(rectArray, options, null);
  };

  PanelRef.prototype.add = function (spec) {
    var slot = this.runtime.nextSlot++;
    if (slot >= this.runtime.arena.capacity()) {
      throw new RangeError("transform arena does not have capacity for another object");
    }
    var ref = new MeshRef(
      this.runtime,
      this,
      slot,
      slot,
      coordsFromSpec(spec)
    );
    this.objects[ref.id] = ref;
    this.runtime.arena.setTranslate2D(slot, 0, 0);
    return ref;
  };

  PanelRef.prototype.get = function (hover) {
    if (!hover || hover.object_id == null || hover.object_id < 0) {
      return null;
    }
    return this.objects[hover.object_id] || null;
  };

  PanelRef.prototype.pick = function (point) {
    if (!point || point.length < 2) {
      return null;
    }
    var x = numberOrZero(point[0]);
    var y = numberOrZero(point[1]);
    for (var i = this.runtime.rects.length - 1; i >= 0; i--) {
      var ref = this.runtime.rects[i];
      if (ref.panel !== this) {
        continue;
      }
      var r = ref.world;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        return ref;
      }
    }
    return null;
  };

  function Display(runtime) {
    this.runtime = runtime;
    this.nextFrameId = 0;
    this.last_frame = null;
  }

  Display.prototype.frame = function (options) {
    var panel = new PanelRef(this.runtime, this.nextFrameId++, options || {});
    this.last_frame = panel;
    return panel;
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
      nextSlot: 0,
      rects: []
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
