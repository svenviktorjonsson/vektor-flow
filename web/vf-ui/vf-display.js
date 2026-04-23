/**
 * vf-display.js — renders from vf-display.json.
 *
 * JSON structure:
 *   { "screen": [...rect ops],
 *     "frames": { "<frame_id>": [...rect ops] },
 *     "geom":   { "<frame_id>": { meshes:[...], camera:{...}, lights:[...] } }
 *   }
 *
 * screen / frames -> Canvas 2D filled rects.
 * geom            -> WebGPU via VfGeomWgpu (vf-geom-wgpu.js must be loaded on pages that use it).
 */
(function (global) {
  "use strict";

  var ctxCache = new WeakMap();
  var geomRenderers = {};

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

  function ensureGeomCanvas(frameEl) {
    if (!frameEl) { return null; }
    var body = frameEl.querySelector(".vf-frame__body") || frameEl;
    var existing = body.querySelector("canvas.vf-geom-canvas");
    if (existing) { return existing; }
    var c = document.createElement("canvas");
    c.className = "vf-geom-canvas";
    c.style.cssText = "display:block;width:100%;height:100%;position:absolute;inset:0;z-index:0;";
    body.style.position = "relative";
    body.insertBefore(c, body.firstChild);
    return c;
  }

  function buildMergedMesh(geomSpec) {
    var Core = global.VfGeomCore;
    if (!Core) { return null; }
    var meshes = (geomSpec.meshes || []).map(function(m) {
      var mesh;
      if (m.type === "box") {
        mesh = Core.buildBox(m.center||[0,0,0], m.scale||[1,1,1], m.color||null, m.id||"box");
      } else if (m.preset) {
        mesh = Core.getPreset(m.preset);
      } else {
        return null;
      }
      return mesh;
    }).filter(Boolean);
    if (!meshes.length) { return null; }
    var merged = meshes.length === 1 ? meshes[0] : Core.mergeMeshes(meshes);
    if (!merged) { return null; }
    var out = {};
    for (var k in merged) { out[k] = merged[k]; }
    out.camera = geomSpec.camera || null;
    out.lights  = geomSpec.lights || [];
    return out;
  }

  function updateGeomFrame(fid, geomSpec) {
    var Ctor = global.VfGeomWgpu;
    if (!Ctor) { return; }
    var frameEl = findFrameEl(fid);
    if (!frameEl) { return; }
    var rec = geomRenderers[fid];
    if (!rec) {
      var canvas = ensureGeomCanvas(frameEl);
      if (!canvas) { return; }
      syncCanvasSize(canvas);
      var currentMesh = buildMergedMesh(geomSpec);
      var refHolder = { mesh: currentMesh };
      var r = new Ctor(canvas, function() { return refHolder.mesh; });
      rec = { renderer: r, ref: refHolder };
      geomRenderers[fid] = rec;
      r.init().then(function(ok) {
        if (!ok && global.console) { global.console.warn("vf-display geom: WebGPU failed for frame " + fid); }
        else if (ok) { r.start(); }
      });
    } else {
      rec.ref.mesh = buildMergedMesh(geomSpec);
    }
  }

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
