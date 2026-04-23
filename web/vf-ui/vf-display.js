/**
 * vf-display.js — renders from vf-display.json.
 *
 * JSON structure:
 *   { "screen": [...rect ops],
 *     "frames": { "<frame_id>": [...rect ops] },
 *     "geom":   { "<frame_id>": { meshes:[...], camera:{...}, lights:[...] } }
 *   }
 *
 * Each mesh in geom.meshes can carry:
 *   { type:"box", center:[x,y,z], scale:[sx,sy,sz], color:"red", rotation:[rx,ry,rz] }
 *   rotation is Euler degrees [rx, ry, rz] applied ZYX.
 *
 * Each mesh gets its own VfGeomWgpu renderer so model matrices are independent.
 */
(function (global) {
  "use strict";

  var ctxCache = new WeakMap();
  // frame_id -> { renderers: [{renderer, ref}], camera, lights, canvases }
  var frameRecs = {};

  function get2d(canvas) {
    if (!canvas) { return null; }
    var c = ctxCache.get(canvas);
    if (c) { return c; }
    c = canvas.getContext("2d", { alpha: true });
    if (c) { ctxCache.set(canvas, c); }
    return c;
  }

  function normToPx(rect, w, h) {
    if (!rect || rect.length < 4) { return null; }
    return { x: rect[0]*w, y: rect[1]*h, rw: rect[2]*w, rh: rect[3]*h };
  }

  function drawOpList(ctx, w, h, ops) {
    if (!w || !h || !ctx) { return; }
    ctx.clearRect(0, 0, w, h);
    if (!ops || !ops.length) { return; }
    for (var i = 0; i < ops.length; i++) {
      var o = ops[i];
      if (!o || o.op !== "rect") { continue; }
      var p = normToPx(o.rect, w, h);
      if (!p) { continue; }
      ctx.fillStyle = o.color != null ? String(o.color) : "#888";
      ctx.fillRect(p.x, p.y, p.rw, p.rh);
    }
  }

  function syncCanvasSize(canvas) {
    if (!canvas) { return null; }
    var pr = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.floor(pr.width));
    var h = Math.max(1, Math.floor(pr.height));
    if (canvas.width  !== w) { canvas.width  = w; }
    if (canvas.height !== h) { canvas.height = h; }
    return { w: w, h: h };
  }

  function findFrameEl(fid) {
    try {
      if (global.CSS && typeof global.CSS.escape === "function") {
        return document.querySelector(".vf-frame[data-vf-frame-id=\"" + global.CSS.escape(String(fid)) + "\"]");
      }
      return document.querySelector(".vf-frame[data-vf-frame-id=\"" + String(fid).replace(/["\\]/g,"") + "\"]");
    } catch (_) { return null; }
  }

  // ── Euler ZYX rotation matrix (degrees) ──────────────────────────────────
  // Returns a column-major Float32Array mat4.
  function mat4EulerZYX(rx, ry, rz) {
    var Mm = global.VfGeomMath;
    if (!Mm) { return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); }
    var toRad = Math.PI / 180;
    // Rx
    var cx = Math.cos(rx * toRad), sx = Math.sin(rx * toRad);
    var Rx = new Float32Array([1,0,0,0, 0,cx,sx,0, 0,-sx,cx,0, 0,0,0,1]);
    // Ry
    var cy = Math.cos(ry * toRad), sy = Math.sin(ry * toRad);
    var Ry = new Float32Array([cy,0,-sy,0, 0,1,0,0, sy,0,cy,0, 0,0,0,1]);
    // Rz
    var cz = Math.cos(rz * toRad), sz = Math.sin(rz * toRad);
    var Rz = new Float32Array([cz,sz,0,0, -sz,cz,0,0, 0,0,1,0, 0,0,0,1]);
    return Mm.mat4Mul(Mm.mat4Mul(Rz, Ry), Rx);
  }

  // Build model matrix for a mesh spec: translate(center) * EulerZYX(rotation)
  function meshModelMatrix(spec) {
    var Mm = global.VfGeomMath;
    if (!Mm) { return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); }
    var c = spec.center || [0,0,0];
    var rot = spec.rotation || [0,0,0];
    var T = Mm.mat4Translation(c[0], c[1], c[2]);
    var R = mat4EulerZYX(rot[0], rot[1], rot[2]);
    return Mm.mat4Mul(T, R);
  }

  // Build a single-mesh object for the renderer from a spec
  function buildSingleMesh(spec, camera, lights) {
    var Core = global.VfGeomCore;
    if (!Core) { return null; }
    var mesh;
    if (spec.type === "box") {
      // center always [0,0,0] — translation handled via model matrix
      mesh = Core.buildBox([0,0,0], spec.scale || [1,1,1], spec.color || null, spec.id || "box");
    } else if (spec.preset) {
      mesh = Core.getPreset(spec.preset);
    } else {
      return null;
    }
    if (!mesh) { return null; }
    var out = {};
    for (var k in mesh) { out[k] = mesh[k]; }
    out.camera = camera || null;
    out.lights  = lights  || [];
    out._modelMatrix = meshModelMatrix(spec);
    return out;
  }

  // ── Per-frame renderer management ────────────────────────────────────────

  function ensureGeomCanvas(frameEl, idx) {
    if (!frameEl) { return null; }
    var body = frameEl.querySelector(".vf-frame__body") || frameEl;
    var cls  = "vf-geom-canvas-" + idx;
    var existing = body.querySelector("canvas." + cls);
    if (existing) { return existing; }
    var c = document.createElement("canvas");
    c.className = "vf-geom-canvas " + cls;
    // stack canvases via z-index (idx 0 = bottom)
    c.style.cssText = "display:block;width:100%;height:100%;position:absolute;inset:0;z-index:" + idx + ";pointer-events:none;";
    body.style.position = "relative";
    body.appendChild(c);
    return c;
  }

  function updateGeomFrame(fid, geomSpec) {
    var Ctor = global.VfGeomWgpu;
    if (!Ctor) { return; }
    var frameEl = findFrameEl(fid);
    if (!frameEl) { return; }

    var specs   = geomSpec.meshes || [];
    var camera  = geomSpec.camera || null;
    var lights  = geomSpec.lights || [];

    if (!frameRecs[fid]) { frameRecs[fid] = { entries: [] }; }
    var rec = frameRecs[fid];

    // Grow or reuse per-mesh renderers
    for (var i = 0; i < specs.length; i++) {
      var spec = specs[i];
      var mesh = buildSingleMesh(spec, camera, lights);
      if (!mesh) { continue; }

      if (i < rec.entries.length) {
        // Update existing renderer's mesh reference
        rec.entries[i].ref.mesh = mesh;
      } else {
        // Spawn new renderer for this mesh
        var canvas = ensureGeomCanvas(frameEl, i);
        if (!canvas) { continue; }
        syncCanvasSize(canvas);
        var refHolder = { mesh: mesh };
        (function(rh) {
          var r = new Ctor(canvas, function() { return rh.mesh; });
          rec.entries.push({ renderer: r, ref: rh });
          r.init().then(function(ok) {
            if (!ok && global.console) { global.console.warn("vf-display geom: WebGPU failed for frame " + fid + " mesh " + i); }
            else if (ok) { r.start(); }
          });
        })(refHolder);
      }
    }

    // Stop and hide renderers for meshes that were removed
    for (var j = specs.length; j < rec.entries.length; j++) {
      try { rec.entries[j].renderer.stop(); } catch(_) {}
      rec.entries[j].ref.mesh = null;
    }
  }

  // ── Main render from JSON ─────────────────────────────────────────────────

  function renderFromJson(data) {
    if (!data || typeof data !== "object") { return; }

    var sc = document.getElementById("vf-screen-canvas");
    if (sc) {
      var sz = syncCanvasSize(sc);
      if (sz) { drawOpList(get2d(sc), sz.w, sz.h, data.screen); }
    }

    var frames = data.frames;
    if (frames && typeof frames === "object") {
      for (var fid in frames) {
        if (!Object.prototype.hasOwnProperty.call(frames, fid)) { continue; }
        var el = findFrameEl(fid);
        if (!el) { continue; }
        var cv = el.querySelector("canvas.vf-frame__draw-canvas");
        if (!cv) { continue; }
        var fsz = syncCanvasSize(cv);
        if (!fsz) { continue; }
        drawOpList(get2d(cv), fsz.w, fsz.h, frames[fid]);
      }
    }

    var geom = data.geom;
    if (geom && typeof geom === "object") {
      for (var gid in geom) {
        if (!Object.prototype.hasOwnProperty.call(geom, gid)) { continue; }
        updateGeomFrame(gid, geom[gid]);
      }
    }
  }

  function displayJsonUrl() {
    if (typeof location === "undefined" || !location.href) { return "vf-display.json"; }
    var path = location.pathname || "/";
    var i = path.lastIndexOf("/");
    var base = i >= 0 ? path.substring(0, i+1) : "/";
    return base + "vf-display.json";
  }

  function loadAndRender() {
    if (typeof fetch === "undefined") { return; }
    fetch(displayJsonUrl() + "?t=" + Date.now(), { cache: "no-store" })
      .then(function(r) { if (!r.ok) { return null; } return r.text(); })
      .then(function(t) {
        if (t == null) { return; }
        var o; try { o = JSON.parse(t); } catch(e) { return; }
        renderFromJson(o);
      })
      .catch(function(){});
  }

  global.VfDisplay = { renderFromJson: renderFromJson, loadAndRender: loadAndRender };
})(typeof window !== "undefined" ? window : this);
