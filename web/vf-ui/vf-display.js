/**
 * vf-display.js — renders from vf-display.json.
 *
 * JSON structure:
 *   { "screen": [...2D ops],
 *     "frames": { "<frame_id>": [...2D ops] },
 *     "geom":   { "<frame_id>": { meshes:[...], camera:{...}, lights:[...] } }
 *   }
 *
 * Each mesh in geom.meshes can carry:
 *   { type:"box|ellipsoid|torus", center:[x,y,z], scale:[sx,sy,sz], color:"red", rotation:[rx,ry,rz], ... }
 *   rotation = Euler degrees [rx, ry, rz] applied ZYX.
 *
 * Each mesh gets its own VfGeomWgpu renderer so model matrices are independent.
 */
(function (global) {
  "use strict";

  // ── Logging ───────────────────────────────────────────────────────────────
  function vlog(level, text) {
    var s = "[vf-display] " + String(text);
    try {
      if (global.console) {
        if (level === "error" && global.console.error) { global.console.error(s); return; }
        if (level === "warn"  && global.console.warn)  { global.console.warn(s);  return; }
        if (global.console.log) { global.console.log(s); }
      }
    } catch (_) {}
    // Also forward to C++ host via webview postMessage (same path as vf-log.js)
    try {
      if (global.chrome && global.chrome.webview && global.chrome.webview.postMessage) {
        global.chrome.webview.postMessage({ type: "vf_log", level: level, message: s, t: Date.now() });
      }
    } catch (_) {}
  }

  vlog("info", "vf-display.js loaded");

  // ── State ─────────────────────────────────────────────────────────────────
  var ctxCache = new WeakMap();
  // frame_id -> { entries: [{renderer, ref}] }
  var frameRecs = {};
  var _lastPayloadSummary = "";   // cheap change-detect for log spam suppression

  // ── Event forwarding ──────────────────────────────────────────────────────
  // frame_id -> { fid, canvases: [...] } for hit-testing
  var _frameEventMap = {};  // fid -> { fid, el }
  var _apiPort = 0;         // discovered from window.__agentPort

  function getApiPort() {
    if (_apiPort) { return _apiPort; }
    if (typeof global !== "undefined" && global.__agentPort) {
      _apiPort = parseInt(global.__agentPort, 10) || 0;
    }
    return _apiPort;
  }

  function postEvent(evt) {
    var port = getApiPort();
    if (!port) { return; }  // no port yet — events queued until next hover/click
    var body = JSON.stringify({ line: JSON.stringify(evt) });
    try {
      fetch("http://127.0.0.1:" + port + "/api/enqueue", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    body,
      }).catch(function(){});
    } catch(_) {}
  }

  /** Convert a canvas-relative MouseEvent to the { frame_id, object_id, simplex_id }
   *  by firing a pickAt on the renderer that owns that canvas. */
  function resolvePickAt(canvas, cx, cy, fid, rendererIdx) {
    var rec = frameRecs[fid];
    if (!rec || rendererIdx >= rec.entries.length) { return null; }
    return rec.entries[rendererIdx].renderer;
  }

  /** Attach mouse/wheel listeners to a geom canvas.
   *  Multiple overlapping geom canvases per frame are each listened to. */
  function attachCanvasEvents(canvas, fid, meshIdx) {
    // Avoid double-attach
    if (canvas.__vfEventsAttached) { return; }
    canvas.__vfEventsAttached = true;
    canvas.style.pointerEvents = "auto";  // enable pointer events for geom canvases

    function canvasXY(e) {
      var r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function canvasXYscaled(e) {
      // Account for CSS pixels vs device pixels
      var r  = canvas.getBoundingClientRect();
      var sx = canvas.width  / (r.width  || 1);
      var sy = canvas.height / (r.height || 1);
      return {
        x:  (e.clientX - r.left) * sx,
        y:  (e.clientY - r.top)  * sy,
        cx: e.clientX - r.left,
        cy: e.clientY - r.top,
      };
    }

    function emitWithPick(evtType, e, extra) {
      var p = canvasXYscaled(e);
      var renderer = resolvePickAt(canvas, p.x, p.y, fid, meshIdx);
      if (!renderer) {
        postEvent(Object.assign({ type: "vf_event", event: evtType,
          x: p.cx, y: p.cy, frame_id: fid, object_id: 0, simplex_id: 0 }, extra));
        return;
      }
      renderer.pickAt(p.x, p.y, function(oid, sid) {
        postEvent(Object.assign({ type: "vf_event", event: evtType,
          x: p.cx, y: p.cy, frame_id: fid,
          object_id: oid, simplex_id: sid }, extra));
      });
    }

    canvas.addEventListener("mousemove", function(e) {
      // Move must be low-latency; do not gate it on async GPU picking.
      var p = canvasXY(e);
      postEvent({
        type: "vf_event",
        event: "move",
        x: p.x,
        y: p.y,
        frame_id: fid,
        object_id: 0,
        simplex_id: 0,
        buttons: Number(e.buttons) || 0
      });
    }, { passive: true });

    canvas.addEventListener("mousedown", function(e) {
      emitWithPick("down", e, { button: e.button });
    }, { passive: true });

    canvas.addEventListener("mouseup", function(e) {
      emitWithPick("up", e, { button: e.button });
    }, { passive: true });

    canvas.addEventListener("wheel", function(e) {
      try { e.__vfHandledWheel = true; } catch(_) {}
      var p = canvasXY(e);
      var step = e.deltaY > 0 ? 1 : -1;
      if (e && typeof e.preventDefault === "function") { e.preventDefault(); }
      postEvent({ type: "vf_event", event: "wheel",
        x: p.x, y: p.y, step: step, delta: Number(e.deltaY) || 0,
        ctrl: !!e.ctrlKey, frame_id: fid, object_id: 0, simplex_id: 0 });
    }, { passive: false });

    vlog("info", "attachCanvasEvents: frame=" + fid + " meshIdx=" + meshIdx);
  }

  // ── 2-D canvas helpers ────────────────────────────────────────────────────
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
      if (!o) { continue; }
      var p = normToPx(o.rect, w, h);
      if (!p) { continue; }
      ctx.fillStyle = o.color != null ? String(o.color) : "#888";
      if (o.op === "rect") {
        ctx.fillRect(p.x, p.y, p.rw, p.rh);
        continue;
      }
      if (o.op === "oval") {
        var cx = p.x + p.rw * 0.5;
        var cy = p.y + p.rh * 0.5;
        var rx = Math.max(0.5, p.rw * 0.5);
        var ry = Math.max(0.5, p.rh * 0.5);
        ctx.beginPath();
        if (typeof ctx.ellipse === "function") {
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        } else {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.scale(rx, ry);
          ctx.arc(0, 0, 1, 0, Math.PI * 2);
          ctx.restore();
        }
        ctx.fill();
      }
    }
  }

  var _globalWheelBridgeInstalled = false;
  var _globalDragBridgeInstalled = false;
  var _dragState = null; // { fid, lastX, lastY }
  function installGlobalWheelBridge() {
    if (_globalWheelBridgeInstalled) { return; }
    _globalWheelBridgeInstalled = true;
    document.addEventListener("wheel", function(e) {
      try {
        if (e && e.__vfHandledWheel) { return; }
        var t = e.target;
        if (!(t instanceof Element)) { return; }
        var frameEl = t.closest(".vf-frame");
        if (!frameEl) { return; } // do not steal wheel outside frames
        var fid = frameEl.getAttribute("data-vf-frame-id") || "";
        var r = frameEl.getBoundingClientRect();
        var x = e.clientX - r.left;
        var y = e.clientY - r.top;
        var dy = Number(e.deltaY) || 0;
        if (!dy) { return; }
        var step = dy > 0 ? 1 : -1;
        if (typeof e.preventDefault === "function") { e.preventDefault(); }
        postEvent({
          type: "vf_event",
          event: "wheel",
          x: x, y: y,
          step: step,
          delta: dy,
          ctrl: !!e.ctrlKey,
          frame_id: fid,
          object_id: 0,
          simplex_id: 0
        });
      } catch (_) {}
    }, { capture: true, passive: false });
  }

  function installGlobalDragBridge() {
    if (_globalDragBridgeInstalled) { return; }
    _globalDragBridgeInstalled = true;

    document.addEventListener("mousedown", function(e) {
      try {
        if (!e || e.button !== 0) { return; }
        var t = e.target;
        if (!(t instanceof Element)) { return; }
        var frameEl = t.closest(".vf-frame");
        if (!frameEl) { return; }
        var fid = frameEl.getAttribute("data-vf-frame-id") || "";
        _dragState = { fid: fid, lastX: e.clientX, lastY: e.clientY };
      } catch (_) {}
    }, true);

    document.addEventListener("mouseup", function(e) {
      try {
        if (e && e.button === 0) { _dragState = null; }
      } catch (_) {}
    }, true);

    document.addEventListener("mousemove", function(e) {
      try {
        if (!_dragState) { return; }
        var buttons = Number(e.buttons) || 0;
        if ((buttons & 1) === 0) {
          _dragState = null;
          return;
        }
        var dx = e.clientX - _dragState.lastX;
        var dy = e.clientY - _dragState.lastY;
        if (!dx && !dy) { return; }
        _dragState.lastX = e.clientX;
        _dragState.lastY = e.clientY;
        postEvent({
          type: "vf_event",
          event: "drag",
          x: e.clientX,
          y: e.clientY,
          dx: dx,
          dy: dy,
          button: 0,
          buttons: buttons,
          frame_id: _dragState.fid,
          object_id: 0,
          simplex_id: 0
        });
      } catch (_) {}
    }, true);
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

  // ── Euler ZYX rotation matrix (degrees) — column-major Float32Array ───────
  function mat4EulerZYX(rx, ry, rz) {
    var Mm = global.VfGeomMath;
    if (!Mm) {
      vlog("warn", "mat4EulerZYX: VfGeomMath not loaded, returning identity");
      return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
    }
    var toRad = Math.PI / 180;
    var cx = Math.cos(rx * toRad), sx = Math.sin(rx * toRad);
    var Rx = new Float32Array([1,0,0,0, 0,cx,sx,0, 0,-sx,cx,0, 0,0,0,1]);
    var cy = Math.cos(ry * toRad), sy = Math.sin(ry * toRad);
    var Ry = new Float32Array([cy,0,-sy,0, 0,1,0,0, sy,0,cy,0, 0,0,0,1]);
    var cz = Math.cos(rz * toRad), sz = Math.sin(rz * toRad);
    var Rz = new Float32Array([cz,sz,0,0, -sz,cz,0,0, 0,0,1,0, 0,0,0,1]);
    return Mm.mat4Mul(Mm.mat4Mul(Rz, Ry), Rx);
  }

  // Build model matrix: translate(center) * EulerZYX(rotation)
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
    if (!Core) {
      vlog("error", "buildSingleMesh: VfGeomCore not loaded");
      return null;
    }
    var mesh;
    if (spec.type === "box") {
      mesh = Core.buildBox([0,0,0], spec.scale || [1,1,1], spec.color || null, spec.id || "box");
    } else if (spec.type === "ellipsoid") {
      mesh = Core.buildSphere([0,0,0], 0.5, spec.color || null, spec.id || "ellipsoid");
    } else if (spec.type === "torus") {
      var major = Number(spec.major_radius);
      var minor = Number(spec.minor_radius);
      if (!(major > 0)) { major = 0.65; }
      if (!(minor > 0)) { minor = 0.22; }
      mesh = Core.buildTorus([0,0,0], major, minor, spec.color || null, spec.id || "torus");
    } else if (spec.preset) {
      mesh = Core.getPreset(spec.preset);
    } else {
      vlog("warn", "buildSingleMesh: unknown mesh spec type=" + spec.type);
      return null;
    }
    if (!mesh) {
      vlog("error", "buildSingleMesh: Core returned null for type=" + spec.type);
      return null;
    }
    var out = {};
    for (var k in mesh) { out[k] = mesh[k]; }
    out.camera   = camera || null;
    out.lights   = lights  || [];
    // Forward spec fields so vf-geom-wgpu.js can recompute TRS every frame
    out.center   = spec.center   || [0,0,0];
    out.rotation = spec.rotation || [0,0,0];
    out.scale    = spec.scale    || [1,1,1];
    out._modelMatrix = meshModelMatrix(spec);  // fallback if VfGeomMath.mat4ModelTRS absent
    return out;
  }

  // ── Per-frame renderer management ─────────────────────────────────────────

  function ensureGeomCanvas(frameEl, idx) {
    if (!frameEl) { return null; }
    var body = frameEl.querySelector(".vf-frame__body") || frameEl;
    var cls  = "vf-geom-canvas-" + idx;
    var existing = body.querySelector("canvas." + cls);
    if (existing) { return existing; }
    var c = document.createElement("canvas");
    c.className = "vf-geom-canvas " + cls;
    c.style.cssText = "display:block;width:100%;height:100%;position:absolute;inset:0;z-index:" + (10 + idx) + ";pointer-events:auto;";
    body.style.position = "relative";
    body.style.pointerEvents = "auto";
    body.appendChild(c);
    vlog("info", "ensureGeomCanvas: created canvas idx=" + idx + " for frame body (body w=" + body.offsetWidth + " h=" + body.offsetHeight + ")");
    return c;
  }

  // ── Notify native host of updated hit regions after geom frames change ─────
  var _layoutDebounceTimer = null;
  function schedulePostGeomLayout() {
    if (_layoutDebounceTimer) { clearTimeout(_layoutDebounceTimer); }
    _layoutDebounceTimer = setTimeout(function() {
      _layoutDebounceTimer = null;
      var layer = document.getElementById("layer") || document.getElementById("vf-layer") || document.body;
      if (global.VfFrame && typeof global.VfFrame.postNativeHostLayout === "function") {
        global.VfFrame.postNativeHostLayout(layer, { stageAlpha: 0 });
      }
    }, 50);
  }

  function _setDisplayHitRegions(regions) {
    try {
      global.__vfDisplayHitRegions = Array.isArray(regions) ? regions : [];
    } catch (_) {}
  }

  function _appendOvalHitRegions(out, p) {
    if (!p) { return; }
    var cx = p.x + p.rw * 0.5;
    var cy = p.y + p.rh * 0.5;
    var rx = Math.max(0.5, p.rw * 0.5);
    var ry = Math.max(0.5, p.rh * 0.5);
    var step = 4;
    var y0 = Math.floor(p.y);
    var y1 = Math.ceil(p.y + p.rh);
    for (var y = y0; y <= y1; y += step) {
      var yy = ((y + step * 0.5) - cy) / ry;
      var inside = 1 - yy * yy;
      if (inside <= 0) { continue; }
      var xh = rx * Math.sqrt(inside);
      out.push({
        left: Math.floor(cx - xh),
        top: y,
        right: Math.ceil(cx + xh),
        bottom: y + step
      });
    }
  }

  function buildScreenHitRegions(screenOps, w, h) {
    var out = [];
    if (!screenOps || !screenOps.length || !w || !h) { return out; }
    for (var i = 0; i < screenOps.length; i++) {
      var o = screenOps[i];
      if (!o) { continue; }
      var p = normToPx(o.rect, w, h);
      if (!p) { continue; }
      if (o.op === "rect") {
        out.push({
          left: Math.floor(p.x),
          top: Math.floor(p.y),
          right: Math.ceil(p.x + p.rw),
          bottom: Math.ceil(p.y + p.rh)
        });
      } else if (o.op === "oval") {
        _appendOvalHitRegions(out, p);
      }
    }
    return out;
  }

  function updateGeomFrame(fid, geomSpec) {
    var Ctor = global.VfGeomWgpu;
    if (!Ctor) {
      vlog("warn", "updateGeomFrame [" + fid + "]: VfGeomWgpu not loaded — geom skipped");
      return;
    }

    var frameEl = findFrameEl(fid);
    if (!frameEl) {
      vlog("warn", "updateGeomFrame [" + fid + "]: no DOM element .vf-frame[data-vf-frame-id=" + fid + "] found — frame not placed yet?");
      return;
    }

    var specs   = geomSpec.meshes || [];
    var camera  = geomSpec.camera || null;
    var lights  = geomSpec.lights || [];

    vlog("info", "updateGeomFrame [" + fid + "]: meshes=" + specs.length +
      " camera=" + (camera ? JSON.stringify(camera.pos) : "none") +
      " lights=" + lights.length);

    if (!frameRecs[fid]) { frameRecs[fid] = { entries: [] }; }
    var rec = frameRecs[fid];

    for (var i = 0; i < specs.length; i++) {
      var spec = specs[i];
      var mesh = buildSingleMesh(spec, camera, lights);
      if (!mesh) {
        vlog("warn", "updateGeomFrame [" + fid + "]: mesh " + i + " build failed, skipping");
        continue;
      }

      if (i < rec.entries.length) {
        rec.entries[i].ref.mesh = mesh;
        // log only on first few updates to avoid spam
        if (rec.entries[i]._logCount == null) { rec.entries[i]._logCount = 0; }
        rec.entries[i]._logCount++;
        if (rec.entries[i]._logCount <= 3) {
          vlog("info", "updateGeomFrame [" + fid + "]: updated renderer " + i +
            " center=" + JSON.stringify(spec.center) +
            " scale=" + JSON.stringify(spec.scale) +
            " rot=" + JSON.stringify(spec.rotation || [0,0,0]));
        }
      } else {
        // Spawn new renderer
        var canvas = ensureGeomCanvas(frameEl, i);
        if (!canvas) {
          vlog("error", "updateGeomFrame [" + fid + "]: could not create canvas for mesh " + i);
          continue;
        }
        var sz = syncCanvasSize(canvas);
        vlog("info", "updateGeomFrame [" + fid + "]: spawning renderer " + i +
          " canvas=" + (sz ? sz.w + "x" + sz.h : "?") +
          " mesh.type=" + spec.type +
          " center=" + JSON.stringify(spec.center) +
          " scale=" + JSON.stringify(spec.scale) +
          " cam=" + (camera ? JSON.stringify(camera.pos) : "none"));

        var refHolder = { mesh: mesh };
        (function(rh, fidInner, meshIdx, cv) {
          var entry = { renderer: null, ref: rh, _logCount: 0 };
          rec.entries.push(entry);
          var r = new Ctor(canvas, function() { return rh.mesh; });
          entry.renderer = r;
          // Assign stable object_id (1-based: 0 means "no object")
          r._objectId = meshIdx + 1;
          r.init().then(function(ok) {
            if (!ok) {
              vlog("error", "updateGeomFrame [" + fidInner + "]: renderer " + meshIdx + " init FAILED (WebGPU unavailable?)");
            } else {
              vlog("info", "updateGeomFrame [" + fidInner + "]: renderer " + meshIdx + " init OK, starting render loop");
              r.start();
              attachCanvasEvents(cv, fidInner, meshIdx);
            }
          }).catch(function(err) {
            vlog("error", "updateGeomFrame [" + fidInner + "]: renderer " + meshIdx + " init threw: " + (err && err.message ? err.message : String(err)));
          });
        })(refHolder, fid, i, canvas);
      }
    }

    // Stop renderers for meshes that were removed
    for (var j = specs.length; j < rec.entries.length; j++) {
      try {
        vlog("info", "updateGeomFrame [" + fid + "]: stopping renderer " + j + " (mesh removed)");
        rec.entries[j].renderer.stop();
      } catch(_) {}
      rec.entries[j].ref.mesh = null;
    }
    // Notify native host of updated hit regions (geom canvases)
    schedulePostGeomLayout();
  }

  // ── Main render from JSON ─────────────────────────────────────────────────

  function renderFromJson(data) {
    if (!data || typeof data !== "object") {
      vlog("warn", "renderFromJson: data is null or not an object");
      return;
    }

    // Log a summary of what arrived (suppress repeat spam)
    var geomKeys = data.geom ? Object.keys(data.geom) : [];
    var summary = "geomFrames=" + geomKeys.length +
      " screenOps=" + (data.screen ? data.screen.length : 0) +
      " frameKeys=" + (data.frames ? Object.keys(data.frames).length : 0);
    if (summary !== _lastPayloadSummary) {
      vlog("info", "renderFromJson: " + summary + " geomIds=[" + geomKeys.join(",") + "]");
      _lastPayloadSummary = summary;
    }

    // 2-D screen canvas
    var sc = document.getElementById("vf-screen-canvas");
    if (sc) {
      var sz = syncCanvasSize(sc);
      if (sz) {
        drawOpList(get2d(sc), sz.w, sz.h, data.screen);
        _setDisplayHitRegions(buildScreenHitRegions(data.screen, sz.w, sz.h));
        schedulePostGeomLayout();
      } else {
        _setDisplayHitRegions([]);
      }
    } else {
      _setDisplayHitRegions([]);
    }

    // 2-D per-frame canvases
    var frames = data.frames;
    if (frames && typeof frames === "object") {
      for (var fid in frames) {
        if (!Object.prototype.hasOwnProperty.call(frames, fid)) { continue; }
        var el = findFrameEl(fid);
        if (!el) {
          vlog("warn", "renderFromJson: 2D frame [" + fid + "] not found in DOM");
          continue;
        }
        var cv = el.querySelector("canvas.vf-frame__draw-canvas");
        if (!cv) { continue; }
        var fsz = syncCanvasSize(cv);
        if (!fsz) { continue; }
        drawOpList(get2d(cv), fsz.w, fsz.h, frames[fid]);
      }
    }

    // 3-D geom
    var geom = data.geom;
    if (geom && typeof geom === "object") {
      for (var gid in geom) {
        if (!Object.prototype.hasOwnProperty.call(geom, gid)) { continue; }
        updateGeomFrame(gid, geom[gid]);
      }
    }
  }

  // ── Fetch + render cycle ──────────────────────────────────────────────────

  function displayJsonUrl() {
    if (typeof location === "undefined" || !location.href) { return "vf-display.json"; }
    var path = location.pathname || "/";
    var i = path.lastIndexOf("/");
    var base = i >= 0 ? path.substring(0, i+1) : "/";
    return base + "vf-display.json";
  }

  var _lastFetchFailed = false;
  var _lastFetchText   = "";
  var _fetchInFlight   = false;   // prevent fetch pile-up at 60 fps

  function loadAndRender() {
    if (typeof fetch === "undefined") {
      vlog("warn", "loadAndRender: fetch not available");
      return;
    }
    if (_fetchInFlight) { return; }   // previous frame's fetch not done yet — skip
    _fetchInFlight = true;
    var url = displayJsonUrl();        // no cache-buster — cache:"no-store" is enough
    fetch(url, { cache: "no-store" })
      .then(function(r) {
        if (!r.ok) {
          if (!_lastFetchFailed) {
            vlog("warn", "loadAndRender: vf-display.json fetch " + r.status + " (file may not exist yet)");
            _lastFetchFailed = true;
          }
          return null;
        }
        _lastFetchFailed = false;
        return r.text();
      })
      .then(function(t) {
        if (t == null) { return; }
        if (t === _lastFetchText) { return; }  // no change, skip parse
        _lastFetchText = t;
        var o; try { o = JSON.parse(t); } catch(e) {
          vlog("error", "loadAndRender: JSON.parse failed: " + e.message + " (first 200 chars: " + t.slice(0,200) + ")");
          return;
        }
        renderFromJson(o);
      })
      .catch(function(err) {
        vlog("warn", "loadAndRender: fetch error: " + (err && err.message ? err.message : String(err)));
      })
      .finally(function() { _fetchInFlight = false; });
  }

  // ── Dependency check on load ──────────────────────────────────────────────
  // Logged once after a short delay so other scripts have time to register.
  setTimeout(function() {
    vlog("info", "dependency check: VfGeomCore=" + (!!global.VfGeomCore) +
      " VfGeomMath=" + (!!global.VfGeomMath) +
      " VfGeomWgpu=" + (!!global.VfGeomWgpu));
    if (!global.VfGeomCore)  { vlog("warn", "VfGeomCore not found — vf-geom-core.js may not be loaded or failed"); }
    if (!global.VfGeomMath)  { vlog("warn", "VfGeomMath not found — vf-geom-math.js may not be loaded or failed"); }
    if (!global.VfGeomWgpu)  { vlog("warn", "VfGeomWgpu not found — vf-geom-wgpu.js may not be loaded or failed"); }
  }, 800);

  // ── Keyboard events ────────────────────────────────────────────────────
  // Attached to window once — keyboard events have no natural canvas target.
  (function() {
    if (global.__vfKeyboardAttached) { return; }
    global.__vfKeyboardAttached = true;

    function activeFrameId() {
      // Try to find which frame has focus or is under the pointer
      var active = document.activeElement;
      if (active) {
        var fr = active.closest && active.closest(".vf-frame");
        if (fr) { return fr.getAttribute("data-vf-frame-id") || ""; }
      }
      return "";
    }

    function keyEvt(evtName, e) {
      postEvent({
        type:     "vf_event",
        event:    evtName,
        key:      e.key,
        code:     e.code || "",
        ctrl:     e.ctrlKey  || false,
        shift:    e.shiftKey || false,
        alt:      e.altKey   || false,
        frame_id: activeFrameId(),
      });
    }

    global.addEventListener("keydown", function(e) { keyEvt("key_down", e); }, { passive: true, capture: true });
    global.addEventListener("keyup",   function(e) { keyEvt("key_up",   e); }, { passive: true, capture: true });
    vlog("info", "keyboard listeners attached");
  })();

  installGlobalWheelBridge();
  installGlobalDragBridge();
  global.VfDisplay = { renderFromJson: renderFromJson, loadAndRender: loadAndRender };
  vlog("info", "VfDisplay registered");
})(typeof window !== "undefined" ? window : this);
