(function (global) {
  "use strict";

  var MAT4_F32 = 16;
  var MOUSE_MOVE = 1;
  var MOUSE_DOWN = 2;
  var MOUSE_UP = 3;
  var MOUSE_DRAG = 4;
  var HOVER_OBJECT = 1;
  var HOVER_FACE = 2;
  var HOVER_EDGE = 4;
  var HOVER_VERTEX = 8;

  function numberOrZero(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function intOrDefault(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n | 0 : fallback;
  }

  function finiteOrDefault(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n : fallback;
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
    var out = {
      frame_id: intOrDefault(hover.frame_id != null ? hover.frame_id : hover.frame, -1),
      object_id: intOrDefault(hover.object_id != null ? hover.object_id : hover.object, -1),
      face_id: intOrDefault(hover.face_id != null ? hover.face_id : hover.face, -1),
      edge_id: intOrDefault(hover.edge_id != null ? hover.edge_id : hover.edge, -1),
      vertex_id: intOrDefault(hover.vertex_id != null ? hover.vertex_id : hover.vertex, -1)
    };
    out.mask = intOrDefault(hover.mask, hoverMask(out));
    out.kind = intOrDefault(hover.kind_id != null ? hover.kind_id : hover.kind, hoverKind(out));
    return Object.freeze(out);
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

  function makeHover(objectId, vertexId, edgeId, faceId) {
    var hover = {
      object_id: objectId,
      vertex_id: vertexId == null ? -1 : vertexId,
      edge_id: edgeId == null ? -1 : edgeId,
      face_id: faceId == null ? -1 : faceId
    };
    hover.mask = hoverMask(hover);
    hover.kind = hoverKind(hover);
    return Object.freeze(hover);
  }

  function hoverMask(hover) {
    var mask = 0;
    if (hover.object_id >= 0) {
      mask |= HOVER_OBJECT;
    }
    if (hover.face_id >= 0) {
      mask |= HOVER_FACE;
    }
    if (hover.edge_id >= 0) {
      mask |= HOVER_EDGE;
    }
    if (hover.vertex_id >= 0) {
      mask |= HOVER_VERTEX;
    }
    return mask;
  }

  function hoverKind(hover) {
    if (hover.vertex_id >= 0) {
      return HOVER_VERTEX;
    }
    if (hover.edge_id >= 0) {
      return HOVER_EDGE;
    }
    if (hover.face_id >= 0) {
      return HOVER_FACE;
    }
    if (hover.object_id >= 0) {
      return HOVER_OBJECT;
    }
    return 0;
  }

  function dot2(ax, ay, bx, by) {
    return ax * bx + ay * by;
  }

  function dist2(ax, ay, bx, by) {
    var dx = ax - bx;
    var dy = ay - by;
    return dx * dx + dy * dy;
  }

  function pointSegmentDistance(point, a, b) {
    var px = point[0];
    var py = point[1];
    var ax = a[0];
    var ay = a[1];
    var bx = b[0];
    var by = b[1];
    var vx = bx - ax;
    var vy = by - ay;
    var len2 = vx * vx + vy * vy;
    var t = len2 > 0 ? Math.max(0, Math.min(1, dot2(px - ax, py - ay, vx, vy) / len2)) : 0;
    return Math.sqrt(dist2(px, py, ax + vx * t, ay + vy * t));
  }

  function pointInPolygon(point, polygon) {
    var x = point[0];
    var y = point[1];
    var inside = false;
    for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      var xi = polygon[i][0];
      var yi = polygon[i][1];
      var xj = polygon[j][0];
      var yj = polygon[j][1];
      var intersects = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi);
      if (intersects) {
        inside = !inside;
      }
    }
    return inside;
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

  function meshOptionsFrom(spec, options) {
    spec = spec || {};
    options = options || {};
    return {
      face_color: options.face_color || spec.face_color || options.color || spec.color || [1, 1, 1, 1],
      edge_color: options.edge_color || spec.edge_color || [1, 1, 1, 1],
      vertex_color: options.vertex_color || spec.vertex_color || [1, 1, 1, 1],
      volume_color: options.volume_color || spec.volume_color || [1, 1, 1, 1],
      vertex_width: options.vertex_width != null ? options.vertex_width : spec.vertex_width,
      edge_width: options.edge_width != null ? options.edge_width : spec.edge_width,
      edge_scale: options.edge_scale != null ? options.edge_scale : spec.edge_scale,
      origin: options.origin || spec.origin
    };
  }

  function MeshRef(runtime, panel, slot, id, coords, options, parent) {
    options = options || {};
    this.runtime = runtime;
    this.panel = panel;
    this.slot = slot;
    this.id = id;
    this.parent = parent || null;
    this.children = [];
    this.coords = coords;
    this.offset = [0, 0, 0];
    this.origin = options.origin || [0, 0, 0];
    this.basis = [1, 0, 0, 1];
    this.vertices = [];
    this.edges = [];
    this.faces = [];
    this.volumes = [];
    this.volume_policy = "filled";
    this.face_color = options.face_color || [1, 1, 1, 1];
    this.edge_color = options.edge_color || [1, 1, 1, 1];
    this.vertex_color = options.vertex_color || [1, 1, 1, 1];
    this.volume_color = options.volume_color || [1, 1, 1, 1];
    this.vertex_width = finiteOrDefault(options.vertex_width, 0);
    this.edge_width = finiteOrDefault(
      options.edge_width != null ? options.edge_width : options.edge_scale,
      0
    );
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

  MeshRef.prototype.add = function (spec, options) {
    return this.panel._add_mesh(spec, options, this);
  };

  MeshRef.prototype.world_point = function (index) {
    return this.world_inner_point([
      numberOrZero(this.coords.x[index]),
      numberOrZero(this.coords.y[index]),
      numberOrZero(this.coords.z[index])
    ]);
  };

  MeshRef.prototype.world_inner_point = function (inner) {
    var lx = numberOrZero(inner[0]) - numberOrZero(this.origin[0]);
    var ly = numberOrZero(inner[1]) - numberOrZero(this.origin[1]);
    var local = [
      numberOrZero(this.origin[0]) + this.offset[0] + this.basis[0] * lx + this.basis[2] * ly,
      numberOrZero(this.origin[1]) + this.offset[1] + this.basis[1] * lx + this.basis[3] * ly,
      numberOrZero(inner[2]) + this.offset[2]
    ];
    return this.parent && typeof this.parent.world_inner_point === "function"
      ? this.parent.world_inner_point(local)
      : local;
  };

  MeshRef.prototype.inner_from_world = function (point) {
    var parentPoint = this.parent && typeof this.parent.inner_from_world === "function"
      ? this.parent.inner_from_world(point)
      : point;
    var x = numberOrZero(parentPoint[0]) - numberOrZero(this.origin[0]) - this.offset[0];
    var y = numberOrZero(parentPoint[1]) - numberOrZero(this.origin[1]) - this.offset[1];
    var det = this.basis[0] * this.basis[3] - this.basis[2] * this.basis[1];
    if (Math.abs(det) < 1e-9) {
      return [numberOrZero(this.origin[0]), numberOrZero(this.origin[1]), 0];
    }
    var lx = (this.basis[3] * x - this.basis[2] * y) / det;
    var ly = (-this.basis[1] * x + this.basis[0] * y) / det;
    return [
      lx + numberOrZero(this.origin[0]),
      ly + numberOrZero(this.origin[1]),
      0
    ];
  };

  MeshRef.prototype.world_points = function () {
    var out = [];
    for (var i = 0; i < this.coords.x.length; i++) {
      out.push(this.world_point(i));
    }
    return out;
  };

  MeshRef.prototype.translate = function (args) {
    args = args || {};
    var trans = args.trans || [numberOrZero(args.dx), numberOrZero(args.dy), numberOrZero(args.dz)];
    this.offset[0] += numberOrZero(trans[0]);
    this.offset[1] += numberOrZero(trans[1]);
    this.offset[2] += numberOrZero(trans[2]);
    this._sync_transform();
    return this;
  };

  MeshRef.prototype._local_matrix2d = function () {
    var ox = numberOrZero(this.origin[0]);
    var oy = numberOrZero(this.origin[1]);
    return {
      a: this.basis[0],
      b: this.basis[1],
      c: this.basis[2],
      d: this.basis[3],
      tx: ox + this.offset[0] - this.basis[0] * ox - this.basis[2] * oy,
      ty: oy + this.offset[1] - this.basis[1] * ox - this.basis[3] * oy,
      tz: this.offset[2]
    };
  };

  MeshRef.prototype._world_matrix2d = function () {
    var local = this._local_matrix2d();
    if (!this.parent || typeof this.parent._world_matrix2d !== "function") {
      return local;
    }
    var parent = this.parent._world_matrix2d();
    return {
      a: parent.a * local.a + parent.c * local.b,
      b: parent.b * local.a + parent.d * local.b,
      c: parent.a * local.c + parent.c * local.d,
      d: parent.b * local.c + parent.d * local.d,
      tx: parent.a * local.tx + parent.c * local.ty + parent.tx,
      ty: parent.b * local.tx + parent.d * local.ty + parent.ty,
      tz: parent.tz + local.tz
    };
  };

  MeshRef.prototype._sync_transform = function () {
    var m = this._world_matrix2d();
    this.runtime.arena.setMat4(this.slot, [
      m.a, m.b, 0, 0,
      m.c, m.d, 0, 0,
      0, 0, 1, 0,
      m.tx, m.ty, m.tz, 1
    ]);
    for (var i = 0; i < this.children.length; i++) {
      this.children[i]._sync_transform();
    }
  };

  MeshRef.prototype.rotate_scale_at_vertex = function (args) {
    args = args || {};
    var vertex = intOrDefault(args.vertex, -1);
    if (vertex < 0 || vertex >= this.coords.x.length) {
      return this;
    }
    var p = this.world_point(vertex);
    var originWorld = this.world_inner_point(this.origin);
    var trans = args.trans || [0, 0];
    var cursor = args.cursor || [p[0] + numberOrZero(trans[0]), p[1] + numberOrZero(trans[1])];
    var vx = p[0] - originWorld[0];
    var vy = p[1] - originWorld[1];
    var wx = numberOrZero(cursor[0]) - originWorld[0];
    var wy = numberOrZero(cursor[1]) - originWorld[1];
    var vLen = Math.sqrt(vx * vx + vy * vy);
    var wLen = Math.sqrt(wx * wx + wy * wy);
    if (vLen < 1e-9 || wLen < 1e-9) {
      return this;
    }
    var angle = Math.atan2(wy, wx) - Math.atan2(vy, vx);
    var scale = Math.max(0.15, wLen / vLen);
    var cos = Math.cos(angle);
    var sin = Math.sin(angle);
    var a = this.basis[0];
    var b = this.basis[1];
    var c = this.basis[2];
    var d = this.basis[3];
    this.basis[0] = scale * (cos * a - sin * b);
    this.basis[1] = scale * (sin * a + cos * b);
    this.basis[2] = scale * (cos * c - sin * d);
    this.basis[3] = scale * (sin * c + cos * d);
    this._sync_transform();
    return this;
  };

  MeshRef.prototype.scale_edge = function (args) {
    args = args || {};
    var edge = intOrDefault(args.edge, -1);
    if (edge < 0 || edge >= this.edges.length) {
      return this;
    }
    var pair = this.edges[edge];
    var a = this.world_point(pair[0]);
    var b = this.world_point(pair[1]);
    var ex = b[0] - a[0];
    var ey = b[1] - a[1];
    var len = Math.sqrt(ex * ex + ey * ey) || 1;
    var nx = -ey / len;
    var ny = ex / len;
    var trans = args.trans || [0, 0];
    var factor = Math.max(0.15, 1 + dot2(numberOrZero(trans[0]), numberOrZero(trans[1]), nx, ny) * 0.01);
    this.basis[2] *= factor;
    this.basis[3] *= factor;
    this._sync_transform();
    return this;
  };

  MeshRef.prototype.pick = function (point) {
    var i;
    for (i = this.vertices.length - 1; i >= 0; i--) {
      var vertexId = this.vertices[i];
      var p = this.world_point(vertexId);
      if (Math.sqrt(dist2(point[0], point[1], p[0], p[1])) <= this.vertex_width) {
        return { ref: this, hover: makeHover(this.id, vertexId, -1, -1) };
      }
    }
    for (i = this.edges.length - 1; i >= 0; i--) {
      var edge = this.edges[i];
      if (pointSegmentDistance(point, this.world_point(edge[0]), this.world_point(edge[1])) <= this.edge_width) {
        return { ref: this, hover: makeHover(this.id, -1, i, -1) };
      }
    }
    for (i = this.faces.length - 1; i >= 0; i--) {
      var face = this.faces[i].map(this.world_point.bind(this));
      if (pointInPolygon(point, face)) {
        return { ref: this, hover: makeHover(this.id, -1, -1, i) };
      }
    }
    return null;
  };

  MeshRef.prototype.visible_volume_surfaces = function () {
    return {
      policy: this.volume_policy,
      surfaces: "first_last_per_dimension"
    };
  };

  MeshRef.prototype.set_overlay = function (options) {
    options = options || {};
    if (options.vertex_width != null) {
      this.vertex_width = finiteOrDefault(options.vertex_width, this.vertex_width);
    }
    if (options.edge_width != null || options.edge_scale != null) {
      this.edge_width = finiteOrDefault(
        options.edge_width != null ? options.edge_width : options.edge_scale,
        this.edge_width
      );
    }
    if (options.face_color) {
      this.face_color = options.face_color;
    }
    if (options.edge_color) {
      this.edge_color = options.edge_color;
    }
    if (options.vertex_color) {
      this.vertex_color = options.vertex_color;
    }
    if (options.volume_color) {
      this.volume_color = options.volume_color;
    }
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
      options && (options.face_color || options.color),
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

  PanelRef.prototype.add = function (spec, options) {
    return this._add_mesh(spec, options, null);
  };

  PanelRef.prototype._add_mesh = function (spec, options, parent) {
    var slot = this.runtime.nextSlot++;
    if (slot >= this.runtime.arena.capacity()) {
      throw new RangeError("transform arena does not have capacity for another object");
    }
    var ref = new MeshRef(
      this.runtime,
      this,
      slot,
      slot,
      coordsFromSpec(spec),
      meshOptionsFrom(spec, options),
      parent || null
    );
    if (parent) {
      parent.children.push(ref);
    }
    this.objects[ref.id] = ref;
    this.runtime.meshes.push(ref);
    ref._sync_transform();
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
    for (var m = this.runtime.meshes.length - 1; m >= 0; m--) {
      var hit = this.runtime.meshes[m].pick([x, y]);
      if (hit) {
        return hit;
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
      rects: [],
      meshes: []
    };
    runtime.ui = Object.freeze({
      MOUSE_MOVE: MOUSE_MOVE,
      MOUSE_DOWN: MOUSE_DOWN,
      MOUSE_UP: MOUSE_UP,
      MOUSE_DRAG: MOUSE_DRAG,
      HOVER_OBJECT: HOVER_OBJECT,
      HOVER_FACE: HOVER_FACE,
      HOVER_EDGE: HOVER_EDGE,
      HOVER_VERTEX: HOVER_VERTEX,
      display: new Display(runtime),
      events: new EventQueue(opts.eventArena),
      cursor: new Cursor()
    });
    return runtime;
  }

  global.VfVkfUiRuntime = {
    MAT4_F32: MAT4_F32,
    HOVER_OBJECT: HOVER_OBJECT,
    HOVER_FACE: HOVER_FACE,
    HOVER_EDGE: HOVER_EDGE,
    HOVER_VERTEX: HOVER_VERTEX,
    createVkfUiRuntime: createVkfUiRuntime
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.VfVkfUiRuntime;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
