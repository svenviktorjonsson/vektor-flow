/**
 * Tiny chess-piece animation planner/runtime helper.
 *
 * VKF owns the rules and emits an AnimationPlan. This helper only turns that
 * plan into deterministic per-frame transforms for the renderer.
 */
(function(global) {
  "use strict";

  if (global.VfChessPieceAnimation) { return; }

  function numberOr(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, numberOr(value, 0)));
  }

  function smoothstep(t) {
    t = clamp01(t);
    return t * t * (3 - 2 * t);
  }

  function ease(plan, t) {
    var easing = plan && plan.easing != null ? String(plan.easing) : "linear";
    if (easing === "smoothstep") {
      return smoothstep(t);
    }
    return clamp01(t);
  }

  function samplePlan(plan, elapsedMs) {
    plan = plan || {};
    var duration = Math.max(0, numberOr(plan.duration_ms, 0));
    var raw = duration <= 0 ? 1 : numberOr(elapsedMs, 0) / duration;
    var t = clamp01(raw);
    var a = ease(plan, t);
    var fromX = numberOr(plan.from_x, 0);
    var fromZ = numberOr(plan.from_z, 0);
    var toX = numberOr(plan.to_x, fromX);
    var toZ = numberOr(plan.to_z, fromZ);
    var lift = Math.max(0, numberOr(plan.lift, 0));
    var arc = Math.sin(Math.PI * a) * lift;
    if (Math.abs(arc) < 1e-12) { arc = 0; }
    var captureAt = Math.max(0, numberOr(plan.capture_at_ms, 0));
    var kind = plan.kind != null ? String(plan.kind) : "none";
    return {
      kind: kind,
      done: t >= 1,
      progress: t,
      eased: a,
      x: fromX + (toX - fromX) * a,
      y: arc,
      z: fromZ + (toZ - fromZ) * a,
      hideCaptured: kind === "capture" && captureAt > 0 && numberOr(elapsedMs, 0) >= captureAt
    };
  }

  function createAnimator(plan, callbacks, options) {
    callbacks = callbacks || {};
    options = options || {};
    var raf = options.requestAnimationFrame || global.requestAnimationFrame;
    var now = options.now || function() { return Date.now(); };
    var cancelled = false;
    var start = now();
    if (typeof raf !== "function") {
      throw new Error("createAnimator requires requestAnimationFrame");
    }
    function tick(ts) {
      if (cancelled) { return; }
      var current = Number.isFinite(Number(ts)) ? Number(ts) : now();
      var sample = samplePlan(plan, current - start);
      if (typeof callbacks.onFrame === "function") {
        callbacks.onFrame(sample);
      }
      if (!sample.done) {
        raf(tick);
      } else if (typeof callbacks.onDone === "function") {
        callbacks.onDone(sample);
      }
    }
    raf(tick);
    return {
      cancel: function() {
        cancelled = true;
      }
    };
  }

  global.VfChessPieceAnimation = {
    smoothstep: smoothstep,
    samplePlan: samplePlan,
    createAnimator: createAnimator
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.VfChessPieceAnimation;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
