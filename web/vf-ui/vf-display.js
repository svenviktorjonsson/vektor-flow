/**
 * Filled rects from ``vf-display.json`` (``d.draw`` / ``d.draw_rect`` → ``screen``;
 * ``f.draw`` / ``f.draw_rect`` → per-frame in ``frames``).
 *
 * Uses **Canvas 2D** only — reliable in WebView2 with a transparent host (WebGL2 is optional later).
 */
(function (global) {
  "use strict";

  var ctxCache = new WeakMap();

  function get2d(canvas) {
    if (!canvas) {
      return null;
    }
    var c = ctxCache.get(canvas);
    if (c) {
      return c;
    }
    c = canvas.getContext("2d", { alpha: true });
    if (c) {
      ctxCache.set(canvas, c);
    }
    return c;
  }

  function normToPx(rect, w, h) {
    if (!rect || rect.length < 4) {
      return null;
    }
    return {
      x: rect[0] * w,
      y: rect[1] * h,
      rw: rect[2] * w,
      rh: rect[3] * h,
    };
  }

  function drawOpList(ctx, w, h, ops) {
    if (!w || !h || !ctx) {
      return;
    }
    ctx.clearRect(0, 0, w, h);
    if (!ops || !ops.length) {
      return;
    }
    for (var i = 0; i < ops.length; i++) {
      var o = ops[i];
      if (!o || o.op !== "rect") {
        continue;
      }
      var p = normToPx(o.rect, w, h);
      if (!p) {
        continue;
      }
      ctx.fillStyle = o.color != null ? String(o.color) : "#888";
      ctx.fillRect(p.x, p.y, p.rw, p.rh);
    }
  }

  function syncCanvasSize(canvas) {
    if (!canvas) {
      return null;
    }
    var pr = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.floor(pr.width));
    var h = Math.max(1, Math.floor(pr.height));
    if (canvas.width !== w) {
      canvas.width = w;
    }
    if (canvas.height !== h) {
      canvas.height = h;
    }
    return { w: w, h: h };
  }

  function renderFromJson(data) {
    if (!data || typeof data !== "object") {
      return;
    }
    var sc = document.getElementById("vf-screen-canvas");
    if (sc) {
      var sz = syncCanvasSize(sc);
      if (sz) {
        var sctx = get2d(sc);
        drawOpList(sctx, sz.w, sz.h, data.screen);
      }
    }
    var frames = data.frames;
    if (!frames || typeof frames !== "object") {
      return;
    }
    for (var fid in frames) {
      if (!Object.prototype.hasOwnProperty.call(frames, fid)) {
        continue;
      }
      var el = null;
      try {
        if (global.CSS && typeof global.CSS.escape === "function") {
          el = document.querySelector(
            ".vf-frame[data-vf-frame-id=\"" + global.CSS.escape(String(fid)) + "\"]"
          );
        } else {
          el = document.querySelector(
            ".vf-frame[data-vf-frame-id=\"" + String(fid).replace(/["\\]/g, "") + "\"]"
          );
        }
      } catch (_) {
        el = null;
      }
      if (!el) {
        continue;
      }
      var c = el.querySelector("canvas.vf-frame__draw-canvas");
      if (!c) {
        continue;
      }
      var fsz = syncCanvasSize(c);
      if (!fsz) {
        continue;
      }
      var fctx = get2d(c);
      drawOpList(fctx, fsz.w, fsz.h, frames[fid]);
    }
  }

  function displayJsonUrl() {
    if (typeof location === "undefined" || !location.href) {
      return "vf-display.json";
    }
    var path = location.pathname || "/";
    var i = path.lastIndexOf("/");
    var base = i >= 0 ? path.substring(0, i + 1) : "/";
    return base + "vf-display.json";
  }

  function loadAndRender() {
    if (typeof fetch === "undefined") {
      return;
    }
    fetch(displayJsonUrl() + "?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) {
          if (global.console && global.console.warn) {
            global.console.warn("vf-display: " + r.status + " " + displayJsonUrl());
          }
          return null;
        }
        return r.text();
      })
      .then(function (t) {
        if (t == null) {
          return;
        }
        var o;
        try {
          o = JSON.parse(t);
        } catch (e) {
          if (global.console && global.console.warn) {
            global.console.warn("vf-display: JSON", e);
          }
          return;
        }
        renderFromJson(o);
      })
      .catch(function (e) {
        if (global.console && global.console.warn) {
          global.console.warn("vf-display: fetch", e);
        }
      });
  }

  global.VfDisplay = {
    renderFromJson: renderFromJson,
    loadAndRender: loadAndRender,
  };
})(typeof window !== "undefined" ? window : this);
