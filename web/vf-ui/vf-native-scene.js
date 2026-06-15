/*
 * vf-native-scene.js -- generic native scene runtime
 *
 * First-pass physically motivated penumbra: a planar projected shadow from the
 * orbiting light onto the receiver plane. Edge softness comes from source
 * radius, receiver gap, light distance, and grazing angle on the plane.
 */
(function (global) {
  "use strict";

  var rootConfig = global.__vfNativeSceneConfig;
  if (!rootConfig || typeof rootConfig !== "object") {
    throw new Error("native_scene runtime requires window.__vfNativeSceneConfig");
  }
  var config = rootConfig.scene_ir || rootConfig;
  var frameSpec = config.frame || {};
  var renderOptions = config.render_options || {};
  if (!global.__vfNativeSceneLiveCameras) {
    global.__vfNativeSceneLiveCameras = Object.create(null);
  }
  if (!global.__vfNativeSceneFrameDependents) {
    global.__vfNativeSceneFrameDependents = Object.create(null);
  }
  var surfaceWorlds = config.surface_worlds && typeof config.surface_worlds === "object" ? config.surface_worlds : {};
  var surfaceCameras = config.surface_cameras && typeof config.surface_cameras === "object" ? config.surface_cameras : {};
  var timingCfg = config.timing || {};
  var fps = Math.max(1, Number(timingCfg.fps || 30) | 0);
  var durationSeconds = Math.max(0.001, Number(timingCfg.duration_seconds || 10.0));
  var boundary = String(timingCfg.boundary || "repeat");
  var frameCount = Math.max(1, Math.round(fps * durationSeconds));
  var AXIS_TAGGED_KEY = "__vf_axis_tagged__";

  function chessLagDebugEnabled() {
    return !!(
      global.__vfChessLagDebug === true ||
      renderOptions.debug_lag === true ||
      renderOptions.chess_lag_debug === true
    );
  }

  function chessLagDebug(text) {
    if (!chessLagDebugEnabled()) { return; }
    var message = "[DEBUG-chess-lag] native_scene frame=" + String(frameSpec.frame_id || "") + " " + String(text || "");
    try {
      if (global.console && global.console.warn) {
        global.console.warn(message);
      }
    } catch (_) {}
    try {
      if (global.chrome && global.chrome.webview && typeof global.chrome.webview.postMessage === "function") {
        global.chrome.webview.postMessage({ type: "vf_log", level: "warn", message: message, t: Date.now() });
      }
    } catch (_) {}
  }

  function showFatalOverlay(text) {
    try {
      var doc = global.document;
      if (!doc) { return; }
      var frameId = String(frameSpec.frame_id || "");
      var host = frameId
        ? doc.querySelector('.vf-frame[data-vf-frame-id="' + frameId + '"] .vf-frame__body')
        : null;
      if (!host) { host = doc.body; }
      if (!host) { return; }
      var existing = doc.getElementById("vf-native-scene-fatal");
      if (!existing) {
        existing = doc.createElement("div");
        existing.id = "vf-native-scene-fatal";
        existing.style.position = "absolute";
        existing.style.inset = "0";
        existing.style.zIndex = "9999";
        existing.style.display = "flex";
        existing.style.alignItems = "center";
        existing.style.justifyContent = "center";
        existing.style.padding = "24px";
        existing.style.background = "rgba(20,12,16,0.92)";
        existing.style.color = "#ffd7df";
        existing.style.font = "600 14px/1.45 Consolas, Menlo, monospace";
        existing.style.whiteSpace = "pre-wrap";
        existing.style.textAlign = "left";
        if (host !== doc.body) {
          var computedPosition = "";
          try { computedPosition = global.getComputedStyle(host).position || ""; } catch (_) {}
          if (!computedPosition || computedPosition === "static") {
            host.style.position = "relative";
          }
        } else {
          existing.style.position = "fixed";
        }
        host.appendChild(existing);
      }
      existing.textContent = String(text);
    } catch (_) {}
  }

  function showStatusOverlay(text) {
    try {
      var doc = global.document;
      if (!doc) { return; }
      var frameId = String(frameSpec.frame_id || "");
      var host = frameId
        ? doc.querySelector('.vf-frame[data-vf-frame-id="' + frameId + '"] .vf-frame__body')
        : null;
      if (!host) { return; }
      var existing = doc.getElementById("vf-native-scene-status");
      if (!existing) {
        existing = doc.createElement("div");
        existing.id = "vf-native-scene-status";
        existing.style.position = "absolute";
        existing.style.left = "8px";
        existing.style.top = "8px";
        existing.style.zIndex = "9998";
        existing.style.maxWidth = "calc(100% - 16px)";
        existing.style.padding = "6px 8px";
        existing.style.background = "rgba(10,14,20,0.72)";
        existing.style.color = "#d9e7ff";
        existing.style.font = "12px/1.35 Consolas, Menlo, monospace";
        existing.style.whiteSpace = "pre-wrap";
        existing.style.pointerEvents = "none";
        existing.style.borderRadius = "6px";
        existing.style.boxShadow = "0 2px 10px rgba(0,0,0,0.35)";
        var computedPosition = "";
        try { computedPosition = global.getComputedStyle(host).position || ""; } catch (_) {}
        if (!computedPosition || computedPosition === "static") {
          host.style.position = "relative";
        }
        host.appendChild(existing);
      }
      existing.textContent = String(text);
    } catch (_) {}
  }

  function clearStatusOverlay() {
    try {
      var doc = global.document;
      if (!doc) { return; }
      var existing = doc.getElementById("vf-native-scene-status");
      if (existing && existing.parentNode) {
        existing.parentNode.removeChild(existing);
      }
    } catch (_) {}
  }

  function visibleSpecSummary(spec) {
    if (!spec || typeof spec !== "object") {
      return "visibleSpec=null";
    }
    var meshes = Array.isArray(spec.meshes) ? spec.meshes.length : 0;
    var parts = Array.isArray(spec.parts) ? spec.parts.length : 0;
    var cam = spec.camera && typeof spec.camera === "object" ? spec.camera : null;
    var vpw = cam ? Number(cam.viewport_width_px || 0) : 0;
    var vph = cam ? Number(cam.viewport_height_px || 0) : 0;
    return [
      "visibleSpec.meshes=" + String(meshes),
      "visibleSpec.parts=" + String(parts),
      "camera.viewport=" + String(vpw) + "x" + String(vph),
      "unified=" + String(spec.unified_renderer === true)
    ].join("\n");
  }

  function failFast(message) {
    var text = "native_scene: " + String(message);
    try { console.error(text); } catch (_) {}
    try {
      if (global.chrome && global.chrome.webview && global.chrome.webview.postMessage) {
        global.chrome.webview.postMessage({ type: "vf_log", level: "error", message: text });
      }
    } catch (_) {}
    showFatalOverlay(text);
    throw new Error(text);
  }

  global.__vfGeomRuntimeErrorHandler = function (message) {
    failFast("shared renderer frame error: " + String(message || "unknown"));
  };

  function requireRuntime() {
    if (!global.VfDisplay || typeof global.VfDisplay.renderFromJson !== "function") {
      return false;
    }
    return true;
  }

  function clamp01(value) {
    return Math.max(0.0, Math.min(1.0, Number(value) || 0.0));
  }

  function smoothstep(edge0, edge1, x) {
    var t = clamp01((Number(x) - Number(edge0)) / Math.max(1e-6, Number(edge1) - Number(edge0)));
    return t * t * (3.0 - (2.0 * t));
  }

  function toVec3(value, fallback) {
    if (!Array.isArray(value) || value.length !== 3) { return fallback.slice(); }
    return [Number(value[0]), Number(value[1]), Number(value[2])];
  }

  function toRgba(value, fallback) {
    if (!Array.isArray(value) || value.length !== 4) { return fallback.slice(); }
    return [Number(value[0]), Number(value[1]), Number(value[2]), Number(value[3])];
  }

  function identityMat4() {
    return [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ];
  }

  function isEncodedAxisTaggedValue(value) {
    return !!value && typeof value === "object" && value[AXIS_TAGGED_KEY] === true;
  }

  function encodedAxisTaggedIdx(value) {
    return isEncodedAxisTaggedValue(value) ? String(value.idx || "") : "";
  }

  function encodedAxisTaggedData(value) {
    return isEncodedAxisTaggedValue(value) ? value.data : value;
  }

  function trackLengthForAxis(value, axisPos) {
    var cur = value;
    for (var i = 0; i < axisPos; i += 1) {
      if (!Array.isArray(cur) || !cur.length) { return 0; }
      cur = cur[0];
    }
    return Array.isArray(cur) ? cur.length : 0;
  }

  function sliceAxisAt(value, axisPos, sampleIndex) {
    if (axisPos <= 0) {
      return Array.isArray(value) ? value[sampleIndex] : value;
    }
    if (!Array.isArray(value)) { return value; }
    return value.map(function (item) {
      return sliceAxisAt(item, axisPos - 1, sampleIndex);
    });
  }

  function entityProperties(entity) {
    if (entity && entity.properties && typeof entity.properties === "object") {
      return entity.properties;
    }
    return entity && typeof entity === "object" ? entity : {};
  }

  function entityEmbedding(entity) {
    return entity && entity.embedding && typeof entity.embedding === "object"
      ? entity.embedding
      : {};
  }

  function entityPropName(entity, canonicalName) {
    var embedding = entityEmbedding(entity);
    return String(embedding[canonicalName] || canonicalName);
  }

  function entityProp(entity, canonicalName, fallback) {
    var props = entityProperties(entity);
    var propName = entityPropName(entity, canonicalName);
    if (Object.prototype.hasOwnProperty.call(props, propName)) {
      return props[propName];
    }
    if (entity && Object.prototype.hasOwnProperty.call(entity, canonicalName)) {
      return entity[canonicalName];
    }
    return fallback;
  }

  function entityStateEmbeddings(entity) {
    var states = entityProp(entity, "state_embeddings", null);
    if (states && typeof states === "object" && !Array.isArray(states)) {
      return states;
    }
    states = entityProp(entity, "visual_states", null);
    if (states && typeof states === "object" && !Array.isArray(states)) {
      return states;
    }
    return null;
  }

  function cloneEntityStateValue(value) {
    if (Array.isArray(value)) {
      return value.map(function (item) { return cloneEntityStateValue(item); });
    }
    if (value && typeof value === "object") {
      var cloned = {};
      var keys = Object.keys(value);
      for (var i = 0; i < keys.length; i += 1) {
        cloned[keys[i]] = cloneEntityStateValue(value[keys[i]]);
      }
      return cloned;
    }
    return value;
  }

  function applyEntityStateEmbedding(entity, stateName) {
    var states = entityStateEmbeddings(entity);
    var key = String(stateName || "");
    var state = states && states[key];
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      return false;
    }
    setEntityProp(entity, "visual_state", key);
    setEntityProp(entity, "active_state", key);
    var fields = Object.keys(state);
    for (var i = 0; i < fields.length; i += 1) {
      setEntityProp(entity, fields[i], cloneEntityStateValue(state[fields[i]]));
    }
    return true;
  }

  function makeCamera(cfg, fallback, seconds) {
    var camera = cfg || {};
    var framePos = animationFramePosition(seconds || 0.0);
    return {
      pos: sampleVec3Track(entityTrack(camera, "pos"), framePos, toVec3(entityProp(camera, "pos", fallback.pos), fallback.pos)),
      target: sampleVec3Track(entityTrack(camera, "target"), framePos, toVec3(entityProp(camera, "target", fallback.target), fallback.target)),
      fov: sampleNumberTrack(entityTrack(camera, "fov"), framePos, Number(entityProp(camera, "fov", fallback.fov) || fallback.fov)),
      up: sampleVec3Track(entityTrack(camera, "up"), framePos, toVec3(entityProp(camera, "up", fallback.up), fallback.up)),
      min_distance: Number(entityProp(camera, "min_distance", fallback.min_distance == null ? 0.0 : fallback.min_distance) || 0.0),
      flip_x: entityProp(camera, "flip_x", fallback.flip_x === true) === true
    };
  }

  function zoomCamera(camera, zoomFactor) {
    var pos = toVec3(camera.pos, [0, 0, 5]);
    var target = toVec3(camera.target, [0, 0, 0]);
    var dx = pos[0] - target[0];
    var dy = pos[1] - target[1];
    var dz = pos[2] - target[2];
    var currentDistance = Math.sqrt((dx * dx) + (dy * dy) + (dz * dz)) || 1.0;
    var nextFactor = Math.max(1e-6, Number(zoomFactor || 1.0));
    var nextDistance = currentDistance * nextFactor;
    var minDistance = Number(camera.min_distance == null ? 0.0 : camera.min_distance);
    var safetyMinDistance = Math.max(1e-4, minDistance);
    nextDistance = Math.max(safetyMinDistance, nextDistance);
    nextFactor = nextDistance / currentDistance;
    return {
      pos: [target[0] + (dx * nextFactor), target[1] + (dy * nextFactor), target[2] + (dz * nextFactor)],
      target: target.slice(),
      fov: Number(camera.fov || 34),
      up: toVec3(camera.up, [0, 0, 1]),
      min_distance: minDistance,
      flip_x: camera.flip_x === true
    };
  }

  function orbitCameraAroundTarget(camera, phiRad, thetaRad) {
    var pos = toVec3(camera.pos, [0, 0, 5]);
    var target = toVec3(camera.target, [0, 0, 0]);
    var dx = Number(pos[0]) - Number(target[0]);
    var dy = Number(pos[1]) - Number(target[1]);
    var dz = Number(pos[2]) - Number(target[2]);
    var radius = Math.sqrt((dx * dx) + (dy * dy) + (dz * dz)) || 1.0;
    var basePhi = Math.atan2(dy, dx);
    var baseTheta = Math.atan2(dz, Math.sqrt((dx * dx) + (dy * dy)) || 1e-6);
    var nextPhi = basePhi + (Number(phiRad) || 0.0);
    var thetaLimit = (Math.PI * 0.5) - 1e-3;
    var nextTheta = Math.max(-thetaLimit, Math.min(thetaLimit, baseTheta + (Number(thetaRad) || 0.0)));
    var cosTheta = Math.cos(nextTheta);
    return {
      pos: [
        target[0] + (radius * cosTheta * Math.cos(nextPhi)),
        target[1] + (radius * cosTheta * Math.sin(nextPhi)),
        target[2] + (radius * Math.sin(nextTheta))
      ],
      target: target.slice(),
      fov: Number(camera.fov || 34),
      up: toVec3(camera.up, [0, 0, 1]),
      min_distance: Number(camera.min_distance == null ? 0.0 : camera.min_distance) || 0.0,
      flip_x: camera.flip_x === true
    };
  }

  function rotateCameraLookAroundEye(camera, angleRad) {
    var pos = toVec3(camera && camera.pos, [0.0, 0.0, 0.0]);
    var target = toVec3(camera && camera.target, [0.0, 0.0, 1.0]);
    var up = normalize3(toVec3(camera && camera.up, [0.0, 0.0, 1.0]), [0.0, 0.0, 1.0]);
    var dx = Number(target[0]) - Number(pos[0]);
    var dy = Number(target[1]) - Number(pos[1]);
    var dz = Number(target[2]) - Number(pos[2]);
    var c = Math.cos(Number(angleRad || 0.0));
    var s = Math.sin(Number(angleRad || 0.0));
    var rx = (c * dx) - (s * dy);
    var ry = (s * dx) + (c * dy);
    return {
      pos: pos,
      target: [Number(pos[0]) + rx, Number(pos[1]) + ry, Number(pos[2]) + dz],
      up: up,
      fov: Number(camera && camera.fov || 34.0) || 34.0,
      min_distance: Number(camera && camera.min_distance || 0.0) || 0.0,
      flip_x: camera && camera.flip_x === true
    };
  }

  function cloneCameraState(camera, fallback) {
    var source = camera && typeof camera === "object" ? camera : (fallback || {});
    var fov = Number(source.fov || (fallback && fallback.fov) || 34);
    if (Array.isArray(source.projection_matrix) && source.projection_matrix.length === 16) {
      var projScaleY = Math.abs(Number(source.projection_matrix[5] || 0.0));
      if (projScaleY > 1e-6) {
        fov = 2.0 * Math.atan(1.0 / projScaleY) * 180.0 / Math.PI;
      }
    }
    var cloned = {
      pos: toVec3(source.pos, toVec3(fallback && fallback.pos, [0, 0, 5])),
      target: toVec3(source.target, toVec3(fallback && fallback.target, [0, 0, 0])),
      fov: fov,
      up: toVec3(source.up, toVec3(fallback && fallback.up, [0, 0, 1])),
      min_distance: Number(source.min_distance == null ? ((fallback && fallback.min_distance) == null ? 0.0 : fallback.min_distance) : source.min_distance) || 0.0,
      flip_x: source.flip_x === true || (!!fallback && fallback.flip_x === true)
    };
    if (Array.isArray(source.view_matrix) && source.view_matrix.length === 16) {
      cloned.view_matrix = source.view_matrix.slice();
    }
    if (Array.isArray(source.projection_matrix) && source.projection_matrix.length === 16) {
      cloned.projection_matrix = source.projection_matrix.slice();
    }
    if (source && source._mirrorDebug && typeof source._mirrorDebug === "object") {
      cloned._mirrorDebug = cloneJsonValue(source._mirrorDebug);
    }
    if (Array.isArray(source._mirrorViewProjection) && source._mirrorViewProjection.length === 16) {
      cloned._mirrorViewProjection = source._mirrorViewProjection.slice();
    }
    return cloned;
  }

  function cameraOrbitStepRadians(cameraConfig) {
    var stepDeg = Number(entityProp(cameraConfig || {}, "orbit_step_deg", 5.0));
    if (!Number.isFinite(stepDeg) || Math.abs(stepDeg) < 1e-6) { stepDeg = 5.0; }
    return stepDeg * Math.PI / 180.0;
  }

  function cameraDistance(camera) {
    var pos = toVec3(camera.pos, [0, 0, 5]);
    var target = toVec3(camera.target, [0, 0, 0]);
    var dx = pos[0] - target[0];
    var dy = pos[1] - target[1];
    var dz = pos[2] - target[2];
    return Math.sqrt((dx * dx) + (dy * dy) + (dz * dz)) || 1.0;
  }

  function cloneJsonValue(value) {
    if (Array.isArray(value)) {
      return value.map(cloneJsonValue);
    }
    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(value)) {
      if (value instanceof DataView) {
        return new DataView(value.buffer.slice(0), value.byteOffset, value.byteLength);
      }
      return new value.constructor(value);
    }
    if (value && typeof value === "object") {
      var out = {};
      for (var key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          out[key] = cloneJsonValue(value[key]);
        }
      }
      return out;
    }
    return value;
  }

  function normalizeSurfaceCameraSpec(source, fallback) {
    var spec = source && typeof source === "object" ? source : {};
    var base = fallback && typeof fallback === "object" ? fallback : {};
    var out = {
      pos: toVec3(spec.pos, toVec3(base.pos, [1.9, -2.2, 1.4])),
      target: toVec3(spec.target, toVec3(base.target, [0.0, 0.0, 0.0])),
      up: toVec3(spec.up, toVec3(base.up, [0.0, 0.0, 1.0])),
      fov: Number(spec.fov == null ? (base.fov == null ? 34.0 : base.fov) : spec.fov) || 34.0,
      distance: Math.max(0.4, Number(spec.distance == null ? (base.distance == null ? 2.6 : base.distance) : spec.distance) || 2.6)
    };
    var mirrorOf = spec && spec.mirror_of && typeof spec.mirror_of === "object" ? spec.mirror_of : null;
    if (mirrorOf) {
      out.reflect_of_frame_id = String(mirrorOf.frame_id || "");
      out.reflect_mirror_mesh_id = String(mirrorOf.mesh_id || "");
      out.aperture_mirror_mesh_id = String(mirrorOf.mesh_id || "");
      out.reflect_eye_only = mirrorOf.reflect_eye_only !== false;
      out.lock_aperture_camera = mirrorOf.lock_aperture_camera !== false;
      out.controls_enabled = mirrorOf.controls_enabled === true;
    }
    if (spec.reflect_of_frame_id !== undefined) { out.reflect_of_frame_id = String(spec.reflect_of_frame_id || ""); }
    if (spec.reflect_mirror_mesh_id !== undefined) { out.reflect_mirror_mesh_id = String(spec.reflect_mirror_mesh_id || ""); }
    if (spec.aperture_mirror_mesh_id !== undefined) { out.aperture_mirror_mesh_id = String(spec.aperture_mirror_mesh_id || ""); }
    if (spec.reflect_eye_only !== undefined) { out.reflect_eye_only = spec.reflect_eye_only === true; }
    if (spec.lock_aperture_camera !== undefined) { out.lock_aperture_camera = spec.lock_aperture_camera === true; }
    if (spec.controls_enabled !== undefined) { out.controls_enabled = spec.controls_enabled === true; }
    if (spec.flip_x !== undefined) { out.flip_x = spec.flip_x === true; }
    return out;
  }

  function resolveSurfaceCamera(system, viewerCamera) {
    var screen = system && typeof system === "object" ? system : {};
    var cameraRef = String(screen.camera_ref || "");
    var currentViewer = viewerCamera && typeof viewerCamera === "object"
      ? viewerCamera
      : { pos: [4.0, -5.0, 3.5], target: [0.0, 0.0, 0.0], up: [0.0, 0.0, 1.0], fov: 34.0 };
    if (cameraRef === "current") {
      var viewPos = toVec3(currentViewer.pos, [4.0, -5.0, 3.5]);
      var viewTarget = toVec3(currentViewer.target, [0.0, 0.0, 0.0]);
      var dx = viewPos[0] - viewTarget[0];
      var dy = viewPos[1] - viewTarget[1];
      var dz = viewPos[2] - viewTarget[2];
      var dist = Math.sqrt((dx * dx) + (dy * dy) + (dz * dz)) || 1.0;
      var desiredDistance = Math.max(0.4, Number(screen.camera_distance || 2.6) || 2.6);
      var scale = desiredDistance / dist;
      return {
        pos: [dx * scale, dy * scale, dz * scale],
        target: [0.0, 0.0, 0.0],
        up: toVec3(currentViewer.up, [0.0, 0.0, 1.0]),
        fov: Number(currentViewer.fov || 34.0),
        distance: desiredDistance
      };
    }
    if (cameraRef && global.__vfNativeSceneLiveCameras && Object.prototype.hasOwnProperty.call(global.__vfNativeSceneLiveCameras, cameraRef)) {
      return normalizeSurfaceCameraSpec(global.__vfNativeSceneLiveCameras[cameraRef], screen.camera || null);
    }
    if (cameraRef && Object.prototype.hasOwnProperty.call(surfaceCameras, cameraRef)) {
      return normalizeSurfaceCameraSpec(surfaceCameras[cameraRef], screen.camera || null);
    }
    return normalizeSurfaceCameraSpec(screen.camera || null, null);
  }

  function resolveReflectSourceCameraForSpec(spec, viewerCamera) {
    var sourceFrameId = String(spec && spec.reflect_of_frame_id || "").trim();
    if (!sourceFrameId || sourceFrameId === "current") {
      return viewerCamera && typeof viewerCamera === "object" ? viewerCamera : null;
    }
    var live = global.__vfNativeSceneLiveCameras && global.__vfNativeSceneLiveCameras[sourceFrameId];
    return live && typeof live === "object" ? live : null;
  }

  function parseCssRgbaColor(text) {
    var raw = String(text || "").trim();
    if (!raw) { return null; }
    if (raw === "transparent") { return [0.0, 0.0, 0.0, 0.0]; }
    var m = raw.match(/^rgba?\(([^)]+)\)$/i);
    if (!m) { return null; }
    var parts = m[1].split(",").map(function (part) { return String(part).trim(); });
    if (parts.length < 3) { return null; }
    var r = Math.max(0, Math.min(255, Number(parts[0]) || 0)) / 255.0;
    var g = Math.max(0, Math.min(255, Number(parts[1]) || 0)) / 255.0;
    var b = Math.max(0, Math.min(255, Number(parts[2]) || 0)) / 255.0;
    var a = parts.length >= 4 ? Math.max(0, Math.min(1, Number(parts[3]) || 0)) : 1.0;
    return [r, g, b, a];
  }

  function resolveSceneBackgroundFallback() {
    if (config && Object.prototype.hasOwnProperty.call(config, "background")) {
      return toRgba(config.background, [0.0, 0.0, 0.0, 0.0]);
    }
    try {
      var doc = global.document;
      if (!doc || typeof global.getComputedStyle !== "function") {
        return [0.0, 0.0, 0.0, 0.0];
      }
      var selector = '.vf-frame[data-vf-frame-id="' + String(frameSpec.frame_id || config.frame_id || "") + '"] .vf-frame__body';
      var host = doc.querySelector(selector) || doc.body;
      if (!host) { return [0.0, 0.0, 0.0, 0.0]; }
      var style = global.getComputedStyle(host);
      var parsed = parseCssRgbaColor(style && style.backgroundColor);
      return parsed || [0.0, 0.0, 0.0, 0.0];
    } catch (_) {
      return [0.0, 0.0, 0.0, 0.0];
    }
  }

  function normalizeSurfaceWorldSpec(source) {
    var spec = source && typeof source === "object" ? source : {};
    var sceneBackground = resolveSceneBackgroundFallback();
    return {
      kind: String(spec.kind || "cube_demo"),
      cube_size: Math.max(0.2, Number(spec.cube_size == null ? 0.88 : spec.cube_size) || 0.88),
      spin_axis: normalize3(toVec3(spec.spin_axis, [0.0, 1.0, 0.0]), [0.0, 1.0, 0.0]),
      angular_velocity: Number(spec.angular_velocity == null ? 1.05 : spec.angular_velocity) || 1.05,
      phase: Number(spec.phase || 0.0) || 0.0,
      background: toRgba(spec.background, sceneBackground),
      frame_color: toRgba(spec.frame_color, sceneBackground),
    };
  }

  function resolveSurfaceWorld(system) {
    var screen = system && typeof system === "object" ? system : {};
    var worldRef = String(screen.world_ref || "");
    if (worldRef && Object.prototype.hasOwnProperty.call(surfaceWorlds, worldRef)) {
      return normalizeSurfaceWorldSpec(surfaceWorlds[worldRef]);
    }
    return normalizeSurfaceWorldSpec(screen.world || null);
  }

  function resolveSurfaceSystem(system, viewerCamera, seconds) {
    if (!system || typeof system !== "object") { return null; }
    var kind = String(system.kind || "").toLowerCase().trim();
    if (kind !== "screen" && kind !== "mirror") { return cloneJsonValue(system); }
    if (Object.prototype.hasOwnProperty.call(system, "camera_mode")) {
      failFast("surface_system.camera_mode is removed; use a reflected camera frame plus screen.frame_ref");
    }
    if (system.camera && typeof system.camera === "object") {
      var directMirrorCamera = system.camera.mirror_of && typeof system.camera.mirror_of === "object";
      var directReflectMesh = String(system.camera.reflect_mirror_mesh_id || "").trim();
      if (directMirrorCamera || directReflectMesh) {
        failFast("surface_system.camera mirror path is removed; use a reflected source frame plus screen.frame_ref");
      }
    }
    var camera = resolveSurfaceCamera(system, viewerCamera);
    var world = resolveSurfaceWorld(system);
    var runtimeKind = kind === "mirror" ? "screen" : kind;
    return {
      kind: runtimeKind,
      scale: Array.isArray(system.scale) ? [Number(system.scale[0]) || 1.0, Number(system.scale[1]) || 1.0] : [1.0, 1.0],
      reflectivity: Math.max(0.0, Math.min(1.0, Number(system.reflectivity == null ? 1.0 : system.reflectivity) || 0.0)),
      world_ref: String(system.world_ref || ""),
      camera_ref: String(system.camera_ref || ""),
      frame_ref: String(system.frame_ref || ""),
      flip_x: system.flip_x === true,
      flip_y: system.flip_y === true,
      _renderFlipU: system._renderFlipU === true,
      _mirror_surface: kind === "mirror" || system._mirror_surface === true,
      reverse_facing: system.reverse_facing === true,
      camera: camera,
      world: {
        kind: world.kind,
        cube_size: world.cube_size,
        spin_axis: world.spin_axis,
        spin_angle: (Number(world.phase || 0.0) || 0.0) + ((Number(world.angular_velocity || 0.0) || 0.0) * Number(seconds || 0.0)),
        background: world.background,
        frame_color: world.frame_color,
      }
    };
  }

  function surfaceTextureKindCode(texture) {
    if (!texture || typeof texture !== "object") { return 0; }
    var raw = String(texture.kind || "").toLowerCase().trim();
    if (raw === "checker") { return 1; }
    if (raw === "stripes") { return 2; }
    if (raw === "dice") { return 3; }
    if (raw === "chess_board") { return 5; }
    return 0;
  }

  function meshWorldCenter(mesh) {
    if (mesh && Array.isArray(mesh.transform) && mesh.transform.length === 16) {
      return [
        Number(mesh.transform[12]) || 0,
        Number(mesh.transform[13]) || 0,
        Number(mesh.transform[14]) || 0
      ];
    }
    return toVec3(mesh && mesh.center, [0, 0, 0]);
  }

  function buildSurfaceWorldObjects(meshSpecs, hostMeshId) {
    var objects = [];
    for (var i = 0; i < meshSpecs.length; i += 1) {
      var mesh = meshSpecs[i];
      if (!mesh) { continue; }
      if (String(mesh.id || "") === String(hostMeshId || "")) { continue; }
      if (mesh.visible === false) { continue; }
      if (mesh.kind === "cube") {
        var faceColor = toRgba(mesh.face_color, [0.86, 0.88, 0.94, 1.0]);
        var texture = mesh.texture && typeof mesh.texture === "object" ? mesh.texture : null;
        objects.push({
          center: meshWorldCenter(mesh),
          size: Math.max(0.1, Number(mesh.size || 1.0) || 1.0),
          texture_kind: surfaceTextureKindCode(texture),
          color_a: toRgba(texture && texture.color_a, faceColor),
          color_b: toRgba(texture && texture.color_b, faceColor),
          face_color: faceColor
        });
        continue;
      }
      if (mesh.kind === "random_hull" || mesh.kind === "convex_hull" || mesh.kind === "simplices") {
        var vertices = meshVerticesForOccluder(mesh);
        if (!Array.isArray(vertices) || !vertices.length) { continue; }
        var bounds = computeBounds(vertices);
        var center = meshCenterFromBounds(bounds);
        var spanX = Math.max(0.0, Number(bounds.max[0]) - Number(bounds.min[0]));
        var spanY = Math.max(0.0, Number(bounds.max[1]) - Number(bounds.min[1]));
        var spanZ = Math.max(0.0, Number(bounds.max[2]) - Number(bounds.min[2]));
        var proxySize = Math.max(0.1, spanX, spanY, spanZ);
        var proxyColor = toRgba(mesh.face_color || mesh.color, [0.86, 0.88, 0.94, 1.0]);
        objects.push({
          center: center,
          size: proxySize,
          texture_kind: 0,
          color_a: proxyColor,
          color_b: proxyColor,
          face_color: proxyColor
        });
        continue;
      }
      if (mesh.kind === "field_mesh") {
        var fieldVertices = meshVerticesForOccluder(mesh);
        if (!Array.isArray(fieldVertices) || !fieldVertices.length) { continue; }
        var fieldBounds = computeBounds(fieldVertices);
        var fieldCenter = meshCenterFromBounds(fieldBounds);
        var fieldSpanX = Math.max(0.0, Number(fieldBounds.max[0]) - Number(fieldBounds.min[0]));
        var fieldSpanY = Math.max(0.0, Number(fieldBounds.max[1]) - Number(fieldBounds.min[1]));
        var fieldSpanZ = Math.max(0.0, Number(fieldBounds.max[2]) - Number(fieldBounds.min[2]));
        var fieldProxySize = Math.max(0.1, fieldSpanX, fieldSpanY, fieldSpanZ);
        var fieldProxyColor = toRgba(mesh.face_color || mesh.color, [0.86, 0.88, 0.94, 1.0]);
        objects.push({
          center: fieldCenter,
          size: fieldProxySize,
          texture_kind: 0,
          color_a: fieldProxyColor,
          color_b: fieldProxyColor,
          face_color: fieldProxyColor
        });
      }
    }
    return objects;
  }

  function currentFrameViewportHeight() {
    try {
      var frame = global.document && global.document.querySelector(
        '.vf-frame[data-vf-frame-id="' + String(frameSpec.frame_id || config.frame_id || "") + '"]'
      );
      var host = frame ? (frame.querySelector(".vf-frame__body") || frame) : null;
      var height = Math.max(1, Number(host && host.clientHeight) || 0);
      if (height > 0) { return height; }
    } catch (err) {
      failFast("frame viewport height lookup failed: " + (err && err.message ? err.message : String(err)));
    }
    failFast("frame viewport height is unavailable for scene frame");
  }

  function buildSurfaceWorldRenderMesh(mesh, camera, lights) {
    var DisplayApi = global.VfDisplay && global.VfDisplay.__test;
    if (DisplayApi && typeof DisplayApi.buildSingleMesh === "function") {
      try {
        return DisplayApi.buildSingleMesh(mesh, camera || null, Array.isArray(lights) ? lights : []);
      } catch (err) {
        failFast("surface world render mesh build failed: " + (err && err.message ? err.message : String(err)));
      }
    }
    failFast("surface world render mesh builder is unavailable");
  }

  function cameraForward(camera) {
    if (camera && Array.isArray(camera.view_matrix) && camera.view_matrix.length === 16) {
      return normalize3(inverseRigidDirMat4(camera.view_matrix, [0, 0, -1]), [0, 0, -1]);
    }
    var pos = (camera && Array.isArray(camera.pos)) ? camera.pos : [0, 0, 5];
    var target = (camera && Array.isArray(camera.target)) ? camera.target : [0, 0, 0];
    return normalize3([
      Number(target[0] || 0) - Number(pos[0] || 0),
      Number(target[1] || 0) - Number(pos[1] || 0),
      Number(target[2] || 0) - Number(pos[2] || 0)
    ], [0, 0, -1]);
  }

  function impostorWorldRadius(camera, viewportHeightPx, point, pixelRadius) {
    var pxRadius = Number(pixelRadius || 0);
    if (!(pxRadius > 0)) { return 0; }
    var cam = camera || null;
    var viewportHeight = Number(viewportHeightPx || 0);
    if (!cam || !Array.isArray(cam.pos) || !Array.isArray(cam.target) || !(viewportHeight > 0)) {
      return pxRadius;
    }
    var worldPerPixel;
    if (Array.isArray(cam.view_matrix) && cam.view_matrix.length === 16 && Array.isArray(cam.projection_matrix) && cam.projection_matrix.length === 16) {
      var viewPoint = transformPointMat4(cam.view_matrix, Number(point[0] || 0), Number(point[1] || 0), Number(point[2] || 0));
      var depth = Math.max(1e-3, Math.abs(Number(viewPoint[2] || 0)));
      var projScaleY = Math.abs(Number(cam.projection_matrix[5] || 0));
      worldPerPixel = projScaleY > 1e-6
        ? ((2 * depth) / (viewportHeight * projScaleY))
        : pxRadius;
    } else {
      var forward = cameraForward(cam);
      var dx = Number(point[0] || 0) - Number(cam.pos[0] || 0);
      var dy = Number(point[1] || 0) - Number(cam.pos[1] || 0);
      var dz = Number(point[2] || 0) - Number(cam.pos[2] || 0);
      var depth = Math.max(1e-3, (dx * forward[0]) + (dy * forward[1]) + (dz * forward[2]));
      var fovDeg = Number(cam.fov || 34);
      var fovRad = Math.max(1e-4, fovDeg * Math.PI / 180);
      worldPerPixel = (2 * depth * Math.tan(fovRad * 0.5)) / viewportHeight;
    }
    return pxRadius * worldPerPixel;
  }

  function applyImpostorViewBias(camera, viewportHeightPx, point, pixelBias) {
    var biasPx = Number(pixelBias || 0);
    if (!(biasPx > 0)) { return [Number(point[0] || 0), Number(point[1] || 0), Number(point[2] || 0)]; }
    var cam = camera || null;
    if (!cam || !Array.isArray(cam.pos)) {
      return [Number(point[0] || 0), Number(point[1] || 0), Number(point[2] || 0)];
    }
    var worldBias = impostorWorldRadius(camera, viewportHeightPx, point, biasPx);
    if (!(worldBias > 0)) {
      return [Number(point[0] || 0), Number(point[1] || 0), Number(point[2] || 0)];
    }
    var vx = Number(cam.pos[0] || 0) - Number(point[0] || 0);
    var vy = Number(cam.pos[1] || 0) - Number(point[1] || 0);
    var vz = Number(cam.pos[2] || 0) - Number(point[2] || 0);
    var vlen = Math.sqrt((vx * vx) + (vy * vy) + (vz * vz));
    if (!(vlen > 1e-9)) {
      return [Number(point[0] || 0), Number(point[1] || 0), Number(point[2] || 0)];
    }
    return [
      Number(point[0] || 0) + ((vx / vlen) * worldBias),
      Number(point[1] || 0) + ((vy / vlen) * worldBias),
      Number(point[2] || 0) + ((vz / vlen) * worldBias)
    ];
  }

  function applyImpostorViewBiasToSegment(camera, viewportHeightPx, a, b, pixelBias) {
    var midpoint = [
      (Number(a[0] || 0) + Number(b[0] || 0)) * 0.5,
      (Number(a[1] || 0) + Number(b[1] || 0)) * 0.5,
      (Number(a[2] || 0) + Number(b[2] || 0)) * 0.5
    ];
    var biasedMidpoint = applyImpostorViewBias(camera, viewportHeightPx, midpoint, pixelBias);
    var dx = biasedMidpoint[0] - midpoint[0];
    var dy = biasedMidpoint[1] - midpoint[1];
    var dz = biasedMidpoint[2] - midpoint[2];
    return [
      [Number(a[0] || 0) + dx, Number(a[1] || 0) + dy, Number(a[2] || 0) + dz],
      [Number(b[0] || 0) + dx, Number(b[1] || 0) + dy, Number(b[2] || 0) + dz]
    ];
  }

  function norm3(x, y, z) {
    var len = Math.sqrt((x * x) + (y * y) + (z * z));
    if (!(len > 1e-9)) { return [0, 0, 1]; }
    return [x / len, y / len, z / len];
  }

  var sphereTemplateCache = Object.create(null);
  var cylinderTemplateCache = Object.create(null);

  function getSphereTemplate(latSeg, lonSeg) {
    var key = String(latSeg | 0) + "x" + String(lonSeg | 0);
    var cached = sphereTemplateCache[key];
    if (cached) { return cached; }
    var verts = [];
    var idx = [];
    for (var lat = 0; lat <= latSeg; lat += 1) {
      var v = lat / latSeg;
      var theta = v * Math.PI;
      var st = Math.sin(theta);
      var ct = Math.cos(theta);
      for (var lon = 0; lon <= lonSeg; lon += 1) {
        var u = lon / lonSeg;
        var phi = u * Math.PI * 2;
        verts.push(st * Math.cos(phi), st * Math.sin(phi), ct);
      }
    }
    var row = lonSeg + 1;
    for (var lat2 = 0; lat2 < latSeg; lat2 += 1) {
      for (var lon2 = 0; lon2 < lonSeg; lon2 += 1) {
        var a = (lat2 * row) + lon2;
        var b = a + row;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    cached = { verts: verts, idx: idx };
    sphereTemplateCache[key] = cached;
    return cached;
  }

  function getCylinderTemplate(seg) {
    var key = String(seg | 0);
    var cached = cylinderTemplateCache[key];
    if (cached) { return cached; }
    var ring = [];
    var idx = [];
    for (var i = 0; i < seg; i += 1) {
      var t = (i / seg) * Math.PI * 2;
      ring.push(Math.cos(t), Math.sin(t));
    }
    for (var j = 0; j < seg; j += 1) {
      var a = j * 2;
      var b = ((j + 1) % seg) * 2;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    cached = { ring: ring, idx: idx };
    cylinderTemplateCache[key] = cached;
    return cached;
  }

  function pushWorldTriangle(triangles, a, b, c, color) {
    triangles.push({
      a: [Number(a[0]) || 0, Number(a[1]) || 0, Number(a[2]) || 0],
      b: [Number(b[0]) || 0, Number(b[1]) || 0, Number(b[2]) || 0],
      c: [Number(c[0]) || 0, Number(c[1]) || 0, Number(c[2]) || 0],
      color: toRgba(color, [0.82, 0.84, 0.90, 1.0])
    });
  }

  function appendSphereTriangles(triangles, center, radius, color, latSeg, lonSeg) {
    radius = Number(radius);
    if (!(radius > 0)) { return; }
    var template = getSphereTemplate(latSeg || 12, lonSeg || 18);
    var verts = [];
    for (var i = 0; i < template.verts.length; i += 3) {
      var nx = template.verts[i];
      var ny = template.verts[i + 1];
      var nz = template.verts[i + 2];
      verts.push([
        center[0] + (radius * nx),
        center[1] + (radius * ny),
        center[2] + (radius * nz)
      ]);
    }
    for (var k = 0; k + 2 < template.idx.length; k += 3) {
      pushWorldTriangle(triangles, verts[template.idx[k]], verts[template.idx[k + 1]], verts[template.idx[k + 2]], color);
    }
  }

  function appendCylinderTriangles(triangles, a, b, radius, color, seg) {
    radius = Number(radius);
    if (!(radius > 0)) { return; }
    var template = getCylinderTemplate(seg || 20);
    var dir = norm3(Number(b[0]) - Number(a[0]), Number(b[1]) - Number(a[1]), Number(b[2]) - Number(a[2]));
    var ref = Math.abs(dir[1]) < 0.92 ? [0, 1, 0] : [1, 0, 0];
    var u = normalize3(cross3(dir, ref), [1, 0, 0]);
    var v = cross3(dir, u);
    var verts = [];
    for (var i = 0; i < template.ring.length; i += 2) {
      var ct = template.ring[i];
      var st = template.ring[i + 1];
      var nx = (u[0] * ct) + (v[0] * st);
      var ny = (u[1] * ct) + (v[1] * st);
      var nz = (u[2] * ct) + (v[2] * st);
      verts.push([
        Number(a[0]) + (radius * nx),
        Number(a[1]) + (radius * ny),
        Number(a[2]) + (radius * nz)
      ]);
      verts.push([
        Number(b[0]) + (radius * nx),
        Number(b[1]) + (radius * ny),
        Number(b[2]) + (radius * nz)
      ]);
    }
    for (var k = 0; k + 2 < template.idx.length; k += 3) {
      pushWorldTriangle(triangles, verts[template.idx[k]], verts[template.idx[k + 1]], verts[template.idx[k + 2]], color);
    }
  }

  function meshVec3At(verts, index) {
    var base = (Number(index) | 0) * 10;
    return [
      Number(verts[base] || 0),
      Number(verts[base + 1] || 0),
      Number(verts[base + 2] || 0)
    ];
  }

  function meshColorAt(verts, index) {
    var base = (Number(index) | 0) * 10;
    return [
      Number(verts[base + 6] == null ? 0.82 : verts[base + 6]),
      Number(verts[base + 7] == null ? 0.84 : verts[base + 7]),
      Number(verts[base + 8] == null ? 0.90 : verts[base + 8]),
      Number(verts[base + 9] == null ? 1.0 : verts[base + 9])
    ];
  }

  function fieldMeshRenderMode(mesh) {
    var mode = String((mesh && mesh.render_mode) || "proxy_geometry").toLowerCase();
    return mode === "marker_impostor" ? "marker_impostor" : "proxy_geometry";
  }

  function fieldMeshMarkerSpace(mesh) {
    var mode = fieldMeshRenderMode(mesh);
    var space = String((mesh && mesh.marker_space) || (mode === "marker_impostor" ? "pixel" : "world")).toLowerCase();
    return space === "pixel" ? "pixel" : "world";
  }

  function overlayRenderMode(mesh, prefix) {
    var key = String(prefix || "") + "_render_mode";
    var mode = String((mesh && mesh[key]) || "proxy_geometry").toLowerCase();
    return mode === "marker_impostor" ? "marker_impostor" : "proxy_geometry";
  }

  function overlayMarkerSpace(mesh, prefix) {
    var mode = overlayRenderMode(mesh, prefix);
    var key = String(prefix || "") + "_marker_space";
    var fallback = mode === "marker_impostor" ? "pixel" : "world";
    var space = String((mesh && mesh[key]) || fallback).toLowerCase();
    return space === "pixel" ? "pixel" : "world";
  }

  function overlayDepthWrite(mesh, prefix) {
    var key = String(prefix || "") + "_depth_write";
    if (mesh && mesh[key] != null) { return mesh[key] === true; }
    return overlayRenderMode(mesh, prefix) !== "marker_impostor";
  }

  function appendTriangleListWorldTriangles(triangles, mesh, model) {
    var verts = mesh.vertices;
    var inds = mesh.indices;
    if ((!Array.isArray(verts) && !(verts instanceof Float32Array)) || !verts.length) { return; }
    if ((!Array.isArray(inds) && !(inds instanceof Uint32Array)) || !inds.length) { return; }
    for (var k = 0; k + 2 < inds.length; k += 3) {
      var ia = Number(inds[k]) | 0;
      var ib = Number(inds[k + 1]) | 0;
      var ic = Number(inds[k + 2]) | 0;
      var ba = ia * 10;
      var bb = ib * 10;
      var bc = ic * 10;
      pushWorldTriangle(
        triangles,
        transformPointMat4(model, Number(verts[ba] || 0.0), Number(verts[ba + 1] || 0.0), Number(verts[ba + 2] || 0.0)),
        transformPointMat4(model, Number(verts[bb] || 0.0), Number(verts[bb + 1] || 0.0), Number(verts[bb + 2] || 0.0)),
        transformPointMat4(model, Number(verts[bc] || 0.0), Number(verts[bc + 1] || 0.0), Number(verts[bc + 2] || 0.0)),
        triangleColorFromMesh(mesh, ia, ib, ic)
      );
    }
  }

  function appendPointImpostorWorldTriangles(triangles, mesh, camera, viewportHeight) {
    var verts = mesh.vertices || [];
    var inds = mesh.indices || [];
    var vertexRadius = Number(mesh.vertex_size || 0);
    if (!(vertexRadius > 0) || !inds.length) { return; }
    var scales = Array.isArray(mesh.vertex_scale) ? mesh.vertex_scale : null;
    var globalScale = scales ? null : Number(mesh.vertex_scale == null ? 1.0 : mesh.vertex_scale);
    var markerSpace = fieldMeshMarkerSpace(mesh);
    for (var i = 0; i < inds.length; i += 1) {
      var vi = Number(inds[i]);
      var pointCenter = meshVec3At(verts, vi);
      var pointScale = scales ? Number(scales[i] == null ? 1.0 : scales[i]) : globalScale;
      if (!(pointScale > 0)) { pointScale = 1.0; }
      var biasedCenter = applyImpostorViewBias(
        camera,
        viewportHeight,
        pointCenter,
        Math.max(0.75, Number(vertexRadius * pointScale || 0) * 0.35)
      );
      appendSphereTriangles(
        triangles,
        biasedCenter,
        markerSpace === "pixel"
          ? impostorWorldRadius(camera, viewportHeight, pointCenter, vertexRadius * pointScale)
          : (vertexRadius * pointScale),
        meshColorAt(verts, vi),
        12,
        18
      );
    }
  }

  function appendLineImpostorWorldTriangles(triangles, mesh, camera, viewportHeight) {
    var verts = mesh.vertices || [];
    var inds = mesh.indices || [];
    var edgeRadius = Number(mesh.edge_width || 0);
    var vertexWidths = Array.isArray(mesh.vertex_widths) ? mesh.vertex_widths : null;
    var hasVertexWidths = !!(vertexWidths && vertexWidths.length);
    if (!(edgeRadius > 0) && !hasVertexWidths) { return; }
    if (inds.length < 2) { return; }
    var edgeCaps = mesh.edge_caps === true;
    var markerSpace = fieldMeshMarkerSpace(mesh);
    for (var i = 0; i + 1 < inds.length; i += 2) {
      var aIdx = Number(inds[i]);
      var bIdx = Number(inds[i + 1]);
      var pa = meshVec3At(verts, aIdx);
      var pb = meshVec3At(verts, bIdx);
      var col = meshColorAt(verts, aIdx);
      var aWidth = hasVertexWidths ? Number(vertexWidths[aIdx] || 0) : edgeRadius;
      var bWidth = hasVertexWidths ? Number(vertexWidths[bIdx] || 0) : edgeRadius;
      var edgeRadiusWorld = markerSpace === "pixel"
        ? Math.max(
            impostorWorldRadius(camera, viewportHeight, pa, aWidth),
            impostorWorldRadius(camera, viewportHeight, pb, bWidth)
          )
        : Math.max(aWidth, bWidth);
      var biasedSegment = applyImpostorViewBiasToSegment(
        camera,
        viewportHeight,
        pa,
        pb,
        Math.max(0.75, edgeRadiusWorld * 0.4)
      );
      pa = biasedSegment[0];
      pb = biasedSegment[1];
      appendCylinderTriangles(triangles, pa, pb, edgeRadiusWorld, col, 20);
      if (edgeCaps) {
        appendSphereTriangles(triangles, pa, edgeRadiusWorld, col, 10, 14);
        appendSphereTriangles(triangles, pb, edgeRadiusWorld, col, 10, 14);
      }
    }
  }

  function triangleColorFromMesh(mesh, ia, ib, ic) {
    var verts = mesh && mesh.vertices;
    if (!Array.isArray(verts) && !(verts instanceof Float32Array)) {
      return [0.82, 0.84, 0.90, 1.0];
    }
    function colorAt(index) {
      var base = (Number(index) | 0) * 10;
      return [
        Number(verts[base + 6] == null ? 0.82 : verts[base + 6]),
        Number(verts[base + 7] == null ? 0.84 : verts[base + 7]),
        Number(verts[base + 8] == null ? 0.90 : verts[base + 8]),
        Number(verts[base + 9] == null ? 1.0 : verts[base + 9])
      ];
    }
    var ca = colorAt(ia);
    var cb = colorAt(ib);
    var cc = colorAt(ic);
    return [
      (ca[0] + cb[0] + cc[0]) / 3.0,
      (ca[1] + cb[1] + cc[1]) / 3.0,
      (ca[2] + cb[2] + cc[2]) / 3.0,
      (ca[3] + cb[3] + cc[3]) / 3.0
    ];
  }

  function buildSurfaceWorldTriangles(meshPayloads, hostMeshId, surfaceCamera, lights) {
    var triangles = [];
    var items = Array.isArray(meshPayloads) ? meshPayloads : [];
    var camera = surfaceCamera && typeof surfaceCamera === "object" ? surfaceCamera : null;
    for (var i = 0; i < items.length; i += 1) {
      var sourceMesh = items[i];
      if (!sourceMesh || String(sourceMesh.id || "") === String(hostMeshId || "")) { continue; }
      if (sourceMesh.transparent === true) { continue; }
      var mesh = buildSurfaceWorldRenderMesh(sourceMesh, camera, lights);
      if (!mesh) { continue; }
      var model = matrixForMesh(mesh);
      var topology = String(mesh.topology || "");
      if (topology === "triangle-list") {
        appendTriangleListWorldTriangles(triangles, mesh, model);
      }
    }
    return triangles;
  }

  function resolveFramePosition(framePos) {
    if (frameCount <= 1) { return 0.0; }
    var step = Math.max(0.0, Number(framePos) || 0.0);
    if (boundary === "stop") {
      return Math.min(step, frameCount - 1);
    }
    if (boundary === "reset") {
      return step >= frameCount ? 0.0 : step;
    }
    if (boundary === "mirror") {
      var span = frameCount - 1;
      var period = span * 2;
      if (period <= 0) { return 0.0; }
      var mirrored = step % period;
      if (mirrored < 0) { mirrored += period; }
      if (mirrored > span) { mirrored = period - mirrored; }
      return mirrored;
    }
    var repeated = step % frameCount;
    return repeated < 0 ? repeated + frameCount : repeated;
  }

  function animationFramePosition(seconds) {
    return Math.max(0.0, Number(seconds || 0) * fps);
  }

  function resolveTrackSample(framePos, count) {
    if (!(count > 0)) { return { index0: 0, index1: 0, mix: 0.0 }; }
    if (count <= 1) { return { index0: 0, index1: 0, mix: 0.0 }; }
    var resolved = resolveFramePosition(framePos);
    var scaled;
    var index0;
    var mix;
    if (boundary === "repeat" || boundary === "reset") {
      scaled = (resolved / Math.max(1e-6, frameCount)) * count;
      index0 = Math.floor(scaled);
      mix = scaled - index0;
      index0 = ((index0 % count) + count) % count;
      return { index0: index0, index1: (index0 + 1) % count, mix: mix };
    }
    scaled = (resolved / Math.max(1e-6, frameCount - 1)) * (count - 1);
    if (scaled <= 0.0) { return { index0: 0, index1: 0, mix: 0.0 }; }
    if (scaled >= (count - 1)) { return { index0: count - 1, index1: count - 1, mix: 0.0 }; }
    index0 = Math.floor(scaled);
    mix = scaled - index0;
    return { index0: index0, index1: index0 + 1, mix: mix };
  }

  function lerpNumber(a, b, mix) {
    return Number(a) + ((Number(b) - Number(a)) * Number(mix));
  }

  function sampleVec3Track(track, framePos, fallback) {
    if (!Array.isArray(track) || !track.length) { return fallback.slice(); }
    var sample = resolveTrackSample(framePos, track.length);
    var a = toVec3(track[sample.index0], fallback);
    var b = toVec3(track[sample.index1], fallback);
    return [
      lerpNumber(a[0], b[0], sample.mix),
      lerpNumber(a[1], b[1], sample.mix),
      lerpNumber(a[2], b[2], sample.mix)
    ];
  }

  function sampleRgbaTrack(track, framePos, fallback) {
    if (!Array.isArray(track) || !track.length) { return fallback.slice(); }
    var sample = resolveTrackSample(framePos, track.length);
    var a = toRgba(track[sample.index0], fallback);
    var b = toRgba(track[sample.index1], fallback);
    return [
      lerpNumber(a[0], b[0], sample.mix),
      lerpNumber(a[1], b[1], sample.mix),
      lerpNumber(a[2], b[2], sample.mix),
      lerpNumber(a[3], b[3], sample.mix)
    ];
  }

  function sampleNumberTrack(track, framePos, fallback) {
    if (!Array.isArray(track) || !track.length) { return Number(fallback); }
    var sample = resolveTrackSample(framePos, track.length);
    return lerpNumber(track[sample.index0], track[sample.index1], sample.mix);
  }

  function sampleStepTrackValue(track, framePos, fallback) {
    if (!Array.isArray(track) || !track.length) { return fallback; }
    var sample = resolveTrackSample(framePos, track.length);
    return track[sample.index0];
  }

  function sampleObjectTrack(track, framePos, fallback) {
    if (isEncodedAxisTaggedValue(track)) {
      var idx = encodedAxisTaggedIdx(track);
      if (idx && idx.charAt(idx.length - 1) === "t") {
        var trackData = encodedAxisTaggedData(track);
        var count = trackLengthForAxis(trackData, idx.length - 1);
        if (count > 0) {
          var sample = resolveTrackSample(framePos, count);
          return sliceAxisAt(trackData, idx.length - 1, sample.index0);
        }
      }
      return fallback;
    }
    return sampleStepTrackValue(track, framePos, fallback);
  }

  function toMatrix4(value, fallback) {
    if (Array.isArray(value) && value.length === 16) {
      return value.map(function (item) { return Number(item); });
    }
    if (Array.isArray(value) && value.length === 4) {
      var rows = [];
      for (var rowIndex = 0; rowIndex < 4; rowIndex += 1) {
        if (!Array.isArray(value[rowIndex]) || value[rowIndex].length !== 4) {
          rows = null;
          break;
        }
        rows.push([
          Number(value[rowIndex][0]),
          Number(value[rowIndex][1]),
          Number(value[rowIndex][2]),
          Number(value[rowIndex][3])
        ]);
      }
      if (rows) {
        return [
          rows[0][0], rows[1][0], rows[2][0], rows[3][0],
          rows[0][1], rows[1][1], rows[2][1], rows[3][1],
          rows[0][2], rows[1][2], rows[2][2], rows[3][2],
          rows[0][3], rows[1][3], rows[2][3], rows[3][3]
        ];
      }
    }
    return Array.isArray(fallback) ? fallback.slice() : null;
  }

  function sampleMatrixTrack(track, framePos, fallback) {
    var identity = Array.isArray(fallback) ? fallback : identityMat4();
    if (isEncodedAxisTaggedValue(track)) {
      var idx = encodedAxisTaggedIdx(track);
      if (idx && idx.charAt(idx.length - 1) === "t") {
        var trackData = encodedAxisTaggedData(track);
        var count = trackLengthForAxis(trackData, idx.length - 1);
        if (count > 0) {
          var sample = resolveTrackSample(framePos, count);
          return toMatrix4(sliceAxisAt(trackData, idx.length - 1, sample.index0), identity);
        }
      }
      return identity.slice();
    }
    return toMatrix4(sampleStepTrackValue(track, framePos, null), identity);
  }

  function entityTrack(light, name) {
    var tracks = light && light.tracks;
    if (!tracks || typeof tracks !== "object") { return null; }
    var propName = entityPropName(light, name);
    var track = tracks[propName];
    if ((track == null || (!Array.isArray(track) && !isEncodedAxisTaggedValue(track))) && propName !== name) {
      track = tracks[name];
    }
    if (Array.isArray(track) && track.length) { return track; }
    if (isEncodedAxisTaggedValue(track)) { return track; }
    return null;
  }

  function resolveTrackedVec3(light, name, framePos, fallback) {
    return sampleVec3Track(entityTrack(light, name), framePos, fallback);
  }

  function resolveTrackedRgba(light, name, framePos, fallback) {
    return sampleRgbaTrack(entityTrack(light, name), framePos, fallback);
  }

  function resolveTrackedNumber(light, name, framePos, fallback) {
    return sampleNumberTrack(entityTrack(light, name), framePos, fallback);
  }

  function resolveTrackedMatrix4(entity, name, framePos, fallback) {
    return sampleMatrixTrack(entityTrack(entity, name), framePos, fallback);
  }

  function resolveTrackedObject(entity, name, framePos, fallback) {
    return sampleObjectTrack(entityTrack(entity, name), framePos, fallback);
  }

  function lightEmissionSolidAngle(kind, outerConeDeg) {
    if (String(kind || "point") === "spot") {
      var outerRad = Math.max(0.0, Number(outerConeDeg || 0.0)) * Math.PI / 180.0;
      return Math.max(1e-6, 2.0 * Math.PI * (1.0 - Math.cos(outerRad)));
    }
    return 4.0 * Math.PI;
  }

  function resolveLightIntensity(light, framePos, kind, outerConeDeg) {
    var explicitIntensityTrack = !!entityTrack(light, "intensity");
    var explicitPowerTrack = !!entityTrack(light, "power");
    var intensityValue = entityProp(light, "intensity", undefined);
    var powerValue = entityProp(light, "power", undefined);
    var explicitIntensity = intensityValue != null;
    var explicitPower = powerValue != null && Number(powerValue) > 0.0;
    if (explicitIntensityTrack || explicitIntensity) {
      return Math.max(0.0, resolveTrackedNumber(light, "intensity", framePos, Number(explicitIntensity ? intensityValue : 24.0)));
    }
    if (explicitPowerTrack || explicitPower) {
      var power = Math.max(0.0, resolveTrackedNumber(light, "power", framePos, Number(explicitPower ? powerValue : 0.0)));
      return power / lightEmissionSolidAngle(kind, outerConeDeg);
    }
    return Math.max(0.0, Number(intensityValue == null ? 24.0 : intensityValue));
  }

  function resolveLightTarget(light, framePos) {
    return resolveTrackedVec3(light, "target", framePos, toVec3(entityProp(light, "target", [0, 0, 0]), [0, 0, 0]));
  }

  function currentLightPosition(light, seconds, framePos, target) {
    if (entityTrack(light, "pos")) {
      return resolveTrackedVec3(light, "pos", framePos, [0, 0, 0]);
    }
    var directPos = entityProp(light, "pos", undefined);
    if (Array.isArray(directPos) && directPos.length === 3) {
      return toVec3(directPos, [0, 0, 0]);
    }
    target = Array.isArray(target) ? target : toVec3(light.target, [0, 0, 0]);
    var radius = Number(entityProp(light, "radius", 4.5) || 4.5);
    var height = Number(entityProp(light, "height", 3.6) || 3.6);
    var theta = Number(entityProp(light, "theta", 0.0) || 0.0);
    var angularVelocity = Number(entityProp(light, "angular_velocity", 0.0) || 0.0);
    var motion = String(entityProp(light, "motion", "orbit") || "orbit");
    var angle;
    if (motion === "oscillate") {
      var thetaAmplitude = Math.max(0.0, Number(entityProp(light, "theta_amplitude", 0.0) || 0.0));
      angle = theta + (Math.sin(angularVelocity * seconds) * thetaAmplitude);
    } else {
      angle = theta + (angularVelocity * seconds);
    }
    return [
      target[0] + (Math.cos(angle) * radius),
      target[1] + (Math.sin(angle) * radius),
      target[2] + height
    ];
  }

  function normalizeLight(light, seconds) {
    var resolved = light || {};
    var framePos = animationFramePosition(seconds);
    var target = resolveLightTarget(resolved, framePos);
    var pos = currentLightPosition(resolved, seconds, framePos, target);
    var kind = String(entityProp(resolved, "kind", "point") || "point");
    var defaultShowMarker = kind === "projected" ? false : true;
    var outerConeDefault = entityProp(resolved, "outer_cone_deg", 22.0);
    var outerConeDeg = resolveTrackedNumber(resolved, "outer_cone_deg", framePos, Number(outerConeDefault == null ? 22.0 : outerConeDefault));
    return {
      id: String(entityProp(resolved, "id", "")),
      pos: pos,
      target: target,
      motion: String(entityProp(resolved, "motion", Array.isArray(entityProp(resolved, "pos", undefined)) ? "fixed" : "orbit") || "orbit"),
      model: String(entityProp(resolved, "model", "blinn_phong") || "blinn_phong"),
      color: resolveTrackedRgba(resolved, "color", framePos, toRgba(entityProp(resolved, "color", [1.0, 0.95, 0.84, 1.0]), [1.0, 0.95, 0.84, 1.0])),
      kind: kind,
      direction: entityTrack(resolved, "direction")
        ? resolveTrackedVec3(resolved, "direction", framePos, [0, 0, -1])
        : (Array.isArray(entityProp(resolved, "direction", undefined)) ? toVec3(entityProp(resolved, "direction", undefined), [0, 0, -1]) : undefined),
      intensity: resolveLightIntensity(resolved, framePos, kind, outerConeDeg),
      inner_cone_deg: resolveTrackedNumber(resolved, "inner_cone_deg", framePos, Number(entityProp(resolved, "inner_cone_deg", 14.0) == null ? 14.0 : entityProp(resolved, "inner_cone_deg", 14.0))),
      outer_cone_deg: outerConeDeg,
      theta_amplitude: Math.max(0.0, Number(entityProp(resolved, "theta_amplitude", 0.0) || 0.0)),
      range: Math.max(0.0, resolveTrackedNumber(resolved, "range", framePos, Number(entityProp(resolved, "range", 0.0) == null ? 0.0 : entityProp(resolved, "range", 0.0)))),
      casts_shadow: entityProp(resolved, "casts_shadow", true) !== false,
      show_marker: entityProp(resolved, "show_marker", defaultShowMarker) !== false,
      source_radius: Math.max(0.0, resolveTrackedNumber(resolved, "source_radius", framePos, Number(entityProp(resolved, "source_radius", 0.0) || 0.0))),
      spread: Math.max(0.0, resolveTrackedNumber(resolved, "spread", framePos, Number(entityProp(resolved, "spread", 1.0) == null ? 1.0 : entityProp(resolved, "spread", 1.0)))),
      power: Math.max(0.0, resolveTrackedNumber(resolved, "power", framePos, Number(entityProp(resolved, "power", 0.0) || 0.0))),
      aperture_mesh_id: String(entityProp(resolved, "aperture_mesh_id", "") || ""),
      reflect_of_light_id: String(entityProp(resolved, "reflect_of_light_id", "") || ""),
      reflect_mirror_mesh_id: String(entityProp(resolved, "reflect_mirror_mesh_id", "") || ""),
      clip_epsilon_ratio: Math.max(0.0, resolveTrackedNumber(resolved, "clip_epsilon_ratio", framePos, Number(entityProp(resolved, "clip_epsilon_ratio", 1e-5) == null ? 1e-5 : entityProp(resolved, "clip_epsilon_ratio", 1e-5))))
    };
  }

  function toVec2(value, fallback) {
    if (!Array.isArray(value) || value.length !== 2) { return fallback.slice(); }
    return [Number(value[0]), Number(value[1])];
  }

  function pushVertex(out, p, normal, color) {
    out.push(
      Number(p[0]), Number(p[1]), Number(p[2]),
      Number(normal[0]), Number(normal[1]), Number(normal[2]),
      Number(color[0]), Number(color[1]), Number(color[2]), Number(color[3])
    );
  }

  function fieldMeshFlatVertexArray(value) {
    if (Array.isArray(value) || value instanceof Float32Array) { return value; }
    return [];
  }

  function fieldMeshIndexArray(value) {
    if (Array.isArray(value) || value instanceof Uint32Array) { return value; }
    return [];
  }

  function numericArrayLike(value) {
    return Array.isArray(value) || value instanceof Float32Array || value instanceof Uint32Array;
  }

  function numericArrayLikeCopy(value) {
    if (value instanceof Float32Array) { return new Float32Array(value); }
    if (value instanceof Uint32Array) { return new Uint32Array(value); }
    if (Array.isArray(value)) { return value.slice(); }
    return [];
  }

  function fieldMeshVerticesWithMaterialColor(vertices, color, enabled) {
    if (!enabled || !vertices || vertices.length < 10 || (vertices.length % 10) !== 0) {
      return vertices;
    }
    var rgba = toRgba(color, [1.0, 1.0, 1.0, 1.0]);
    if (!rgba) { return vertices; }
    var out = vertices instanceof Float32Array ? new Float32Array(vertices) : vertices.slice();
    for (var i = 0; i + 9 < out.length; i += 10) {
      out[i + 6] = rgba[0];
      out[i + 7] = rgba[1];
      out[i + 8] = rgba[2];
      out[i + 9] = rgba[3];
    }
    return out;
  }

  function fieldMeshIndicesWithConsistentWinding(vertices, indices, enabled) {
    if (enabled === false) {
      return indices;
    }
    if (!vertices || !indices || vertices.length < 30 || indices.length < 3 || (vertices.length % 10) !== 0) {
      return indices;
    }
    var vertexCount = Math.floor(vertices.length / 10);
    var out = [];
    var changed = false;
    for (var ii = 0; ii + 2 < indices.length; ii += 3) {
      var ia = Number(indices[ii]) | 0;
      var ib = Number(indices[ii + 1]) | 0;
      var ic = Number(indices[ii + 2]) | 0;
      if (ia < 0 || ib < 0 || ic < 0 || ia >= vertexCount || ib >= vertexCount || ic >= vertexCount) {
        continue;
      }
      var ba = ia * 10;
      var bb = ib * 10;
      var bc = ic * 10;
      var abx = Number(vertices[bb] || 0.0) - Number(vertices[ba] || 0.0);
      var aby = Number(vertices[bb + 1] || 0.0) - Number(vertices[ba + 1] || 0.0);
      var abz = Number(vertices[bb + 2] || 0.0) - Number(vertices[ba + 2] || 0.0);
      var acx = Number(vertices[bc] || 0.0) - Number(vertices[ba] || 0.0);
      var acy = Number(vertices[bc + 1] || 0.0) - Number(vertices[ba + 1] || 0.0);
      var acz = Number(vertices[bc + 2] || 0.0) - Number(vertices[ba + 2] || 0.0);
      var gx = (aby * acz) - (abz * acy);
      var gy = (abz * acx) - (abx * acz);
      var gz = (abx * acy) - (aby * acx);
      var nx = (
        Number(vertices[ba + 3] || 0.0) +
        Number(vertices[bb + 3] || 0.0) +
        Number(vertices[bc + 3] || 0.0)
      ) / 3.0;
      var ny = (
        Number(vertices[ba + 4] || 0.0) +
        Number(vertices[bb + 4] || 0.0) +
        Number(vertices[bc + 4] || 0.0)
      ) / 3.0;
      var nz = (
        Number(vertices[ba + 5] || 0.0) +
        Number(vertices[bb + 5] || 0.0) +
        Number(vertices[bc + 5] || 0.0)
      ) / 3.0;
      var geomLen = Math.sqrt((gx * gx) + (gy * gy) + (gz * gz));
      var normalLen = Math.sqrt((nx * nx) + (ny * ny) + (nz * nz));
      if (geomLen > 1e-10 && normalLen > 1e-6 && (((gx * nx) + (gy * ny) + (gz * nz)) < -(geomLen * normalLen * 0.10))) {
        out.push(ia, ic, ib);
        changed = true;
      } else {
        out.push(ia, ib, ic);
      }
    }
    if (!changed || out.length < 3) { return indices; }
    return indices instanceof Uint32Array ? new Uint32Array(out) : out;
  }

  function smoothInterpolatedFieldMeshVertices(spec, vertices, indices, enabled) {
    if (!enabled || !vertices || vertices.length < 10 || (vertices.length % 10) !== 0) {
      return vertices;
    }
    if (spec && spec.__vfSmoothFieldMeshSource === vertices && spec.__vfSmoothFieldMeshVertices) {
      return spec.__vfSmoothFieldMeshVertices;
    }
    if (!global.__vfSmoothFieldMeshVerticesByKey) {
      global.__vfSmoothFieldMeshVerticesByKey = Object.create(null);
    }
    var cacheKey = spec
      ? [
          String(spec.id || entityProp(spec, "id", "field_mesh")),
          String(entityProp(spec, "object_id", "")),
          String(vertices.length),
          String(indices && indices.length || 0)
        ].join(":")
      : "";
    if (cacheKey && global.__vfSmoothFieldMeshVerticesByKey[cacheKey]) {
      if (spec) {
        spec.__vfSmoothFieldMeshSource = vertices;
        spec.__vfSmoothFieldMeshIndices = indices || null;
        spec.__vfSmoothFieldMeshVertices = global.__vfSmoothFieldMeshVerticesByKey[cacheKey];
      }
      return global.__vfSmoothFieldMeshVerticesByKey[cacheKey];
    }
    var vertexCount = Math.floor(vertices.length / 10);
    function weldedKey(base) {
      return [
        Number(vertices[base] || 0.0).toFixed(5),
        Number(vertices[base + 1] || 0.0).toFixed(5),
        Number(vertices[base + 2] || 0.0).toFixed(5)
      ].join(",");
    }
    function authoredNormalAt(index) {
      var base = index * 10;
      return normalize3([
        Number(vertices[base + 3] || 0.0),
        Number(vertices[base + 4] || 0.0),
        Number(vertices[base + 5] || 0.0)
      ], [0.0, 0.0, 1.0]);
    }
    var out = vertices instanceof Float32Array ? new Float32Array(vertices) : vertices.slice();
    if (indices && indices.length >= 3) {
      var facesByPosition = Object.create(null);
      for (var ii = 0; ii + 2 < indices.length; ii += 3) {
        var ia = Number(indices[ii]) | 0;
        var ib = Number(indices[ii + 1]) | 0;
        var ic = Number(indices[ii + 2]) | 0;
        if (ia < 0 || ib < 0 || ic < 0 || ia >= vertexCount || ib >= vertexCount || ic >= vertexCount) { continue; }
        var ba = ia * 10;
        var bb = ib * 10;
        var bc = ic * 10;
        var nFace = faceNormal(
          [Number(vertices[ba] || 0.0), Number(vertices[ba + 1] || 0.0), Number(vertices[ba + 2] || 0.0)],
          [Number(vertices[bb] || 0.0), Number(vertices[bb + 1] || 0.0), Number(vertices[bb + 2] || 0.0)],
          [Number(vertices[bc] || 0.0), Number(vertices[bc + 1] || 0.0), Number(vertices[bc + 2] || 0.0)]
        );
        var ux = Number(vertices[bb] || 0.0) - Number(vertices[ba] || 0.0);
        var uy = Number(vertices[bb + 1] || 0.0) - Number(vertices[ba + 1] || 0.0);
        var uz = Number(vertices[bb + 2] || 0.0) - Number(vertices[ba + 2] || 0.0);
        var vx = Number(vertices[bc] || 0.0) - Number(vertices[ba] || 0.0);
        var vy = Number(vertices[bc + 1] || 0.0) - Number(vertices[ba + 1] || 0.0);
        var vz = Number(vertices[bc + 2] || 0.0) - Number(vertices[ba + 2] || 0.0);
        var cx = (uy * vz) - (uz * vy);
        var cy = (uz * vx) - (ux * vz);
        var cz = (ux * vy) - (uy * vx);
        var areaWeight = Math.max(1e-6, Math.sqrt((cx * cx) + (cy * cy) + (cz * cz)));
        var keys = [weldedKey(ba), weldedKey(bb), weldedKey(bc)];
        for (var ki = 0; ki < keys.length; ki += 1) {
          var faceList = facesByPosition[keys[ki]];
          if (!faceList) {
            faceList = facesByPosition[keys[ki]] = [];
          }
          faceList.push({ x: nFace[0], y: nFace[1], z: nFace[2], w: areaWeight });
        }
      }
      for (var outIndex = 0; outIndex < vertexCount; outIndex += 1) {
        var outBase = outIndex * 10;
        var outKey = weldedKey(outBase);
        var adjacentFaces = facesByPosition[outKey];
        if (!adjacentFaces || adjacentFaces.length < 1) { continue; }
        var authored = authoredNormalAt(outIndex);
        var sx = 0.0;
        var sy = 0.0;
        var sz = 0.0;
        var used = 0;
        for (var fi = 0; fi < adjacentFaces.length; fi += 1) {
          var face = adjacentFaces[fi];
          var alignment = (face.x * authored[0]) + (face.y * authored[1]) + (face.z * authored[2]);
          if (alignment < 0.42) { continue; }
          sx += face.x * face.w;
          sy += face.y * face.w;
          sz += face.z * face.w;
          used += 1;
        }
        if (used < 1) {
          continue;
        }
        var smoothed = normalize3([sx, sy, sz], authored);
        out[outBase + 3] = smoothed[0];
        out[outBase + 4] = smoothed[1];
        out[outBase + 5] = smoothed[2];
      }
    } else {
      var sums = Object.create(null);
      var order = [];
      for (var vi = 0; vi < vertexCount; vi += 1) {
        var base = vi * 10;
        var key = weldedKey(base);
        var entry = sums[key];
        if (!entry) {
          entry = sums[key] = { x: 0.0, y: 0.0, z: 0.0 };
          order.push(key);
        }
        entry.x += Number(vertices[base + 3] || 0.0);
        entry.y += Number(vertices[base + 4] || 0.0);
        entry.z += Number(vertices[base + 5] || 0.0);
      }
      for (var oi = 0; oi < order.length; oi += 1) {
        var normalEntry = sums[order[oi]];
        var n = normalize3([normalEntry.x, normalEntry.y, normalEntry.z], [0.0, 0.0, 1.0]);
        normalEntry.x = n[0];
        normalEntry.y = n[1];
        normalEntry.z = n[2];
      }
      for (var fallbackIndex = 0; fallbackIndex < vertexCount; fallbackIndex += 1) {
        var fallbackBase = fallbackIndex * 10;
        var fallbackSmoothed = sums[weldedKey(fallbackBase)];
        if (!fallbackSmoothed) { continue; }
        out[fallbackBase + 3] = fallbackSmoothed.x;
        out[fallbackBase + 4] = fallbackSmoothed.y;
        out[fallbackBase + 5] = fallbackSmoothed.z;
      }
    }
    if (spec) {
      spec.__vfSmoothFieldMeshSource = vertices;
      spec.__vfSmoothFieldMeshIndices = indices || null;
      spec.__vfSmoothFieldMeshVertices = out;
    }
    if (cacheKey) {
      global.__vfSmoothFieldMeshVerticesByKey[cacheKey] = out;
    }
    return out;
  }

  function faceNormal(a, b, c) {
    var ux = b[0] - a[0];
    var uy = b[1] - a[1];
    var uz = b[2] - a[2];
    var vx = c[0] - a[0];
    var vy = c[1] - a[1];
    var vz = c[2] - a[2];
    var nx = (uy * vz) - (uz * vy);
    var ny = (uz * vx) - (ux * vz);
    var nz = (ux * vy) - (uy * vx);
    var len = Math.sqrt((nx * nx) + (ny * ny) + (nz * nz)) || 1.0;
    return [nx / len, ny / len, nz / len];
  }

  function normalize3(v, fallback) {
    var x = Number(v[0] || 0.0);
    var y = Number(v[1] || 0.0);
    var z = Number(v[2] || 0.0);
    var len = Math.sqrt((x * x) + (y * y) + (z * z));
    if (!(len > 1e-9)) { return fallback.slice(); }
    return [x / len, y / len, z / len];
  }

  function cross3(a, b) {
    return [
      (a[1] * b[2]) - (a[2] * b[1]),
      (a[2] * b[0]) - (a[0] * b[2]),
      (a[0] * b[1]) - (a[1] * b[0])
    ];
  }

  function dot3(a, b) {
    return (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2]);
  }

  function makeCubeLocalVertices(size) {
    var half = Number(size) * 0.5;
    return [
      [-half, -half, -half],
      [ half, -half, -half],
      [ half,  half, -half],
      [-half,  half, -half],
      [-half, -half,  half],
      [ half, -half,  half],
      [ half,  half,  half],
      [-half,  half,  half]
    ];
  }

  function makeCubeVertices(center, size) {
    var local = makeCubeLocalVertices(size);
    center = toVec3(center, [0, 0, 0]);
    return local.map(function (p) {
      return [center[0] + p[0], center[1] + p[1], center[2] + p[2]];
    });
  }

  function transformLocalVertices(vertices, center, rotation) {
    center = toVec3(center, [0, 0, 0]);
    rotation = toVec3(rotation, [0, 0, 0]);
    var Mm = global.VfGeomMath;
    if (Mm && typeof Mm.mat4ModelTRS === "function") {
      var m = Mm.mat4ModelTRS(center, rotation, [1, 1, 1]);
      return vertices.map(function (p) {
        return transformPointMat4(m, Number(p[0]), Number(p[1]), Number(p[2]));
      });
    }
    return vertices.map(function (p) {
      return [center[0] + Number(p[0]), center[1] + Number(p[1]), center[2] + Number(p[2])];
    });
  }

  function transformPointMat4(m, x, y, z) {
    return [
      m[0] * x + m[4] * y + m[8]  * z + m[12],
      m[1] * x + m[5] * y + m[9]  * z + m[13],
      m[2] * x + m[6] * y + m[10] * z + m[14]
    ];
  }

  function transformVerticesByMatrix(vertices, matrix) {
    var m = toMatrix4(matrix, null);
    if (!m) { return vertices.slice(); }
    return vertices.map(function (p) {
      return transformPointMat4(m, Number(p[0]), Number(p[1]), Number(p[2]));
    });
  }

  function mat4MulColumnMajor(a, b) {
    var out = new Array(16);
    for (var col = 0; col < 4; col += 1) {
      for (var row = 0; row < 4; row += 1) {
        out[(col * 4) + row] =
          (Number(a[row]) || 0.0) * (Number(b[col * 4]) || 0.0) +
          (Number(a[4 + row]) || 0.0) * (Number(b[(col * 4) + 1]) || 0.0) +
          (Number(a[8 + row]) || 0.0) * (Number(b[(col * 4) + 2]) || 0.0) +
          (Number(a[12 + row]) || 0.0) * (Number(b[(col * 4) + 3]) || 0.0);
      }
    }
    return out;
  }

  function mat4TranslationColumnMajor(x, y, z) {
    return [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      Number(x || 0.0), Number(y || 0.0), Number(z || 0.0), 1
    ];
  }

  function mat4AxisAngleColumnMajor(axis, angleRad) {
    var a = normalize3(toVec3(axis, [0.0, 1.0, 0.0]), [0.0, 1.0, 0.0]);
    var x = a[0], y = a[1], z = a[2];
    var c = Math.cos(Number(angleRad || 0.0));
    var s = Math.sin(Number(angleRad || 0.0));
    var t = 1.0 - c;
    return [
      (t * x * x) + c,       (t * x * y) + (s * z), (t * x * z) - (s * y), 0,
      (t * x * y) - (s * z), (t * y * y) + c,       (t * y * z) + (s * x), 0,
      (t * x * z) + (s * y), (t * y * z) - (s * x), (t * z * z) + c,       0,
      0,                     0,                     0,                     1
    ];
  }

  function mat4RotateAroundPoint(axis, angleRad, pivot, baseModel) {
    var p = toVec3(pivot, [0.0, 0.0, 0.0]);
    var base = Array.isArray(baseModel) && baseModel.length === 16 ? baseModel.slice() : [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ];
    return mat4MulColumnMajor(
      mat4MulColumnMajor(
        mat4MulColumnMajor(mat4TranslationColumnMajor(p[0], p[1], p[2]), mat4AxisAngleColumnMajor(axis, angleRad)),
        mat4TranslationColumnMajor(-p[0], -p[1], -p[2])
      ),
      base
    );
  }

  function finiteVec3(value, fallback) {
    var v = toVec3(value, fallback || [0.0, 0.0, 0.0]);
    for (var i = 0; i < 3; i += 1) {
      if (!Number.isFinite(v[i])) { return (fallback || [0.0, 0.0, 0.0]).slice(); }
    }
    return v;
  }

  function fallRotationFromAxis(axis, angleRad, fallback) {
    var a = finiteVec3(axis, [0.0, 1.0, 0.0]);
    var angle = Number.isFinite(Number(angleRad)) ? Number(angleRad) : 0.0;
    var base = finiteVec3(fallback, [0.0, 0.0, 0.0]);
    return [
      base[0] + (a[0] * angle),
      base[1] + (a[1] * angle),
      base[2] + (a[2] * angle)
    ];
  }

  function finiteMat4(value) {
    if (!Array.isArray(value) || value.length !== 16) { return null; }
    var out = new Array(16);
    for (var i = 0; i < 16; i += 1) {
      var n = Number(value[i]);
      if (!Number.isFinite(n)) { return null; }
      out[i] = n;
    }
    return out;
  }

  function makeRng(seed) {
    var state = (Number(seed) || 0) >>> 0;
    return function () {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  function computeBounds(vertices) {
    var min = [Infinity, Infinity, Infinity];
    var max = [-Infinity, -Infinity, -Infinity];
    for (var i = 0; i < vertices.length; i += 1) {
      var p = vertices[i];
      if (p[0] < min[0]) { min[0] = p[0]; }
      if (p[1] < min[1]) { min[1] = p[1]; }
      if (p[2] < min[2]) { min[2] = p[2]; }
      if (p[0] > max[0]) { max[0] = p[0]; }
      if (p[1] > max[1]) { max[1] = p[1]; }
      if (p[2] > max[2]) { max[2] = p[2]; }
    }
    return { min: min, max: max };
  }

  function computeCentroid(vertices) {
    var out = [0.0, 0.0, 0.0];
    if (!vertices.length) { return out; }
    for (var i = 0; i < vertices.length; i += 1) {
      out[0] += Number(vertices[i][0]);
      out[1] += Number(vertices[i][1]);
      out[2] += Number(vertices[i][2]);
    }
    out[0] /= vertices.length;
    out[1] /= vertices.length;
    out[2] /= vertices.length;
    return out;
  }

  function meshCenterFromBounds(bounds) {
    return [
      0.5 * (Number(bounds.min[0]) + Number(bounds.max[0])),
      0.5 * (Number(bounds.min[1]) + Number(bounds.max[1])),
      0.5 * (Number(bounds.min[2]) + Number(bounds.max[2]))
    ];
  }

  function matrixForMesh(mesh) {
    if (mesh && Array.isArray(mesh.transform) && mesh.transform.length === 16) {
      return mesh.transform.slice();
    }
    var center = toVec3(mesh && mesh.center, [0, 0, 0]);
    var rotation = toVec3(mesh && mesh.rotation, [0, 0, 0]);
    var Mm = global.VfGeomMath;
    if (Mm && typeof Mm.mat4ModelTRS === "function") {
      return Array.prototype.slice.call(Mm.mat4ModelTRS(center, rotation, [1, 1, 1]));
    }
    return [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      center[0], center[1], center[2], 1
    ];
  }

  function transformDirMat4(m, dir) {
    var x = Number(dir[0]) || 0.0;
    var y = Number(dir[1]) || 0.0;
    var z = Number(dir[2]) || 0.0;
    return [
      (Number(m[0]) || 0.0) * x + (Number(m[4]) || 0.0) * y + (Number(m[8]) || 0.0) * z,
      (Number(m[1]) || 0.0) * x + (Number(m[5]) || 0.0) * y + (Number(m[9]) || 0.0) * z,
      (Number(m[2]) || 0.0) * x + (Number(m[6]) || 0.0) * y + (Number(m[10]) || 0.0) * z
    ];
  }

  function inverseRigidDirMat4(m, dir) {
    var x = Number(dir[0]) || 0.0;
    var y = Number(dir[1]) || 0.0;
    var z = Number(dir[2]) || 0.0;
    return [
      ((Number(m[0]) || 0.0) * x) + ((Number(m[1]) || 0.0) * y) + ((Number(m[2]) || 0.0) * z),
      ((Number(m[4]) || 0.0) * x) + ((Number(m[5]) || 0.0) * y) + ((Number(m[6]) || 0.0) * z),
      ((Number(m[8]) || 0.0) * x) + ((Number(m[9]) || 0.0) * y) + ((Number(m[10]) || 0.0) * z)
    ];
  }

  function planeReflectionMat3(normal) {
    var n = normalize3(normal, [0, 0, 1]);
    var nx = Number(n[0]) || 0.0;
    var ny = Number(n[1]) || 0.0;
    var nz = Number(n[2]) || 0.0;
    return [
      1.0 - (2.0 * nx * nx), -2.0 * nx * ny, -2.0 * nx * nz,
      -2.0 * ny * nx, 1.0 - (2.0 * ny * ny), -2.0 * ny * nz,
      -2.0 * nz * nx, -2.0 * nz * ny, 1.0 - (2.0 * nz * nz)
    ];
  }

  function transformDirMat3(m, dir) {
    var x = Number(dir[0]) || 0.0;
    var y = Number(dir[1]) || 0.0;
    var z = Number(dir[2]) || 0.0;
    return [
      (Number(m[0]) || 0.0) * x + (Number(m[1]) || 0.0) * y + (Number(m[2]) || 0.0) * z,
      (Number(m[3]) || 0.0) * x + (Number(m[4]) || 0.0) * y + (Number(m[5]) || 0.0) * z,
      (Number(m[6]) || 0.0) * x + (Number(m[7]) || 0.0) * y + (Number(m[8]) || 0.0) * z
    ];
  }

  function reflectPointAcrossPlane(point, planePoint, planeNormal) {
    var reflection = planeReflectionMat3(planeNormal);
    var vx = Number(point[0]) - Number(planePoint[0]);
    var vy = Number(point[1]) - Number(planePoint[1]);
    var vz = Number(point[2]) - Number(planePoint[2]);
    var reflected = transformDirMat3(reflection, [vx, vy, vz]);
    return [
      Number(planePoint[0]) + reflected[0],
      Number(planePoint[1]) + reflected[1],
      Number(planePoint[2]) + reflected[2]
    ];
  }

  function reflectDirAcrossPlane(dir, planeNormal) {
    return transformDirMat3(planeReflectionMat3(planeNormal), dir);
  }

  function buildMirrorSurfaceCamera(viewerCamera, hostMesh) {
    var model = matrixForMesh(hostMesh);
    var planePoint = transformPointMat4(model, 0.0, 0.0, 0.0);
    var planeNormal = normalize3(transformDirMat4(model, [0, 0, 1]), [0, 0, 1]);
    var viewPos = toVec3(viewerCamera && viewerCamera.pos, [4.0, -5.0, 3.5]);
    var viewTarget = toVec3(viewerCamera && viewerCamera.target, [0.0, 0.0, 0.0]);
    var viewUp = normalize3(toVec3(viewerCamera && viewerCamera.up, [0.0, 0.0, 1.0]), [0.0, 0.0, 1.0]);
    var reflectedPos = reflectPointAcrossPlane(viewPos, planePoint, planeNormal);
    var reflectedTarget = reflectPointAcrossPlane(viewTarget, planePoint, planeNormal);
    var reflectedUp = normalize3(reflectDirAcrossPlane(viewUp, planeNormal), viewUp);
    return {
      pos: reflectedPos,
      target: reflectedTarget,
      up: reflectedUp,
      fov: Number(viewerCamera && viewerCamera.fov || 34.0) || 34.0
    };
  }

  function buildMirrorEyeLockedCamera(viewerCamera, hostMesh, baseCamera) {
    var geomUtil = global.VfGeomWgpuUtil;
    if (!geomUtil || typeof geomUtil.derivePlanarSurfaceWorldFrame !== "function" || !global.VfGeomMath) {
      failFast("mirror eye-locked camera requires canonical planar frame adapter");
    }
    var frame = geomUtil.derivePlanarSurfaceWorldFrame({ mesh: hostMesh }, 0, global.VfGeomMath);
    if (!frame || !Array.isArray(frame.point) || !Array.isArray(frame.normal)) {
      failFast("mirror eye-locked camera canonical planar frame is invalid");
    }
    var minU = Number(frame.minU || 0.0);
    var maxU = Number(frame.maxU == null ? (minU + Number(frame.spanU || 0.0)) : frame.maxU);
    var minV = Number(frame.minV || 0.0);
    var maxV = Number(frame.maxV == null ? (minV + Number(frame.spanV || 0.0)) : frame.maxV);
    var planePoint = [
      Number(frame.point[0] || 0.0) + (Number(frame.uAxis[0] || 0.0) * ((minU + maxU) * 0.5)) + (Number(frame.vAxis[0] || 0.0) * ((minV + maxV) * 0.5)),
      Number(frame.point[1] || 0.0) + (Number(frame.uAxis[1] || 0.0) * ((minU + maxU) * 0.5)) + (Number(frame.vAxis[1] || 0.0) * ((minV + maxV) * 0.5)),
      Number(frame.point[2] || 0.0) + (Number(frame.uAxis[2] || 0.0) * ((minU + maxU) * 0.5)) + (Number(frame.vAxis[2] || 0.0) * ((minV + maxV) * 0.5))
    ];
    var planeNormal = normalize3(frame.normal, [0.0, 0.0, 1.0]);
    var reflectedPos = reflectPointAcrossPlane(
      toVec3(viewerCamera && viewerCamera.pos, [4.0, -5.0, 3.5]),
      planePoint,
      planeNormal
    );
    return {
      pos: reflectedPos,
      target: planePoint,
      up: [0.0, 0.0, 1.0],
      fov: Number(viewerCamera && viewerCamera.fov || 34.0) || 34.0
    };
  }

  function renderedMirrorPartForCamera(mesh, camera, purpose) {
    var rendered = buildMeshPayload(mesh, camera, []);
    if (Array.isArray(rendered)) {
      failFast(String(purpose || "mirror camera") + " requires one rendered planar mirror mesh");
    }
    if (!rendered || rendered.kind !== "quad") {
      failFast(String(purpose || "mirror camera") + " requires rendered quad mirror mesh");
    }
    return { mesh: rendered };
  }

  function buildConvexHullGeometry(spec, points) {
    if (spec._generatedHull) { return spec._generatedHull; }
    var verts = Array.isArray(points) ? points : [];
    if (verts.length < 4) {
      failFast("convex hull requires at least 4 points");
    }
    var coplanarZ = true;
    var z0 = Number(verts[0][2] || 0.0);
    for (var zIndex = 1; zIndex < verts.length; zIndex += 1) {
      if (Math.abs((Number(verts[zIndex][2] || 0.0)) - z0) > 1e-6) {
        coplanarZ = false;
        break;
      }
    }
    if (coplanarZ) {
      var ordered = verts.map(function (p, idx) {
        return [Number(p[0] || 0.0), Number(p[1] || 0.0), Number(p[2] || 0.0), idx];
      }).sort(function (a, b) {
        return a[0] === b[0] ? (a[1] - b[1]) : (a[0] - b[0]);
      });
      var unique = [];
      for (var uniqueIndex = 0; uniqueIndex < ordered.length; uniqueIndex += 1) {
        if (!unique.length || Math.abs(unique[unique.length - 1][0] - ordered[uniqueIndex][0]) > 1e-6 || Math.abs(unique[unique.length - 1][1] - ordered[uniqueIndex][1]) > 1e-6) {
          unique.push(ordered[uniqueIndex]);
        }
      }
      if (unique.length < 3) {
        failFast("convex hull requires at least 3 unique coplanar points");
      }
      var lower = [];
      for (var li = 0; li < unique.length; li += 1) {
        while (lower.length >= 2 && cross2(lower[lower.length - 2], lower[lower.length - 1], unique[li]) <= 0) {
          lower.pop();
        }
        lower.push(unique[li]);
      }
      var upper = [];
      for (var ui = unique.length - 1; ui >= 0; ui -= 1) {
        while (upper.length >= 2 && cross2(upper[upper.length - 2], upper[upper.length - 1], unique[ui]) <= 0) {
          upper.pop();
        }
        upper.push(unique[ui]);
      }
      lower.pop();
      upper.pop();
      var boundary = lower.concat(upper);
      var boundaryIndices = boundary.map(function (p) { return Number(p[3]) | 0; });
      var boundaryFaces = [];
      var boundaryEdges = [];
      for (var edgeIdx = 0; edgeIdx < boundaryIndices.length; edgeIdx += 1) {
        boundaryEdges.push([boundaryIndices[edgeIdx], boundaryIndices[(edgeIdx + 1) % boundaryIndices.length]]);
      }
      for (var faceIdx = 1; faceIdx + 1 < boundaryIndices.length; faceIdx += 1) {
        boundaryFaces.push([boundaryIndices[0], boundaryIndices[faceIdx], boundaryIndices[faceIdx + 1]]);
      }
      spec._generatedHull = {
        vertices: verts,
        hullVertexIndices: boundaryIndices.slice(),
        faces: boundaryFaces,
        edges: boundaryEdges,
        bounds: computeBounds(verts),
        centroid: computeCentroid(verts)
      };
      return spec._generatedHull;
    }
    var centroid = computeCentroid(verts);
    var faces = [];
    var edgeSeen = Object.create(null);
    var edges = [];
    var eps = 1e-5;
    for (var a = 0; a < verts.length - 2; a += 1) {
      for (var b = a + 1; b < verts.length - 1; b += 1) {
        for (var c = b + 1; c < verts.length; c += 1) {
          var pa = verts[a];
          var pb = verts[b];
          var pc = verts[c];
          var n = faceNormal(pa, pb, pc);
          var side = 0;
          var valid = true;
          for (var d = 0; d < verts.length; d += 1) {
            if (d === a || d === b || d === c) { continue; }
            var pd = verts[d];
            var signed = ((pd[0] - pa[0]) * n[0]) + ((pd[1] - pa[1]) * n[1]) + ((pd[2] - pa[2]) * n[2]);
            if (Math.abs(signed) <= eps) { continue; }
            var curr = signed > 0 ? 1 : -1;
            if (side === 0) {
              side = curr;
            } else if (side !== curr) {
              valid = false;
              break;
            }
          }
          if (!valid) { continue; }
          var tri = [a, b, c];
          var faceCenter = [
            (pa[0] + pb[0] + pc[0]) / 3.0,
            (pa[1] + pb[1] + pc[1]) / 3.0,
            (pa[2] + pb[2] + pc[2]) / 3.0
          ];
          var outward = [
            faceCenter[0] - centroid[0],
            faceCenter[1] - centroid[1],
            faceCenter[2] - centroid[2]
          ];
          if ((((n[0] * outward[0]) + (n[1] * outward[1]) + (n[2] * outward[2])) < 0.0)) {
            tri = [a, c, b];
          }
          faces.push(tri);
          var triEdges = [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]];
          for (var triEdgeIndex = 0; triEdgeIndex < triEdges.length; triEdgeIndex += 1) {
            var triEdge = triEdges[triEdgeIndex];
            var edgeKey = triEdge[0] < triEdge[1] ? (triEdge[0] + "," + triEdge[1]) : (triEdge[1] + "," + triEdge[0]);
            if (!edgeSeen[edgeKey]) {
              edgeSeen[edgeKey] = true;
              edges.push([triEdge[0], triEdge[1]]);
            }
          }
        }
      }
    }
    spec._generatedHull = {
      vertices: verts,
      hullVertexIndices: Array.from(edgeSeen ? (function () {
        var used = Object.create(null);
        var out = [];
        for (var edgeIdx3 = 0; edgeIdx3 < edges.length; edgeIdx3 += 1) {
          var edge3 = edges[edgeIdx3];
          for (var edgeVertIdx = 0; edgeVertIdx < edge3.length; edgeVertIdx += 1) {
            var vi = Number(edge3[edgeVertIdx]) | 0;
            if (!used[vi]) {
              used[vi] = true;
              out.push(vi);
            }
          }
        }
        return out;
      }()) : []),
      faces: faces,
      edges: edges,
      bounds: computeBounds(verts),
      centroid: centroid
    };
    return spec._generatedHull;
  }

  function buildSimplicialGeometry(spec) {
    if (spec._generatedSimplices) { return spec._generatedSimplices; }
    var vertices = Array.isArray(spec.points) ? spec.points.map(function (p) { return toVec3(p, [0, 0, 0]); }) : [];
    var simplices = spec.add_simplices || {};
    var edges = Array.isArray(simplices.edges) ? simplices.edges : [];
    var faces = Array.isArray(simplices.faces) ? simplices.faces : [];
    var volumes = Array.isArray(simplices.volumes) ? simplices.volumes : [];
    var boundaryFaces = [];
    var seen = Object.create(null);
    for (var i = 0; i < faces.length; i += 1) {
      if (Array.isArray(faces[i]) && faces[i].length === 3) {
        boundaryFaces.push([Number(faces[i][0]) | 0, Number(faces[i][1]) | 0, Number(faces[i][2]) | 0]);
      }
    }
    for (var volumeIndex = 0; volumeIndex < volumes.length; volumeIndex += 1) {
      var tetra = volumes[volumeIndex];
      if (!Array.isArray(tetra) || tetra.length !== 4) { continue; }
      var tetraFaces = [
        [tetra[0], tetra[1], tetra[2]],
        [tetra[0], tetra[1], tetra[3]],
        [tetra[0], tetra[2], tetra[3]],
        [tetra[1], tetra[2], tetra[3]]
      ];
      for (var faceIndex = 0; faceIndex < tetraFaces.length; faceIndex += 1) {
        var face = tetraFaces[faceIndex].map(function (v) { return Number(v) | 0; });
        var key = face.slice().sort(function (a, b) { return a - b; }).join(",");
        if (!seen[key]) {
          seen[key] = { count: 1, face: face };
        } else {
          seen[key].count += 1;
        }
      }
    }
    var keys = Object.keys(seen);
    for (var keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      var entry = seen[keys[keyIndex]];
      if (entry.count === 1) {
        boundaryFaces.push(entry.face);
      }
    }
    spec._generatedSimplices = {
      vertices: vertices,
      edges: edges,
      faces: boundaryFaces,
      bounds: computeBounds(vertices),
      centroid: computeCentroid(vertices)
    };
    return spec._generatedSimplices;
  }

  function generateRandomHullGeometry(spec) {
    if (spec._generatedHull) { return spec._generatedHull; }
    var center = toVec3(spec.center, [0, 0, 1.2]);
    var stretch = toVec3(spec.stretch, [1.0, 0.84, 1.28]);
    var radius = Math.max(0.1, Number(spec.radius || 1.1));
    var count = Math.max(8, Number(spec.count || 100) | 0);
    var jitter = Math.max(0.0, Number(spec.jitter || 0.28));
    var rnd = makeRng(spec.seed || 7);
    var points = [];
    for (var i = 0; i < count; i += 1) {
      var z = (rnd() * 2.0) - 1.0;
      var theta = rnd() * Math.PI * 2.0;
      var r = Math.sqrt(Math.max(0.0, 1.0 - (z * z)));
      var dir = [r * Math.cos(theta), r * Math.sin(theta), z];
      var radial = radius * (1.0 - jitter + (2.0 * jitter * rnd()));
      points.push([
        center[0] + (dir[0] * stretch[0] * radial),
        center[1] + (dir[1] * stretch[1] * radial),
        center[2] + (dir[2] * stretch[2] * radial)
      ]);
    }
    return buildConvexHullGeometry(spec, points);
  }

  function meshVerticesForOccluder(mesh) {
    if (!mesh) { return []; }
    if (mesh.kind === "field_mesh") {
      var rawVerts = numericArrayLike(mesh.vertices) ? mesh.vertices : [];
      var localPositions = [];
      if (rawVerts.length && Array.isArray(rawVerts[0])) {
        for (var fv = 0; fv < rawVerts.length; fv += 1) {
          localPositions.push(toVec3(rawVerts[fv], [0.0, 0.0, 0.0]));
        }
      } else {
        for (var flatIndex = 0; flatIndex + 2 < rawVerts.length; flatIndex += 10) {
          localPositions.push([
            Number(rawVerts[flatIndex] || 0.0),
            Number(rawVerts[flatIndex + 1] || 0.0),
            Number(rawVerts[flatIndex + 2] || 0.0)
          ]);
        }
      }
      if (Array.isArray(mesh._modelMatrix) && mesh._modelMatrix.length === 16) {
        return transformVerticesByMatrix(localPositions, mesh._modelMatrix);
      }
      var meshScale = toVec3(mesh.scale, [1.0, 1.0, 1.0]);
      var scaledLocal = [];
      for (var localIndex = 0; localIndex < localPositions.length; localIndex += 1) {
        var lp = localPositions[localIndex];
        scaledLocal.push([
          Number(lp[0] || 0.0) * Number(meshScale[0] || 1.0),
          Number(lp[1] || 0.0) * Number(meshScale[1] || 1.0),
          Number(lp[2] || 0.0) * Number(meshScale[2] || 1.0)
        ]);
      }
      return transformLocalVertices(scaledLocal, mesh.center || [0, 0, 0], mesh.rotation || [0, 0, 0]);
    }
    if (mesh.kind === "cube") {
      if (Array.isArray(mesh.transform) && mesh.transform.length === 16) {
        return transformVerticesByMatrix(makeCubeLocalVertices(mesh.size), mesh.transform);
      }
      return transformLocalVertices(makeCubeLocalVertices(mesh.size), mesh.center, mesh.rotation || [0, 0, 0]);
    }
    if (mesh.kind === "quad") {
      var quadSize = Array.isArray(mesh.size)
        ? [Number(mesh.size[0] || 0.0), Number(mesh.size[1] || 0.0)]
        : [Number(mesh.size || 0.0), Number(mesh.size || 0.0)];
      var halfX = Math.max(0.0, quadSize[0]) * 0.5;
      var halfY = Math.max(0.0, quadSize[1]) * 0.5;
      var localQuad = [
        [-halfX, -halfY, 0.0],
        [ halfX, -halfY, 0.0],
        [ halfX,  halfY, 0.0],
        [-halfX,  halfY, 0.0]
      ];
      if (Array.isArray(mesh.transform) && mesh.transform.length === 16) {
        return transformVerticesByMatrix(localQuad, mesh.transform);
      }
      return transformLocalVertices(localQuad, mesh.center, mesh.rotation || [0, 0, 0]);
    }
    if (mesh.kind === "convex_hull") {
      return buildConvexHullGeometry(mesh, Array.isArray(mesh.points) ? mesh.points.map(function (p) {
        return toVec3(p, [0, 0, 0]);
      }) : []).vertices;
    }
    if (mesh.kind === "simplices") {
      return buildSimplicialGeometry(mesh).vertices;
    }
    if (mesh.kind === "random_hull") {
      return generateRandomHullGeometry(mesh).vertices;
    }
    return [];
  }

  function cubeMesh(cube, color) {
    var hasDynamicTransform = !!(cube.tracks && (cube.tracks.center || cube.tracks.rotation || cube.tracks.transform || cube.tracks.scale));
    var localVertices = makeCubeLocalVertices(cube.size);
    var vertices = localVertices;
    var bakedStaticTransform = false;
    if (!hasDynamicTransform) {
      if (Array.isArray(cube.transform) && cube.transform.length === 16) {
        vertices = transformVerticesByMatrix(localVertices, cube.transform);
        bakedStaticTransform = true;
      } else {
        vertices = transformLocalVertices(
          localVertices,
          toVec3(cube.center, [0, 0, 0]),
          toVec3(cube.rotation, [0, 0, 0])
        );
        bakedStaticTransform = true;
      }
    }
    var faces = [
      [4, 5, 6, 7],
      [0, 1, 2, 3],
      [1, 5, 6, 2],
      [0, 4, 7, 3],
      [3, 2, 6, 7],
      [0, 1, 5, 4]
    ];
    var verts = [];
    var indices = [];
    var nextIndex = 0;
    var i;
    for (i = 0; i < faces.length; i += 1) {
      var face = faces[i];
      var a = vertices[face[0]];
      var b = vertices[face[1]];
      var c = vertices[face[2]];
      var d = vertices[face[3]];
      var n = faceNormal(a, b, c);
      pushVertex(verts, a, n, color);
      pushVertex(verts, b, n, color);
      pushVertex(verts, c, n, color);
      pushVertex(verts, a, n, color);
      pushVertex(verts, c, n, color);
      pushVertex(verts, d, n, color);
      indices.push(nextIndex, nextIndex + 1, nextIndex + 2, nextIndex + 3, nextIndex + 4, nextIndex + 5);
      nextIndex += 6;
    }
    var mesh = {
      type: "field_mesh",
      kind: "cube",
      id: String(cube.id || "cube_body"),
      object_id: Number(cube.object_id || 0) || undefined,
      topology: "triangle-list",
      vertices: verts,
      indices: indices,
      color: color,
      texture: cube.texture || null,
      surface_system: cube.surface_system || null,
      casts_shadow: cube.casts_shadow !== false,
      receives_shadow: cube.receives_shadow !== false,
      no_backface_specular: cube.no_backface_specular === true,
      tracks: cube.tracks || null,
      animation_timing: {
        fps: fps,
        duration_seconds: durationSeconds,
        boundary: boundary
      },
      scale: [1, 1, 1],
      interpolation: false,
      depth_write: true
    };
    if (bakedStaticTransform) {
      mesh.center = [0, 0, 0];
      mesh.rotation = [0, 0, 0];
    } else if (Array.isArray(cube.transform) && cube.transform.length === 16) {
      mesh._modelMatrix = cube.transform.slice();
    } else {
      mesh.center = toVec3(cube.center, [0, 0, 0]);
      mesh.rotation = toVec3(cube.rotation, [0, 0, 0]);
    }
    return mesh;
  }

  function convexHullMesh(mesh, color) {
    var hull = mesh.kind === "random_hull"
      ? generateRandomHullGeometry(mesh)
      : buildConvexHullGeometry(mesh, Array.isArray(mesh.points) ? mesh.points.map(function (p) {
          return toVec3(p, [0, 0, 0]);
        }) : []);
    var verts = [];
    var indices = [];
    var nextIndex = 0;
    for (var i = 0; i < hull.faces.length; i += 1) {
      var tri = hull.faces[i];
      var a = hull.vertices[tri[0]];
      var b = hull.vertices[tri[1]];
      var c = hull.vertices[tri[2]];
      var n = faceNormal(a, b, c);
      pushVertex(verts, a, n, color);
      pushVertex(verts, b, n, color);
      pushVertex(verts, c, n, color);
      indices.push(nextIndex, nextIndex + 1, nextIndex + 2);
      nextIndex += 3;
    }
    return {
      type: "field_mesh",
      id: String(mesh.id || "random_hull"),
      topology: "triangle-list",
      vertices: verts,
      indices: indices,
      color: color,
      interpolation: false,
      depth_write: true
    };
  }

  function convexHullEdgeMesh(mesh) {
    var hull = mesh.kind === "random_hull"
      ? generateRandomHullGeometry(mesh)
      : buildConvexHullGeometry(mesh, Array.isArray(mesh.points) ? mesh.points.map(function (p) {
          return toVec3(p, [0, 0, 0]);
        }) : []);
    var edgeWidth = Math.max(0.0, Number(mesh.edge_width || 0.0));
    if (!(edgeWidth > 0) || mesh.show_edges === false || !Array.isArray(hull.edges) || !hull.edges.length) {
      return null;
    }
    var color = toRgba(mesh.edge_color, [0.10, 0.82, 0.26, 1.0]);
    var liftedVertices = liftedFlatVertices(hull.vertices, mesh.edge_lift);
    var verts = [];
    var indices = [];
    for (var i = 0; i < liftedVertices.length; i += 1) {
      pushVertex(verts, liftedVertices[i], [0, 0, 1], color);
    }
    for (var edgeIndex = 0; edgeIndex < hull.edges.length; edgeIndex += 1) {
      var edge = hull.edges[edgeIndex];
      if (!Array.isArray(edge) || edge.length !== 2) { continue; }
      indices.push(Number(edge[0]) | 0, Number(edge[1]) | 0);
    }
    return {
      type: "field_mesh",
      id: String(mesh.id || "convex_hull") + "_edges",
      topology: "line-list",
      vertices: verts,
      indices: indices,
      edge_width: edgeWidth,
      edge_caps: mesh.edge_caps !== false,
      color: color,
      render_mode: overlayRenderMode(mesh, "edge"),
      marker_space: overlayMarkerSpace(mesh, "edge"),
      casts_shadow: mesh.edge_casts_shadow !== false,
      no_lighting: mesh.edge_receives_lighting === false,
      interpolation: false,
      depth_write: overlayDepthWrite(mesh, "edge")
    };
  }

  function convexHullVertexMesh(mesh) {
    var hull = mesh.kind === "random_hull"
      ? generateRandomHullGeometry(mesh)
      : buildConvexHullGeometry(mesh, Array.isArray(mesh.points) ? mesh.points.map(function (p) {
          return toVec3(p, [0, 0, 0]);
        }) : []);
    var vertexSize = Math.max(0.0, Number(mesh.vertex_size || 0.0));
    var hullVertexIndices = Array.isArray(hull.hullVertexIndices) ? hull.hullVertexIndices : [];
    if (!(vertexSize > 0) || mesh.show_vertices === false || !Array.isArray(hull.vertices) || !hull.vertices.length || !hullVertexIndices.length) {
      return null;
    }
    var color = toRgba(mesh.vertex_color, mesh.face_color || [0.96, 0.22, 0.16, 1.0]);
    var liftedVertices = liftedFlatVertices(hull.vertices, mesh.vertex_lift);
    var verts = [];
    var indices = [];
    for (var i = 0; i < hullVertexIndices.length; i += 1) {
      var sourceIndex = Number(hullVertexIndices[i]) | 0;
      if (!liftedVertices[sourceIndex]) { continue; }
      pushVertex(verts, liftedVertices[sourceIndex], [0, 0, 1], color);
      indices.push(indices.length);
    }
    return {
      type: "field_mesh",
      id: String(mesh.id || "convex_hull") + "_vertices",
      topology: "point-list",
      vertices: verts,
      indices: indices,
      vertex_size: vertexSize,
      color: color,
      render_mode: overlayRenderMode(mesh, "vertex"),
      marker_space: overlayMarkerSpace(mesh, "vertex"),
      casts_shadow: mesh.vertex_casts_shadow !== false,
      no_lighting: mesh.vertex_receives_lighting === false,
      interpolation: false,
      depth_write: overlayDepthWrite(mesh, "vertex")
    };
  }

  function simplicesMesh(mesh, color) {
    var simplicial = buildSimplicialGeometry(mesh);
    var verts = [];
    var indices = [];
    var nextIndex = 0;
    for (var i = 0; i < simplicial.faces.length; i += 1) {
      var tri = simplicial.faces[i];
      var a = simplicial.vertices[tri[0]];
      var b = simplicial.vertices[tri[1]];
      var c = simplicial.vertices[tri[2]];
      if (!a || !b || !c) { continue; }
      var n = faceNormal(a, b, c);
      pushVertex(verts, a, n, color);
      pushVertex(verts, b, n, color);
      pushVertex(verts, c, n, color);
      indices.push(nextIndex, nextIndex + 1, nextIndex + 2);
      nextIndex += 3;
    }
    if (!indices.length) { return null; }
    return {
      type: "field_mesh",
      id: String(mesh.id || "simplices"),
      topology: "triangle-list",
      vertices: verts,
      indices: indices,
      color: color,
      interpolation: false,
      depth_write: true
    };
  }

  function liftedFlatVertices(vertices, amount) {
    var lift = Number(amount || 0.0);
    if (!(lift > 0) || !Array.isArray(vertices) || !vertices.length) {
      return vertices;
    }
    var z0 = Number(vertices[0][2] || 0.0);
    for (var i = 1; i < vertices.length; i += 1) {
      if (Math.abs((Number(vertices[i][2] || 0.0)) - z0) > 1e-6) {
        return vertices;
      }
    }
    var out = [];
    for (var vertexIndex = 0; vertexIndex < vertices.length; vertexIndex += 1) {
      var v = vertices[vertexIndex];
      out.push([Number(v[0] || 0.0), Number(v[1] || 0.0), Number(v[2] || 0.0) + lift]);
    }
    return out;
  }

  function simplicesEdgeMesh(mesh) {
    var simplicial = buildSimplicialGeometry(mesh);
    var edgeWidth = Math.max(0.0, Number(mesh.edge_width || 0.0));
    if (!(edgeWidth > 0) || mesh.show_edges === false || !Array.isArray(simplicial.edges) || !simplicial.edges.length) {
      return null;
    }
    var color = toRgba(mesh.edge_color, [0.10, 0.82, 0.26, 1.0]);
    var liftedVertices = liftedFlatVertices(simplicial.vertices, mesh.edge_lift);
    var verts = [];
    var indices = [];
    for (var i = 0; i < liftedVertices.length; i += 1) {
      pushVertex(verts, liftedVertices[i], [0, 0, 1], color);
    }
    for (var edgeIndex = 0; edgeIndex < simplicial.edges.length; edgeIndex += 1) {
      var edge = simplicial.edges[edgeIndex];
      if (!Array.isArray(edge) || edge.length !== 2) { continue; }
      var a = Number(edge[0]) | 0;
      var b = Number(edge[1]) | 0;
      if (!simplicial.vertices[a] || !simplicial.vertices[b]) { continue; }
      indices.push(a, b);
    }
    if (!indices.length) { return null; }
    return {
      type: "field_mesh",
      id: String(mesh.id || "simplices") + "_edges",
      topology: "line-list",
      vertices: verts,
      indices: indices,
      edge_width: edgeWidth,
      edge_caps: mesh.edge_caps !== false,
      color: color,
      render_mode: overlayRenderMode(mesh, "edge"),
      marker_space: overlayMarkerSpace(mesh, "edge"),
      casts_shadow: mesh.edge_casts_shadow !== false,
      no_lighting: mesh.edge_receives_lighting === false,
      interpolation: false,
      depth_write: overlayDepthWrite(mesh, "edge")
    };
  }

  function simplicesVertexMesh(mesh) {
    var simplicial = buildSimplicialGeometry(mesh);
    var vertexSize = Math.max(0.0, Number(mesh.vertex_size || 0.0));
    if (!(vertexSize > 0) || mesh.show_vertices === false || !Array.isArray(simplicial.vertices) || !simplicial.vertices.length) {
      return null;
    }
    var color = toRgba(mesh.vertex_color, mesh.face_color || [0.96, 0.22, 0.16, 1.0]);
    var liftedVertices = liftedFlatVertices(simplicial.vertices, mesh.vertex_lift);
    var verts = [];
    var indices = [];
    for (var i = 0; i < liftedVertices.length; i += 1) {
      pushVertex(verts, liftedVertices[i], [0, 0, 1], color);
      indices.push(i);
    }
    return {
      type: "field_mesh",
      id: String(mesh.id || "simplices") + "_vertices",
      topology: "point-list",
      vertices: verts,
      indices: indices,
      vertex_size: vertexSize,
      color: color,
      render_mode: overlayRenderMode(mesh, "vertex"),
      marker_space: overlayMarkerSpace(mesh, "vertex"),
      casts_shadow: mesh.vertex_casts_shadow !== false,
      no_lighting: mesh.vertex_receives_lighting === false,
      interpolation: false,
      depth_write: overlayDepthWrite(mesh, "vertex")
    };
  }

  function cross2(o, a, b) {
    return ((a[0] - o[0]) * (b[1] - o[1])) - ((a[1] - o[1]) * (b[0] - o[0]));
  }

  function convexHull(points) {
    var pts = points.slice().sort(function (a, b) {
      return a[0] === b[0] ? (a[1] - b[1]) : (a[0] - b[0]);
    });
    var unique = [];
    var i;
    for (i = 0; i < pts.length; i += 1) {
      if (!unique.length || Math.abs(unique[unique.length - 1][0] - pts[i][0]) > 1e-6 || Math.abs(unique[unique.length - 1][1] - pts[i][1]) > 1e-6) {
        unique.push(pts[i]);
      }
    }
    if (unique.length < 3) { return unique; }
    var lower = [];
    for (i = 0; i < unique.length; i += 1) {
      while (lower.length >= 2 && cross2(lower[lower.length - 2], lower[lower.length - 1], unique[i]) <= 0) {
        lower.pop();
      }
      lower.push(unique[i]);
    }
    var upper = [];
    for (i = unique.length - 1; i >= 0; i -= 1) {
      while (upper.length >= 2 && cross2(upper[upper.length - 2], upper[upper.length - 1], unique[i]) <= 0) {
        upper.pop();
      }
      upper.push(unique[i]);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  function projectPointToPlane(point, lightPos, planeZ) {
    planeZ = Number(planeZ);
    if (!Number.isFinite(planeZ)) { planeZ = 0.0; }
    var dz = point[2] - lightPos[2];
    if (Math.abs(dz) < 1e-6) { return null; }
    var t = (planeZ - lightPos[2]) / dz;
    return [
      lightPos[0] + ((point[0] - lightPos[0]) * t),
      lightPos[1] + ((point[1] - lightPos[1]) * t),
      planeZ
    ];
  }

  function planeMesh(plane) {
    var planeColor = toRgba(plane.color, [0.20, 0.22, 0.26, 1.0]);
    var isTransparent = plane.transparent === true || Number(planeColor[3] || 0.0) < 0.999;
    var size = Array.isArray(plane.size)
      ? [Number(plane.size[0] || 0.0), Number(plane.size[1] || 0.0)]
      : [Number(plane.size || 0.0), Number(plane.size || 0.0)];
    var halfX = Math.max(0.0, size[0]) * 0.5;
    var halfY = Math.max(0.0, size[1]) * 0.5;
    var center = toVec3(plane.center, [0.0, 0.0, 0.0]);
    var rotation = toVec3(plane.rotation, [0.0, 0.0, 0.0]);
    var verts = [];
    pushVertex(verts, [-halfX, -halfY, 0.0], [0, 0, 1], planeColor);
    pushVertex(verts, [ halfX, -halfY, 0.0], [0, 0, 1], planeColor);
    pushVertex(verts, [ halfX,  halfY, 0.0], [0, 0, 1], planeColor);
    pushVertex(verts, [-halfX,  halfY, 0.0], [0, 0, 1], planeColor);
    return {
      type: "field_mesh",
      id: String(plane.id || "ground_plane"),
      kind: "quad",
      object_id: Number(plane.object_id || 0) || undefined,
      topology: "triangle-list",
      vertices: verts,
      indices: [0, 1, 2, 0, 2, 3],
      center: center,
      size: size,
      rotation: rotation,
      _modelMatrix: toMatrix4(plane.transform, null),
      color: planeColor,
      texture: plane.texture || null,
      surface_system: plane.surface_system || null,
      casts_shadow: plane.casts_shadow !== false,
      receives_shadow: plane.receives_shadow !== false,
      no_backface_specular: plane.no_backface_specular === true,
      reverse_facing: plane.reverse_facing === true,
      light_model: "blinn_phong",
      interpolation: true,
      transparent: isTransparent,
      depth_write: plane.depth_write === false ? false : !isTransparent
    };
  }

  function normalizeMeshSpec(mesh, seconds, viewerCamera) {
    var spec = mesh || {};
    var framePos = animationFramePosition(seconds || 0.0);
    var kind = String(spec.kind || "");
    var faceColor = entityProp(spec, "face_color", entityProp(spec, "color", [0.96, 0.22, 0.16, 1.0]));
    if (kind !== "cube" && kind !== "quad" && kind !== "random_hull" && kind !== "convex_hull" && kind !== "simplices" && kind !== "field_mesh") {
      failFast("mesh.kind must be cube, quad, random_hull, convex_hull, simplices, or field_mesh");
    }
    if (kind === "field_mesh") {
      var renderMode = String(entityProp(spec, "render_mode", "proxy_geometry"));
      var fieldInterpolation = entityProp(spec, "interpolation", false) === true;
      var fieldVertices = fieldMeshFlatVertexArray(entityProp(spec, "vertices", []));
      var fieldIndices = fieldMeshIndexArray(entityProp(spec, "indices", []));
      fieldIndices = fieldMeshIndicesWithConsistentWinding(fieldVertices, fieldIndices, entityProp(spec, "repair_winding", true) !== false);
      fieldVertices = smoothInterpolatedFieldMeshVertices(spec, fieldVertices, fieldIndices, fieldInterpolation);
      var fieldColor = toRgba(entityProp(spec, "color", [1.0, 1.0, 1.0, 1.0]), [1.0, 1.0, 1.0, 1.0]);
      fieldVertices = fieldMeshVerticesWithMaterialColor(fieldVertices, fieldColor, entityProp(spec, "use_vertex_color", false) !== true);
      return {
        id: String(spec.id || "field_mesh"),
        kind: "field_mesh",
        object_id: Number(entityProp(spec, "object_id", 0) || 0) || undefined,
        vertices: fieldVertices,
        indices: fieldIndices,
        topology: String(entityProp(spec, "topology", "triangle-list")),
        interpolation: fieldInterpolation,
        alpha: Math.max(0.0, Math.min(1.0, Number(entityProp(spec, "alpha", 1.0)))),
        center: resolveTrackedVec3(spec, "center", framePos, toVec3(entityProp(spec, "center", [0.0, 0.0, 0.0]), [0.0, 0.0, 0.0])),
        scale: resolveTrackedVec3(spec, "scale", framePos, toVec3(entityProp(spec, "scale", [1.0, 1.0, 1.0]), [1.0, 1.0, 1.0])),
        rotation: resolveTrackedVec3(spec, "rotation", framePos, toVec3(entityProp(spec, "rotation", [0.0, 0.0, 0.0]), [0.0, 0.0, 0.0])),
        transform: resolveTrackedMatrix4(spec, "transform", framePos, toMatrix4(entityProp(spec, "transform", null), null)),
        color: fieldColor,
        visible: entityProp(spec, "visible", true) !== false,
        pickable: entityProp(spec, "pickable", true) !== false,
        transparent: entityProp(spec, "transparent", false) === true,
        time_boundary: String(entityProp(spec, "time_boundary", "clamp")),
        time_count: Math.max(1, Number(entityProp(spec, "time_count", 1) || 1) | 0),
        time_index: Math.max(0, Number(entityProp(spec, "time_index", 0) || 0) | 0),
        manifold_dim_count: Math.max(0, Number(entityProp(spec, "manifold_dim_count", 0) || 0) | 0),
        solid_volume: entityProp(spec, "solid_volume", false) === true,
        repair_winding: entityProp(spec, "repair_winding", true) !== false,
        static_vertices: entityProp(spec, "static_vertices", false) === true,
        static_indices: entityProp(spec, "static_indices", false) === true,
        vertex_size: Math.max(0.0, Number(entityProp(spec, "vertex_size", 0.0) || 0.0)),
        edge_width: Math.max(0.0, Number(entityProp(spec, "edge_width", 0.0) || 0.0)),
        vertex_widths: Array.isArray(entityProp(spec, "vertex_widths", [])) ? entityProp(spec, "vertex_widths", []).slice() : [],
        render_mode: renderMode,
        marker_space: String(entityProp(spec, "marker_space", String(renderMode).toLowerCase() === "marker_impostor" ? "pixel" : "world")),
        casts_shadow: entityProp(spec, "casts_shadow", true) !== false,
        receives_shadow: entityProp(spec, "receives_shadow", true) !== false,
        no_lighting: entityProp(spec, "receives_lighting", true) === false,
        no_cull: entityProp(spec, "no_cull", false) === true,
        specular_strength: Math.max(0.0, Math.min(4.0, Number(entityProp(spec, "specular_strength", 1.0) || 0.0))),
        depth_write: entityProp(spec, "depth_write", false) === true,
        tracks: spec && spec.tracks && typeof spec.tracks === "object" ? spec.tracks : null,
        animation_timing: {
          fps: fps,
          duration_seconds: durationSeconds,
          boundary: boundary
        }
      };
    }
    if (kind === "cube") {
      var transformFallback = entityProp(spec, "transform", null);
      return {
        id: String(spec.id || "cube"),
        kind: "cube",
        object_id: Number(entityProp(spec, "object_id", 0) || 0) || undefined,
        tracks: spec && spec.tracks && typeof spec.tracks === "object" ? spec.tracks : null,
        animation_timing: {
          fps: fps,
          duration_seconds: durationSeconds,
          boundary: boundary
        },
        center: resolveTrackedVec3(spec, "center", framePos, toVec3(entityProp(spec, "center", [0, 0, 1.1]), [0, 0, 1.1])),
        size: resolveTrackedNumber(spec, "size", framePos, Number(entityProp(spec, "size", 1.6) || 1.6)),
        rotation: resolveTrackedVec3(spec, "rotation", framePos, toVec3(entityProp(spec, "rotation", [0, 0, 0]), [0, 0, 0])),
        transform: resolveTrackedMatrix4(spec, "transform", framePos, toMatrix4(transformFallback, null)),
        face_color: resolveTrackedRgba(spec, "face_color", framePos, toRgba(faceColor, [0.96, 0.22, 0.16, 1.0])),
        texture: resolveTrackedObject(spec, "texture", framePos, entityProp(spec, "texture", null)),
        surface_system: resolveSurfaceSystem(resolveTrackedObject(spec, "surface_system", framePos, entityProp(spec, "surface_system", null)), viewerCamera, seconds),
        casts_shadow: entityProp(spec, "casts_shadow", true) !== false,
        receives_shadow: entityProp(spec, "receives_shadow", true) !== false,
        no_backface_specular: entityProp(spec, "no_backface_specular", false) === true
      };
    }
    if (kind === "convex_hull") {
      if (!spec._vfConvexHullMesh) {
        spec._vfConvexHullMesh = {
          id: String(spec.id || "convex_hull"),
          kind: "convex_hull",
          points: Array.isArray(entityProp(spec, "points", [])) ? entityProp(spec, "points", []).map(function (p) { return toVec3(p, [0, 0, 0]); }) : [],
          face_color: toRgba(faceColor, [0.96, 0.22, 0.16, 1.0]),
          edge_color: toRgba(entityProp(spec, "edge_color", [0.10, 0.82, 0.26, 1.0]), [0.10, 0.82, 0.26, 1.0]),
          edge_width: Math.max(0.0, Number(entityProp(spec, "edge_width", 0.03) || 0.03)),
          edge_caps: entityProp(spec, "edge_caps", true) !== false,
          edge_lift: Math.max(0.0, Number(entityProp(spec, "edge_lift", 0.003) || 0.003)),
          show_edges: entityProp(spec, "show_edges", true) !== false,
          edge_render_mode: String(entityProp(spec, "edge_render_mode", "proxy_geometry")),
          edge_marker_space: String(entityProp(spec, "edge_marker_space", "world")),
          edge_casts_shadow: entityProp(spec, "edge_casts_shadow", true) !== false,
          edge_receives_lighting: entityProp(spec, "edge_receives_lighting", true) !== false,
          edge_depth_write: entityProp(spec, "edge_depth_write", null),
          vertex_color: toRgba(entityProp(spec, "vertex_color", faceColor), [0.96, 0.22, 0.16, 1.0]),
          vertex_size: Math.max(0.0, Number(entityProp(spec, "vertex_size", 0.06) || 0.06)),
          vertex_lift: Math.max(0.0, Number(entityProp(spec, "vertex_lift", 0.006) || 0.006)),
          show_vertices: entityProp(spec, "show_vertices", true) !== false,
          vertex_render_mode: String(entityProp(spec, "vertex_render_mode", "proxy_geometry")),
          vertex_marker_space: String(entityProp(spec, "vertex_marker_space", "world")),
          vertex_casts_shadow: entityProp(spec, "vertex_casts_shadow", true) !== false,
          vertex_receives_lighting: entityProp(spec, "vertex_receives_lighting", true) !== false,
          vertex_depth_write: entityProp(spec, "vertex_depth_write", null),
          _generatedHull: null
        };
      }
      return spec._vfConvexHullMesh;
    }
    if (kind === "random_hull") {
      if (!spec._vfRandomHullMesh) {
        spec._vfRandomHullMesh = {
          id: String(spec.id || "random_hull"),
          kind: "random_hull",
          center: toVec3(entityProp(spec, "center", [0, 0, 1.2]), [0, 0, 1.2]),
          radius: Math.max(0.1, Number(entityProp(spec, "radius", 1.1) || 1.1)),
          count: Math.max(8, Number(entityProp(spec, "count", 100) || 100) | 0),
          seed: Math.max(0, Number(entityProp(spec, "seed", 7) || 7) | 0),
          stretch: toVec3(entityProp(spec, "stretch", [1.0, 0.84, 1.28]), [1.0, 0.84, 1.28]),
          jitter: Math.max(0.0, Number(entityProp(spec, "jitter", 0.28) || 0.28)),
          face_color: toRgba(faceColor, [0.96, 0.22, 0.16, 1.0]),
          edge_color: toRgba(entityProp(spec, "edge_color", [0.10, 0.82, 0.26, 1.0]), [0.10, 0.82, 0.26, 1.0]),
          edge_width: Math.max(0.0, Number(entityProp(spec, "edge_width", 0.03) || 0.03)),
          edge_caps: entityProp(spec, "edge_caps", true) !== false,
          edge_lift: Math.max(0.0, Number(entityProp(spec, "edge_lift", 0.003) || 0.003)),
          show_edges: entityProp(spec, "show_edges", true) !== false,
          edge_render_mode: String(entityProp(spec, "edge_render_mode", "proxy_geometry")),
          edge_marker_space: String(entityProp(spec, "edge_marker_space", "world")),
          edge_casts_shadow: entityProp(spec, "edge_casts_shadow", true) !== false,
          edge_receives_lighting: entityProp(spec, "edge_receives_lighting", true) !== false,
          edge_depth_write: entityProp(spec, "edge_depth_write", null),
          vertex_color: toRgba(entityProp(spec, "vertex_color", faceColor), [0.96, 0.22, 0.16, 1.0]),
          vertex_size: Math.max(0.0, Number(entityProp(spec, "vertex_size", 0.06) || 0.06)),
          vertex_lift: Math.max(0.0, Number(entityProp(spec, "vertex_lift", 0.006) || 0.006)),
          show_vertices: entityProp(spec, "show_vertices", true) !== false,
          vertex_render_mode: String(entityProp(spec, "vertex_render_mode", "proxy_geometry")),
          vertex_marker_space: String(entityProp(spec, "vertex_marker_space", "world")),
          vertex_casts_shadow: entityProp(spec, "vertex_casts_shadow", true) !== false,
          vertex_receives_lighting: entityProp(spec, "vertex_receives_lighting", true) !== false,
          vertex_depth_write: entityProp(spec, "vertex_depth_write", null),
          _generatedHull: null
        };
      }
      return spec._vfRandomHullMesh;
    }
    if (kind === "simplices") {
      if (!spec._vfSimplicesMesh) {
        spec._vfSimplicesMesh = {
          id: String(spec.id || "simplices"),
          kind: "simplices",
          points: Array.isArray(entityProp(spec, "points", [])) ? entityProp(spec, "points", []).map(function (p) { return toVec3(p, [0, 0, 0]); }) : [],
          add_simplices: entityProp(spec, "add_simplices", { edges: [], faces: [], volumes: [] }),
          face_color: toRgba(faceColor, [0.96, 0.22, 0.16, 1.0]),
          edge_color: toRgba(entityProp(spec, "edge_color", [0.10, 0.82, 0.26, 1.0]), [0.10, 0.82, 0.26, 1.0]),
          edge_width: Math.max(0.0, Number(entityProp(spec, "edge_width", 0.03) || 0.03)),
          edge_caps: entityProp(spec, "edge_caps", true) !== false,
          edge_lift: Math.max(0.0, Number(entityProp(spec, "edge_lift", 0.003) || 0.003)),
          show_edges: entityProp(spec, "show_edges", true) !== false,
          edge_render_mode: String(entityProp(spec, "edge_render_mode", "proxy_geometry")),
          edge_marker_space: String(entityProp(spec, "edge_marker_space", "world")),
          edge_casts_shadow: entityProp(spec, "edge_casts_shadow", true) !== false,
          edge_receives_lighting: entityProp(spec, "edge_receives_lighting", true) !== false,
          edge_depth_write: entityProp(spec, "edge_depth_write", null),
          vertex_color: toRgba(entityProp(spec, "vertex_color", faceColor), [0.96, 0.22, 0.16, 1.0]),
          vertex_size: Math.max(0.0, Number(entityProp(spec, "vertex_size", 0.06) || 0.06)),
          vertex_lift: Math.max(0.0, Number(entityProp(spec, "vertex_lift", 0.006) || 0.006)),
          show_vertices: entityProp(spec, "show_vertices", true) !== false,
          vertex_render_mode: String(entityProp(spec, "vertex_render_mode", "proxy_geometry")),
          vertex_marker_space: String(entityProp(spec, "vertex_marker_space", "world")),
          vertex_casts_shadow: entityProp(spec, "vertex_casts_shadow", true) !== false,
          vertex_receives_lighting: entityProp(spec, "vertex_receives_lighting", true) !== false,
          vertex_depth_write: entityProp(spec, "vertex_depth_write", null),
          _generatedSimplices: null
        };
      }
      return spec._vfSimplicesMesh;
    }
    var quadCenterRaw = entityProp(spec, "center", undefined);
    var quadCenter = Array.isArray(quadCenterRaw) && quadCenterRaw.length >= 3
      ? toVec3(quadCenterRaw, [0.0, 0.0, 0.0])
      : (function () {
          var center2 = toVec2(entityProp(spec, "center", [0.0, 0.0]), [0.0, 0.0]);
          return [center2[0], center2[1], Number(entityProp(spec, "z", 0.0) || 0.0)];
        }());
    var quadSurfaceSystem = resolveSurfaceSystem(resolveTrackedObject(spec, "surface_system", framePos, entityProp(spec, "surface_system", null)), viewerCamera, seconds);
    var quadCastsShadowDefault = quadSurfaceSystem ? false : true;
    var quadReverseFacing = entityProp(spec, "reverse_facing", false) === true ||
      (quadSurfaceSystem && quadSurfaceSystem.reverse_facing === true);
    return {
      id: String(spec.id || "plane"),
      kind: "quad",
      object_id: Number(entityProp(spec, "object_id", 0) || 0) || undefined,
      tracks: spec && spec.tracks && typeof spec.tracks === "object" ? spec.tracks : null,
      animation_timing: {
        fps: fps,
        duration_seconds: durationSeconds,
        boundary: boundary
      },
      center: resolveTrackedVec3(spec, "center", framePos, quadCenter),
      size: Array.isArray(entityProp(spec, "size", null))
        ? toVec2(entityProp(spec, "size", [7.0, 7.0]), [7.0, 7.0])
        : Number(entityProp(spec, "size", 7.0) || 7.0),
      rotation: resolveTrackedVec3(spec, "rotation", framePos, toVec3(entityProp(spec, "rotation", [0.0, 0.0, 0.0]), [0.0, 0.0, 0.0])),
        transform: resolveTrackedMatrix4(spec, "transform", framePos, toMatrix4(entityProp(spec, "transform", null), null)),
        color: toRgba(entityProp(spec, "color", [0.20, 0.22, 0.26, 1.0]), [0.20, 0.22, 0.26, 1.0]),
        texture: resolveTrackedObject(spec, "texture", framePos, entityProp(spec, "texture", null)),
        visible: entityProp(spec, "visible", true) !== false,
        surface_system: quadSurfaceSystem,
        casts_shadow: entityProp(spec, "casts_shadow", quadCastsShadowDefault) !== false,
        receives_shadow: entityProp(spec, "receives_shadow", true) !== false,
        no_backface_specular: entityProp(spec, "no_backface_specular", false) === true,
        reverse_facing: quadReverseFacing,
        depth_write: entityProp(spec, "depth_write", null)
      };
  }

  function normalizeShadowReceiverSpec(receiver) {
    var spec = receiver || {};
    return {
      receiver_mesh: String(entityProp(spec, "receiver_mesh", "")),
      occluders: Array.isArray(entityProp(spec, "occluders", [])) ? entityProp(spec, "occluders", []).map(String) : [],
      lights: Array.isArray(entityProp(spec, "lights", [])) ? entityProp(spec, "lights", []).map(String) : [],
      policy_kind: String(entityProp(spec, "policy_kind", "light_camera_depth_map")),
      policy_softness: String(entityProp(spec, "policy_softness", "shadow_map_bias"))
    };
  }

  function buildMeshPayload(mesh, camera, lights) {
    if (mesh.kind === "field_mesh") {
      var renderMode = String(mesh.render_mode || "proxy_geometry");
      var displayTest = global.VfDisplay && global.VfDisplay.__test;
      var canExpandOverlay = displayTest && typeof displayTest.buildSingleMesh === "function";
      var topology = String(mesh.topology || "triangle-list");
      var markerSizingCamera = camera && camera._marker_size_camera ? camera._marker_size_camera : camera;
      var buildCamera = (
        String(renderMode).toLowerCase() === "marker_impostor" &&
        (topology === "point-list" || topology === "line-list")
      ) ? markerSizingCamera : camera;
      if (canExpandOverlay && (topology === "point-list" || topology === "line-list")) {
        var expanded = displayTest.buildSingleMesh({
          type: "field_mesh",
          id: String(mesh.id || "field_mesh"),
          object_id: Number(mesh.object_id || 0) || undefined,
          topology: topology,
          vertices: numericArrayLikeCopy(mesh.vertices),
          indices: numericArrayLikeCopy(mesh.indices),
          color: toRgba(mesh.color, [1.0, 1.0, 1.0, 1.0]),
          alpha: Math.max(0.0, Math.min(1.0, Number(mesh.alpha == null ? 1.0 : mesh.alpha))),
          center: toVec3(mesh.center, [0.0, 0.0, 0.0]),
          scale: toVec3(mesh.scale, [1.0, 1.0, 1.0]),
          rotation: toVec3(mesh.rotation, [0.0, 0.0, 0.0]),
          vertex_size: Math.max(0.0, Number(mesh.vertex_size || 0.0)),
          edge_width: Math.max(0.0, Number(mesh.edge_width || 0.0)),
          vertex_widths: Array.isArray(mesh.vertex_widths) ? mesh.vertex_widths.slice() : [],
          render_mode: renderMode,
          marker_space: String(mesh.marker_space || (String(renderMode).toLowerCase() === "marker_impostor" ? "pixel" : "world")),
          interpolation: mesh.interpolation === true,
          depth_write: mesh.depth_write === true,
          no_cull: mesh.no_cull === true,
          edge_caps: mesh.edge_caps === true,
          vertex_scale: Array.isArray(mesh.vertex_scale) ? mesh.vertex_scale.slice() : mesh.vertex_scale
        }, buildCamera, lights);
        if (expanded && expanded.vertices && expanded.indices) {
          return {
            type: "field_mesh",
            id: String(expanded.id || mesh.id || "field_mesh"),
            object_id: Number(mesh.object_id || 0) || undefined,
            kind: String(mesh.kind || expanded.kind || "field_mesh"),
            topology: String(expanded.topology || "triangle-list"),
            vertices: expanded.vertices instanceof Float32Array
              ? new Float32Array(expanded.vertices)
              : (Array.isArray(expanded.vertices) ? new Float32Array(expanded.vertices) : new Float32Array(Array.prototype.slice.call(expanded.vertices || []))),
            indices: expanded.indices instanceof Uint32Array
              ? new Uint32Array(expanded.indices)
              : (Array.isArray(expanded.indices) ? new Uint32Array(expanded.indices) : new Uint32Array(Array.prototype.slice.call(expanded.indices || []))),
            instances: expanded.instances
              ? (
                  expanded.instances instanceof Float32Array
                    ? new Float32Array(expanded.instances)
                    : (Array.isArray(expanded.instances) ? new Float32Array(expanded.instances) : new Float32Array(Array.prototype.slice.call(expanded.instances)))
                )
              : null,
            instance_count: Math.max(0, Number(expanded.instance_count || 0) | 0),
            instance_kind: expanded.instance_kind || null,
            static_vertices: expanded.static_vertices === true,
            static_indices: expanded.static_indices === true,
            transparent: expanded.transparent === true,
            color: toRgba(mesh.color, [1.0, 1.0, 1.0, 1.0]),
            visible: mesh.visible !== false,
            alpha: Math.max(0.0, Math.min(1.0, Number(mesh.alpha == null ? 1.0 : mesh.alpha))),
            center: Array.isArray(expanded.center) ? expanded.center.slice() : [0.0, 0.0, 0.0],
            scale: Array.isArray(expanded.scale) ? expanded.scale.slice() : [1.0, 1.0, 1.0],
            rotation: Array.isArray(expanded.rotation) ? expanded.rotation.slice() : [0.0, 0.0, 0.0],
            size: Array.isArray(mesh.size) ? mesh.size.slice() : (mesh.size != null ? mesh.size : null),
            time_boundary: String(mesh.time_boundary || "clamp"),
            time_count: Math.max(1, Number(mesh.time_count || 1) | 0),
            time_index: Math.max(0, Number(mesh.time_index || 0) | 0),
            manifold_dim_count: Math.max(0, Number(mesh.manifold_dim_count || 0) | 0),
            solid_volume: mesh.solid_volume === true,
            vertex_size: Math.max(0.0, Number(mesh.vertex_size || 0.0)),
            edge_width: Math.max(0.0, Number(mesh.edge_width || 0.0)),
            vertex_widths: Array.isArray(mesh.vertex_widths) ? mesh.vertex_widths.slice() : [],
            render_mode: renderMode,
            marker_space: String(mesh.marker_space || (String(renderMode).toLowerCase() === "marker_impostor" ? "pixel" : "world")),
            casts_shadow: mesh.casts_shadow !== false,
            receives_shadow: mesh.receives_shadow !== false,
            specular_strength: Math.max(0.0, Math.min(4.0, Number(mesh.specular_strength == null ? 1.0 : mesh.specular_strength))),
            no_backface_specular: mesh.no_backface_specular === true,
            reverse_facing: mesh.reverse_facing === true,
            no_cull: mesh.no_cull === true,
            no_lighting: mesh.no_lighting === true,
            interpolation: mesh.interpolation === true,
            depth_write: mesh.depth_write === true,
            overlay_expanded: expanded.overlay_expanded === true,
            surface_system: mesh.surface_system || null,
            tracks: mesh.tracks || null,
            animation_timing: mesh.animation_timing || null,
            _modelMatrix: Array.isArray(mesh.transform) ? mesh.transform.slice() : (Array.isArray(mesh._modelMatrix) ? mesh._modelMatrix.slice() : null)
          };
        }
      }
      return {
        type: "field_mesh",
        id: String(mesh.id || "field_mesh"),
        object_id: Number(mesh.object_id || 0) || undefined,
        kind: String(mesh.kind || "field_mesh"),
        topology: topology,
        vertices: numericArrayLike(mesh.vertices) ? mesh.vertices : [],
        indices: numericArrayLike(mesh.indices) ? mesh.indices : [],
        static_vertices: true,
        static_indices: true,
        color: toRgba(mesh.color, [1.0, 1.0, 1.0, 1.0]),
        visible: mesh.visible !== false,
        transparent: mesh.transparent === true,
        alpha: Math.max(0.0, Math.min(1.0, Number(mesh.alpha == null ? 1.0 : mesh.alpha))),
        center: toVec3(mesh.center, [0.0, 0.0, 0.0]),
        scale: toVec3(mesh.scale, [1.0, 1.0, 1.0]),
        rotation: toVec3(mesh.rotation, [0.0, 0.0, 0.0]),
        size: Array.isArray(mesh.size) ? mesh.size.slice() : (mesh.size != null ? mesh.size : null),
        time_boundary: String(mesh.time_boundary || "clamp"),
        time_count: Math.max(1, Number(mesh.time_count || 1) | 0),
        time_index: Math.max(0, Number(mesh.time_index || 0) | 0),
        manifold_dim_count: Math.max(0, Number(mesh.manifold_dim_count || 0) | 0),
        solid_volume: mesh.solid_volume === true,
        vertex_size: Math.max(0.0, Number(mesh.vertex_size || 0.0)),
        edge_width: Math.max(0.0, Number(mesh.edge_width || 0.0)),
        vertex_widths: Array.isArray(mesh.vertex_widths) ? mesh.vertex_widths.slice() : [],
        render_mode: renderMode,
        marker_space: String(mesh.marker_space || (String(renderMode).toLowerCase() === "marker_impostor" ? "pixel" : "world")),
        casts_shadow: mesh.casts_shadow !== false,
        receives_shadow: mesh.receives_shadow !== false,
        specular_strength: Math.max(0.0, Math.min(4.0, Number(mesh.specular_strength == null ? 1.0 : mesh.specular_strength))),
        no_backface_specular: mesh.no_backface_specular === true,
        reverse_facing: mesh.reverse_facing === true,
        no_cull: mesh.no_cull === true,
        no_lighting: mesh.no_lighting === true,
        interpolation: mesh.interpolation === true,
        depth_write: mesh.depth_write === true,
        surface_system: mesh.surface_system || null,
        tracks: mesh.tracks || null,
        animation_timing: mesh.animation_timing || null,
        _modelMatrix: Array.isArray(mesh.transform) ? mesh.transform.slice() : (Array.isArray(mesh._modelMatrix) ? mesh._modelMatrix.slice() : null)
      };
    }
    if (mesh.kind === "cube") {
      return cubeMesh(mesh, mesh.face_color);
    }
    if (mesh.kind === "random_hull" || mesh.kind === "convex_hull") {
      return [
        convexHullMesh(mesh, mesh.face_color),
        convexHullEdgeMesh(mesh),
        convexHullVertexMesh(mesh)
      ].filter(Boolean);
    }
    if (mesh.kind === "simplices") {
      return [
        simplicesMesh(mesh, mesh.face_color),
        simplicesEdgeMesh(mesh),
        simplicesVertexMesh(mesh)
      ].filter(Boolean);
    }
    return planeMesh(mesh);
  }

  function buildGlowHaloMesh(light, camera, markerSize) {
    var center = toVec3(light.pos, [0, 0, 0]);
    var camPos = toVec3(camera.pos, [0, 0, 5]);
    var toCamera = normalize3([
      camPos[0] - center[0],
      camPos[1] - center[1],
      camPos[2] - center[2]
    ], [0, 1, 0]);
    var camUp = Array.isArray(camera.up) ? toVec3(camera.up, [0, 0, 1]) : [0, 0, 1];
    var right = normalize3(cross3(camUp, toCamera), [1, 0, 0]);
    var up = normalize3(cross3(toCamera, right), [0, 0, 1]);
    var spotlightBoost = 1.0;
    if (String(light.kind || "point") === "spot") {
      var dir = Array.isArray(light.direction)
        ? normalize3(light.direction, [0, 0, -1])
        : normalize3([
            Number(light.target[0]) - center[0],
            Number(light.target[1]) - center[1],
            Number(light.target[2]) - center[2]
          ], [0, 0, -1]);
      spotlightBoost = Math.max(0.0, (dir[0] * toCamera[0]) + (dir[1] * toCamera[1]) + (dir[2] * toCamera[2]));
    }
    var intensity = Math.max(0.0, Number(light.intensity || 24.0));
    var glowRadius = Math.max(0.10, Number(markerSize || 0.18) * (4.2 + Math.min(5.0, intensity / 40.0)));
    var glowAlpha = Math.min(1.0, 0.42 + (0.42 * spotlightBoost));
    var color = toRgba(light.color, [1.0, 1.0, 1.0, 1.0]);
    var centerColor = [1.0, 1.0, 1.0, glowAlpha];
    var innerColor = [color[0], color[1], color[2], glowAlpha * 0.62];
    var outerColor = [color[0], color[1], color[2], 0.0];
    var segments = 20;
    var innerScale = 0.34;
    var verts = [];
    var indices = [];
    pushVertex(verts, center, toCamera, centerColor);
    for (var i = 0; i < segments; i += 1) {
      var angle = (i / segments) * Math.PI * 2.0;
      var c = Math.cos(angle);
      var s = Math.sin(angle);
      var innerPoint = [
        center[0] + ((right[0] * c) + (up[0] * s)) * glowRadius * innerScale,
        center[1] + ((right[1] * c) + (up[1] * s)) * glowRadius * innerScale,
        center[2] + ((right[2] * c) + (up[2] * s)) * glowRadius * innerScale
      ];
      var outerPoint = [
        center[0] + ((right[0] * c) + (up[0] * s)) * glowRadius,
        center[1] + ((right[1] * c) + (up[1] * s)) * glowRadius,
        center[2] + ((right[2] * c) + (up[2] * s)) * glowRadius
      ];
      pushVertex(verts, innerPoint, toCamera, innerColor);
      pushVertex(verts, outerPoint, toCamera, outerColor);
    }
    for (var j = 0; j < segments; j += 1) {
      var next = (j + 1) % segments;
      var innerA = 1 + (j * 2);
      var outerA = innerA + 1;
      var innerB = 1 + (next * 2);
      var outerB = innerB + 1;
      indices.push(0, innerA, innerB);
      indices.push(innerA, outerA, outerB);
      indices.push(innerA, outerB, innerB);
    }
    return {
      type: "field_mesh",
      id: String("light_glow_" + String(light.id || "light")),
      topology: "triangle-list",
      vertices: verts,
      indices: indices,
      color: color,
      interpolation: true,
      transparent: false,
      blend_mode: "additive",
      depth_write: false
    };
  }

  function buildLightMarkerMeshes(lights, camera, markerSize) {
    var meshes = [];
    var size = Math.max(0.02, Number(markerSize || 0.18));
    for (var i = 0; i < lights.length; i += 1) {
      var light = lights[i];
      if (light.show_marker === false) { continue; }
      meshes.push(buildGlowHaloMesh(light, camera, size));
    }
    return meshes;
  }

  function ensureFlareLayer(frame) {
    if (!frame) { return null; }
    var host = frame.querySelector(".vf-geom-canvas-host") || frame;
    if (!host) { return null; }
    host.style.position = host.style.position || "relative";
    var layer = host.querySelector('[data-vf-light-flare-layer="1"]');
    if (layer) { return layer; }
    layer = document.createElement("div");
    layer.setAttribute("data-vf-light-flare-layer", "1");
    layer.style.position = "absolute";
    layer.style.left = "0";
    layer.style.top = "0";
    layer.style.right = "0";
    layer.style.bottom = "0";
    layer.style.pointerEvents = "none";
    layer.style.overflow = "hidden";
    host.appendChild(layer);
    return layer;
  }

  function ensureFlareElement(layer, key) {
    var selector = '[data-vf-light-flare="' + String(key) + '"]';
    var node = layer.querySelector(selector);
    if (node) { return node; }
    node = document.createElement("div");
    node.setAttribute("data-vf-light-flare", String(key));
    node.style.position = "absolute";
    node.style.borderRadius = "999px";
    node.style.pointerEvents = "none";
    node.style.transform = "translate(-50%, -50%)";
    node.style.mixBlendMode = "plus-lighter";
    node.style.overflow = "visible";
    node.style.willChange = "transform, width, height, opacity, background, box-shadow, filter";
    ensureFlareCanvas(node);
    layer.appendChild(node);
    return node;
  }

  function ensureFlareCanvas(node) {
    var canvas = node.querySelector("canvas[data-vf-flare-canvas='1']");
    if (canvas) { return canvas; }
    canvas = document.createElement("canvas");
    canvas.setAttribute("data-vf-flare-canvas", "1");
    canvas.style.position = "absolute";
    canvas.style.left = "50%";
    canvas.style.top = "50%";
    canvas.style.transform = "translate(-50%, -50%)";
    canvas.style.pointerEvents = "none";
    canvas.style.background = "transparent";
    node.appendChild(canvas);
    return canvas;
  }

  function ensureFlarePart(node, name) {
    var selector = '[data-vf-flare-part="' + String(name) + '"]';
    var part = node.querySelector(selector);
    if (part) { return part; }
    part = document.createElement("div");
    part.setAttribute("data-vf-flare-part", String(name));
    part.style.position = "absolute";
    part.style.left = "50%";
    part.style.top = "50%";
    part.style.transform = "translate(-50%, -50%)";
    part.style.pointerEvents = "none";
    part.style.borderRadius = "999px";
    part.style.backgroundRepeat = "no-repeat";
    part.style.backgroundPosition = "center";
    part.style.backgroundSize = "100% 100%";
    node.appendChild(part);
    return part;
  }

  function drawAnalyticFlareCanvas(canvas, options) {
    if (!canvas) { return; }
    var dpr = Math.max(1, Math.min(2, global.devicePixelRatio || 1));
    var cssSize = Math.max(64, Math.round(Number(options.size || 160)));
    var width = Math.max(64, Math.round(cssSize * dpr));
    var height = width;
    if (canvas.width !== width) { canvas.width = width; }
    if (canvas.height !== height) { canvas.height = height; }
    canvas.style.width = cssSize + "px";
    canvas.style.height = cssSize + "px";
    var ctx = canvas.getContext("2d");
    if (!ctx) { return; }
    var image = ctx.createImageData(width, height);
    var data = image.data;
    var cx = width * 0.5;
    var cy = height * 0.5;
    var flareAlpha = clamp01(options.flareAlpha);
    var facing = clamp01(options.facing);
    var edgeFade = clamp01(options.edgeFade);
    var baseAngle = Number(options.axisAngle || 0.0);
    var tint = options.color || [1, 1, 1, 1];
    var cr = Number(tint[0] || 1.0);
    var cg = Number(tint[1] || 1.0);
    var cb = Number(tint[2] || 1.0);

    var sigmaGlow = cssSize * 0.18 * dpr;
    var sigmaCore = Math.max(1.2, cssSize * 0.022 * dpr);
    var ring1 = cssSize * 0.16 * dpr;
    var ring2 = cssSize * 0.28 * dpr;
    var ring3 = cssSize * 0.42 * dpr;
    var ringW1 = Math.max(1.8, cssSize * 0.028 * dpr);
    var ringW2 = Math.max(2.4, cssSize * 0.040 * dpr);
    var ringW3 = Math.max(3.2, cssSize * 0.052 * dpr);

    var rays = [
      { angle: baseAngle + (Math.PI * 0.5), sigmaU: 50 * dpr, gammaV: 1.7 * dpr, amp: 1.00 },
      { angle: baseAngle, sigmaU: 34 * dpr, gammaV: 1.9 * dpr, amp: 0.68 },
      { angle: baseAngle + (Math.PI * 0.25), sigmaU: 22 * dpr, gammaV: 2.1 * dpr, amp: 0.34 },
      { angle: baseAngle + (Math.PI * 0.75), sigmaU: 16 * dpr, gammaV: 2.2 * dpr, amp: 0.18 }
    ];

    function gaussian(x, sigma) {
      return Math.exp(-0.5 * (x * x) / Math.max(1e-6, sigma * sigma));
    }

    function lorentzian(x, gamma) {
      var ratio = x / Math.max(1e-6, gamma);
      return 1.0 / (1.0 + (ratio * ratio));
    }

    function addRgb(px, py, r, g, b, a) {
      if (!(a > 0.0)) { return; }
      var ix = ((py * width) + px) * 4;
      data[ix] = Math.min(255, data[ix] + Math.round(r * 255.0 * a));
      data[ix + 1] = Math.min(255, data[ix + 1] + Math.round(g * 255.0 * a));
      data[ix + 2] = Math.min(255, data[ix + 2] + Math.round(b * 255.0 * a));
      data[ix + 3] = Math.min(255, data[ix + 3] + Math.round(255.0 * a));
    }

    var globalScale = flareAlpha * edgeFade;
    for (var py = 0; py < height; py += 1) {
      var dy = py - cy;
      for (var px = 0; px < width; px += 1) {
        var dx = px - cx;
        var r = Math.sqrt((dx * dx) + (dy * dy));

        var core = 1.30 * gaussian(r, sigmaCore);
        var glow = 0.26 * gaussian(r, sigmaGlow);
        var rings =
          0.060 * gaussian(r - ring1, ringW1) +
          0.038 * gaussian(r - ring2, ringW2) +
          0.018 * gaussian(r - ring3, ringW3);

        var rayAccum = 0.0;
        for (var ri = 0; ri < rays.length; ri += 1) {
          var ray = rays[ri];
          var c = Math.cos(ray.angle);
          var s = Math.sin(ray.angle);
          var u = (dx * c) + (dy * s);
          var v = (-dx * s) + (dy * c);
          rayAccum += ray.amp * gaussian(u, ray.sigmaU) * lorentzian(v, ray.gammaV);
        }

        var whiteA = globalScale * (core + glow + (0.72 * rayAccum));
        var tintA = globalScale * ((0.65 * glow) + (0.35 * rings) + (0.28 * rayAccum));
        addRgb(px, py, 1.0, 1.0, 1.0, whiteA);
        addRgb(px, py, cr, cg, cb, tintA);
      }
    }

    ctx.clearRect(0, 0, width, height);
    ctx.putImageData(image, 0, 0);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    var ghostAlpha = 0.20 * globalScale * (0.4 + 0.6 * facing);
    if (ghostAlpha > 0.001) {
      var gx1 = cx - ((options.ghostDx1 || 0.0) * dpr);
      var gy1 = cy - ((options.ghostDy1 || 0.0) * dpr);
      var gx2 = cx - ((options.ghostDx2 || 0.0) * dpr);
      var gy2 = cy - ((options.ghostDy2 || 0.0) * dpr);
      var g1 = ctx.createRadialGradient(gx1, gy1, 0, gx1, gy1, cssSize * 0.05 * dpr);
      g1.addColorStop(0, "rgba(255,255,255," + (0.75 * ghostAlpha).toFixed(4) + ")");
      g1.addColorStop(0.45, "rgba(" + Math.round(cr * 255) + "," + Math.round(cg * 255) + "," + Math.round(cb * 255) + "," + ghostAlpha.toFixed(4) + ")");
      g1.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g1;
      ctx.beginPath();
      ctx.arc(gx1, gy1, cssSize * 0.05 * dpr, 0, Math.PI * 2);
      ctx.fill();

      var g2 = ctx.createRadialGradient(gx2, gy2, 0, gx2, gy2, cssSize * 0.03 * dpr);
      g2.addColorStop(0, "rgba(255,255,255," + (0.55 * ghostAlpha).toFixed(4) + ")");
      g2.addColorStop(0.5, "rgba(" + Math.round(cr * 255) + "," + Math.round(cg * 255) + "," + Math.round(cb * 255) + "," + (0.72 * ghostAlpha).toFixed(4) + ")");
      g2.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.arc(gx2, gy2, cssSize * 0.03 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function projectPointToScreen(camera, point, width, height) {
    if (camera && Array.isArray(camera.view_matrix) && camera.view_matrix.length === 16 && Array.isArray(camera.projection_matrix) && camera.projection_matrix.length === 16) {
      var viewPoint = transformPointMat4(camera.view_matrix, Number(point[0] || 0), Number(point[1] || 0), Number(point[2] || 0));
      var vx = Number(viewPoint[0] || 0);
      var vy = Number(viewPoint[1] || 0);
      var vz = Number(viewPoint[2] || 0);
      var proj = camera.projection_matrix;
      var clipX = (Number(proj[0]) * vx) + (Number(proj[4]) * vy) + (Number(proj[8]) * vz) + Number(proj[12] || 0);
      var clipY = (Number(proj[1]) * vx) + (Number(proj[5]) * vy) + (Number(proj[9]) * vz) + Number(proj[13] || 0);
      var clipW = (Number(proj[3]) * vx) + (Number(proj[7]) * vy) + (Number(proj[11]) * vz) + Number(proj[15] || 0);
      if (!(Math.abs(clipW) > 1e-6)) { return null; }
      var ndcX = clipX / clipW;
      var ndcY = clipY / clipW;
      if (ndcX < -1.02 || ndcX > 1.02 || ndcY < -1.02 || ndcY > 1.02) {
        return null;
      }
      return {
        x: ((ndcX * 0.5) + 0.5) * width,
        y: ((-ndcY * 0.5) + 0.5) * height,
        depth: Math.max(1e-3, Math.abs(vz)),
        ndcX: ndcX,
        ndcY: ndcY
      };
    }
    var eye = toVec3(camera.pos, [0, 0, 5]);
    var target = toVec3(camera.target, [0, 0, 0]);
    var up = toVec3(camera.up, [0, 0, 1]);
    var forward = normalize3([
      target[0] - eye[0],
      target[1] - eye[1],
      target[2] - eye[2]
    ], [0, 1, 0]);
    var right = normalize3(cross3(forward, up), [1, 0, 0]);
    var trueUp = normalize3(cross3(right, forward), [0, 0, 1]);
    var rel = [
      Number(point[0]) - eye[0],
      Number(point[1]) - eye[1],
      Number(point[2]) - eye[2]
    ];
    var viewX = dot3(rel, right);
    var viewY = dot3(rel, trueUp);
    var viewZ = dot3(rel, forward);
    if (!(viewZ > 1e-4)) { return null; }
    var aspect = Math.max(1e-4, width / Math.max(height, 1));
    var tanHalf = Math.tan((Number(camera.fov || 40.0) * Math.PI / 180.0) * 0.5);
    var ndcX = viewX / (viewZ * tanHalf * aspect);
    var ndcY = viewY / (viewZ * tanHalf);
    if (ndcX < -1.02 || ndcX > 1.02 || ndcY < -1.02 || ndcY > 1.02) {
      return null;
    }
    return {
      x: ((ndcX * 0.5) + 0.5) * width,
      y: ((-ndcY * 0.5) + 0.5) * height,
      depth: viewZ,
      ndcX: ndcX,
      ndcY: ndcY
    };
  }

  function segmentIntersectsAabb(start, end, min, max) {
    var dir = [
      Number(end[0]) - Number(start[0]),
      Number(end[1]) - Number(start[1]),
      Number(end[2]) - Number(start[2])
    ];
    var tMin = 0.0;
    var tMax = 1.0;
    for (var axis = 0; axis < 3; axis += 1) {
      var s = Number(start[axis]);
      var d = Number(dir[axis]);
      var lo = Number(min[axis]);
      var hi = Number(max[axis]);
      if (Math.abs(d) < 1e-8) {
        if (s < lo || s > hi) { return false; }
        continue;
      }
      var invD = 1.0 / d;
      var t0 = (lo - s) * invD;
      var t1 = (hi - s) * invD;
      if (t0 > t1) {
        var tmp = t0;
        t0 = t1;
        t1 = tmp;
      }
      tMin = Math.max(tMin, t0);
      tMax = Math.min(tMax, t1);
      if (tMax < tMin) { return false; }
    }
    return tMax > 1e-4 && tMin < (1.0 - 1e-4);
  }

  function lightOccludedByMeshes(camera, light, occluders) {
    var eye = toVec3(camera.pos, [0, 0, 0]);
    var lightPos = toVec3(light.pos, [0, 0, 0]);
    var items = Array.isArray(occluders) ? occluders : [];
    for (var i = 0; i < items.length; i += 1) {
      var mesh = items[i];
      var vertices = meshVerticesForOccluder(mesh);
      if (!vertices.length) { continue; }
      var bounds = computeBounds(vertices);
      var min = bounds.min;
      var max = bounds.max;
      if (segmentIntersectsAabb(eye, lightPos, min, max)) {
        return true;
      }
    }
    return false;
  }

  function lightFacingCamera(light, camera) {
    var pos = toVec3(light.pos, [0, 0, 0]);
    var toCamera = normalize3([
      Number(camera.pos[0]) - pos[0],
      Number(camera.pos[1]) - pos[1],
      Number(camera.pos[2]) - pos[2]
    ], [0, -1, 0]);
    if (String(light.kind || "point") !== "spot") {
      return 1.0;
    }
    var beamDir = Array.isArray(light.direction)
      ? normalize3(light.direction, [0, 1, 0])
      : normalize3([
          Number(light.target[0]) - pos[0],
          Number(light.target[1]) - pos[1],
          Number(light.target[2]) - pos[2]
        ], [0, 1, 0]);
    return clamp01(dot3(beamDir, toCamera));
  }

  function updateLightFlares(frame, camera, lights, occluders) {
    var layer = ensureFlareLayer(frame);
    if (!layer) { return; }
    var host = layer.parentElement || frame;
    var width = Math.max(1, host.clientWidth || 0);
    var height = Math.max(1, host.clientHeight || 0);
    var active = Object.create(null);
    for (var i = 0; i < lights.length; i += 1) {
      var light = lights[i];
      if (light.show_marker === false) { continue; }
      var projected = projectPointToScreen(camera, light.pos, width, height);
      if (!projected) { continue; }
      if (lightOccludedByMeshes(camera, light, occluders)) { continue; }
      var facing = lightFacingCamera(light, camera);
      var intensity = Math.max(0.0, Number(light.intensity || 24.0));
      var baseAlpha = Math.min(1.0, 0.30 + Math.min(0.70, intensity / 170.0));
      var flareAlpha = clamp01(baseAlpha * (0.30 + (0.70 * facing)));
      var size = Math.max(92, 120 + (intensity * 0.72) + (120 * facing));
      var node = ensureFlareElement(layer, i);
      var canvas = ensureFlareCanvas(node);
      var color = toRgba(light.color, [1.0, 1.0, 1.0, 1.0]);
      var cr = Math.round(color[0] * 255);
      var cg = Math.round(color[1] * 255);
      var cb = Math.round(color[2] * 255);
      var coreAlpha = clamp01(1.00 * flareAlpha);
      var innerAlpha = clamp01(0.78 * flareAlpha);
      var haloAlpha = clamp01(0.28 * flareAlpha);
      var streakAlpha = clamp01((0.28 + 0.62 * facing) * flareAlpha);
      var centerX = width * 0.5;
      var centerY = height * 0.5;
      var dx = projected.x - centerX;
      var dy = projected.y - centerY;
      var ghostAX = centerX - (dx * 0.42);
      var ghostAY = centerY - (dy * 0.42);
      var ghostBX = centerX - (dx * 0.78);
      var ghostBY = centerY - (dy * 0.78);
      var axisAngle = Math.atan2(dy, dx);
      node.style.display = "block";
      node.style.left = projected.x + "px";
      node.style.top = projected.y + "px";
      node.style.width = size + "px";
      node.style.height = size + "px";
      node.style.opacity = "1";
      node.style.filter = "none";
      node.style.background = "transparent";
      node.style.boxShadow = "none";
      drawAnalyticFlareCanvas(canvas, {
        size: Math.round(size * 1.8),
        flareAlpha: flareAlpha,
        facing: facing,
        edgeFade: 1.0,
        axisAngle: axisAngle,
        color: color,
        ghostDx1: dx * 0.42,
        ghostDy1: dy * 0.42,
        ghostDx2: dx * 0.78,
        ghostDy2: dy * 0.78
      });
      active[String(i)] = true;
    }
    var children = layer.querySelectorAll("[data-vf-light-flare]");
    for (var j = 0; j < children.length; j += 1) {
      var key = children[j].getAttribute("data-vf-light-flare") || "";
      if (!active[key]) {
        children[j].style.display = "none";
      }
    }
  }

  function buildSceneState(cameraOverride, seconds) {
    var camera = cameraOverride || makeCamera(config.camera || {}, { pos: [3.9, -5.6, 3.2], target: [0, 0, 0.9], fov: 34, up: [0, 0, 1], min_distance: 0.0 }, seconds);
    var lightSpecs = Array.isArray(config.lights)
      ? config.lights
      : (config.light ? [config.light] : []);
    var rawMeshSpecs = Array.isArray(config.meshes) ? config.meshes.slice() : [];
    var chessCfg = chessInteractionConfig();
    var chessRuntime = global.__vfNativeChessRuntime || null;
    if (chessCfg) {
      assertChessHitRegionContract(chessCfg);
      rawMeshSpecs = rawMeshSpecs.map(function (mesh) {
        if (isChessSquareSourceMesh(mesh, chessCfg)) {
          suppressChessSquareVisualMesh(mesh);
          return attachChessSquareVisualState(mesh, chessRuntime);
        }
        return attachChessBoardHighlights(mesh, chessRuntime);
      });
    }
    rawMeshSpecs = syncChessRuntimePiecesIntoMeshes(rawMeshSpecs);
    if (frameSpec.visible === false) {
      rawMeshSpecs = rawMeshSpecs.filter(function (mesh) {
        return entityProp(mesh, "visible", true) !== false;
      });
    }
    var meshSpecs = rawMeshSpecs.map(function (mesh) { return normalizeMeshSpec(mesh, seconds, camera); });
    var receivers = Array.isArray(config.shadow_receivers) ? config.shadow_receivers.map(normalizeShadowReceiverSpec) : [];
    var meshById = Object.create(null);
    for (var meshIndex = 0; meshIndex < meshSpecs.length; meshIndex += 1) {
      meshById[meshSpecs[meshIndex].id] = meshSpecs[meshIndex];
    }
    var lights = lightSpecs.map(function (entry) { return normalizeLight(entry, seconds); });
    for (var mirrorIndex = 0; mirrorIndex < meshSpecs.length; mirrorIndex += 1) {
      var mirrorMesh = meshSpecs[mirrorIndex];
      var surfaceSystem = mirrorMesh && mirrorMesh.surface_system && typeof mirrorMesh.surface_system === "object"
        ? mirrorMesh.surface_system
        : null;
      if (!surfaceSystem) {
        continue;
      }
      var surfaceKind = String(surfaceSystem.kind || "").toLowerCase().trim();
      if (surfaceKind === "mirror") {
        if (!surfaceSystem.world || typeof surfaceSystem.world !== "object") {
          surfaceSystem.world = {};
        }
        surfaceSystem.world.objects = buildSurfaceWorldObjects(meshSpecs, mirrorMesh.id);
      }
    }
    var meshes = [];
    var receiverIds = Object.create(null);
    for (var receiverIndex = 0; receiverIndex < receivers.length; receiverIndex += 1) {
      var receiver = receivers[receiverIndex] || {};
      var receiverMesh = meshById[String(receiver.receiver_mesh || "")];
      if (!receiverMesh || receiverMesh.kind !== "quad" || receiverMesh.visible === false) {
        continue;
      }
      receiverIds[receiverMesh.id] = true;
      var lightIds = Array.isArray(receiver.lights) ? receiver.lights.map(String) : [];
      void lightIds;
      var receiverPayload = buildMeshPayload(receiverMesh, camera, lights);
      if (Array.isArray(receiverPayload)) {
        for (var receiverPayloadIndex = 0; receiverPayloadIndex < receiverPayload.length; receiverPayloadIndex += 1) {
          if (receiverPayload[receiverPayloadIndex]) { meshes.push(receiverPayload[receiverPayloadIndex]); }
        }
      } else if (receiverPayload) {
        meshes.push(receiverPayload);
      }
    }
    for (var i = 0; i < meshSpecs.length; i += 1) {
      var mesh = meshSpecs[i];
      if (mesh.visible === false) { continue; }
      if (receiverIds[mesh.id]) { continue; }
      var meshPayload = buildMeshPayload(mesh, camera, lights);
      if (Array.isArray(meshPayload)) {
        for (var meshPayloadIndex = 0; meshPayloadIndex < meshPayload.length; meshPayloadIndex += 1) {
          if (meshPayload[meshPayloadIndex]) { meshes.push(meshPayload[meshPayloadIndex]); }
        }
      } else if (meshPayload) {
        meshes.push(meshPayload);
      }
    }
    if (renderOptions.show_light_markers === true) {
      var markerMeshes = buildLightMarkerMeshes(lights, camera, renderOptions.light_marker_size);
      for (var markerIndex = 0; markerIndex < markerMeshes.length; markerIndex += 1) {
        meshes.push(markerMeshes[markerIndex]);
      }
    }
    return {
      camera: camera,
      lights: lights,
      meshes: meshes,
      flare_occluders: meshSpecs.filter(function (mesh) { return mesh.kind === "cube" || mesh.kind === "random_hull" || mesh.kind === "convex_hull" || mesh.kind === "simplices"; })
    };
  }

  function renderPayload(cameraOverride, seconds, options) {
    if (!options || options.skipChessInteraction !== true) {
      applyChessInteractionFrame(seconds);
    }
    var state = buildSceneState(cameraOverride, seconds);
    if (!state.meshes || !state.meshes.length) {
      failFast("scene resolved zero visible meshes");
    }
    var sceneBackground = resolveSceneBackgroundFallback();
    var hitRegions = declaredSceneHitRegions();
    if (chessInteractionConfig() && !hitRegions.length) {
      failFast("chess interaction requires declared hit_regions in geom payload");
    }
    var chessRuntime = global.__vfNativeChessRuntime || null;
    var promotionActive = !!(
      chessRuntime &&
      (chessRuntime.promotion || (Array.isArray(chessRuntime.promotionOptions) && chessRuntime.promotionOptions.length > 0))
    );
    if (!global.__vfGeomPickContext) { global.__vfGeomPickContext = Object.create(null); }
    global.__vfGeomPickContext[String(frameSpec.frame_id || config.frame_id)] = {
      promotion_active: promotionActive
    };
    if (promotionActive) {
      for (var hitRegionIndex = 0; hitRegionIndex < hitRegions.length; hitRegionIndex += 1) {
        if (hitRegions[hitRegionIndex] && typeof hitRegions[hitRegionIndex] === "object") {
          hitRegions[hitRegionIndex].pick_passthrough_when = "promotion_active";
        }
      }
    }
    var geom = {};
    geom[String(frameSpec.frame_id || config.frame_id)] = {
      meshes: state.meshes,
      camera: state.camera,
      lights: state.lights,
      background: sceneBackground,
      light_flares: {
        enabled: renderOptions.light_flares === true,
        size: Number(renderOptions.light_marker_size || 0.18),
        lights: state.lights,
        occluders: state.flare_occluders
      },
      hit_regions: hitRegions,
      pick_context: {
        promotion_active: promotionActive
      },
      unified_renderer: true
    };
    return { payload: { screen: [], frames: {}, geom: geom }, state: state };
  }

  function chessInteractionConfig() {
    var cfg = rootConfig && rootConfig.interaction ? rootConfig.interaction : (config && config.interaction ? config.interaction : null);
    return cfg && String(cfg.kind || "") === "chess_board" ? cfg : null;
  }

  function declaredSceneHitRegions() {
    if (rootConfig && Array.isArray(rootConfig.hit_regions)) { return cloneJsonValue(rootConfig.hit_regions); }
    if (config && Array.isArray(config.hit_regions)) { return cloneJsonValue(config.hit_regions); }
    var interaction = rootConfig && rootConfig.interaction ? rootConfig.interaction : (config && config.interaction ? config.interaction : null);
    if (interaction && Array.isArray(interaction.hit_regions)) { return cloneJsonValue(interaction.hit_regions); }
    return [];
  }

  function setEntityProp(entity, name, value) {
    if (!entity || typeof entity !== "object") { return; }
    var props = entity.properties && typeof entity.properties === "object" ? entity.properties : entity;
    var embedding = entity.embedding && typeof entity.embedding === "object" ? entity.embedding : {};
    props[String(embedding[name] || name)] = value;
  }

  function markChessSceneDirty(runtime) {
    if (!runtime) { return; }
    runtime.sceneDirtyVersion = (Number(runtime.sceneDirtyVersion || 0) || 0) + 1;
    if (typeof runtime.requestInteractionFrame === "function") {
      runtime.requestInteractionFrame();
    }
  }

  function updateChessBoardHighlightsFast(runtime) {
    if (
      !runtime ||
      !global.VfDisplay ||
      typeof global.VfDisplay.updateDynamicGeomFrameSurfaceSystem !== "function"
    ) {
      return false;
    }
    var updated = global.VfDisplay.updateDynamicGeomFrameSurfaceSystem(
      runtime.frameId,
      "board_reflection_overlay",
      { square_highlights: chessSquareHighlightColors(runtime) }
    ) === true;
    if (!updated && runtime.selected && runtime.hoverSquare) {
      failFast("chess square hover highlight patch failed for board_reflection_overlay");
    }
    return updated;
  }

  function syncChessRuntimePiecesIntoMeshes(rawMeshSpecs) {
    var runtime = global.__vfNativeChessRuntime || null;
    if (!runtime || !runtime.piecesByObjectId || !Array.isArray(rawMeshSpecs)) { return rawMeshSpecs; }
    var seenObjectIds = Object.create(null);
    for (var i = 0; i < rawMeshSpecs.length; i += 1) {
      var mesh = rawMeshSpecs[i];
      var objectId = Number(entityProp(mesh, "object_id", 0) || 0) || 0;
      if (objectId) { seenObjectIds[String(objectId)] = true; }
      var piece = runtime.piecesByObjectId[String(objectId)] || null;
      if (!piece || !piece.mesh) { continue; }
      setEntityProp(mesh, "center", cloneEntityStateValue(entityProp(piece.mesh, "center", pieceBoardCenter(piece, 0.0))));
      setEntityProp(mesh, "rotation", cloneEntityStateValue(entityProp(piece.mesh, "rotation", piece.start_rotation || [0.0, 0.0, 0.0])));
      setEntityProp(mesh, "transform", cloneEntityStateValue(entityProp(piece.mesh, "transform", null)));
      mesh._modelMatrix = null;
      setEntityProp(mesh, "visible", (piece.captured !== true || piece.in_capture_tray === true) && entityProp(piece.mesh, "visible", true) !== false);
      setEntityProp(mesh, "color", cloneEntityStateValue(entityProp(piece.mesh, "color", pieceBaseColor(piece))));
      setEntityProp(mesh, "specular_strength", Number(entityProp(piece.mesh, "specular_strength", runtime.cfg.piece_specular_strength || 0.055)) || 0.055);
      setEntityProp(mesh, "receives_shadow", entityProp(piece.mesh, "receives_shadow", true) !== false);
    }
    var options = Array.isArray(runtime.promotionOptions) ? runtime.promotionOptions : [];
    for (var optionIndex = 0; optionIndex < options.length; optionIndex += 1) {
      var option = options[optionIndex];
      if (!option || !option.mesh) { continue; }
      var optionObjectId = Number(option.object_id || entityProp(option.mesh, "object_id", 0) || 0) || 0;
      if (optionObjectId && seenObjectIds[String(optionObjectId)] === true) { continue; }
      rawMeshSpecs.push(option.mesh);
      if (optionObjectId) { seenObjectIds[String(optionObjectId)] = true; }
    }
    return rawMeshSpecs;
  }

  function currentChessSceneDirtyVersion() {
    var runtime = global.__vfNativeChessRuntime || null;
    return runtime ? (Number(runtime.sceneDirtyVersion || 0) || 0) : 0;
  }

  function currentSceneWorldDirtyVersion() {
    return currentChessSceneDirtyVersion();
  }

  function chessAnimationsPending() {
    var runtime = global.__vfNativeChessRuntime || null;
    return !!(runtime && ((Array.isArray(runtime.animations) && runtime.animations.length > 0) || runtime.endSequence));
  }

  function sceneWorldAnimationsPending() {
    return chessAnimationsPending();
  }

  function applySceneWorldFrame(seconds) {
    return applyChessInteractionFrame(seconds);
  }

  function chessMeshStructureSignature() {
    var runtime = global.__vfNativeChessRuntime || null;
    var promotionIds = runtime && Array.isArray(runtime.promotionOptions)
      ? runtime.promotionOptions.map(function (option) { return Number(option && option.object_id || 0) || 0; }).sort(function (a, b) { return a - b; }).join(",")
      : "";
    return String(Array.isArray(config.meshes) ? config.meshes.length : 0) + "|" + promotionIds;
  }

  function sceneWorldMeshStructureSignature() {
    return chessMeshStructureSignature();
  }

  function truncateChessFuture(runtime) {
    if (!runtime) { return; }
    var currentIndex = Math.max(0, Number(runtime.currentMoveIndex || 0) || 0);
    if (Array.isArray(runtime.moves) && currentIndex < runtime.moves.length) {
      runtime.moves = runtime.moves.slice(0, currentIndex);
    }
    if (Array.isArray(runtime.historySnapshots) && currentIndex + 1 < runtime.historySnapshots.length) {
      runtime.historySnapshots = runtime.historySnapshots.slice(0, currentIndex + 1);
    }
    rebuildChessPositionCounts(runtime);
  }

  function chessSnapshot(runtime) {
    var pieces = [];
    var ids = runtime && runtime.piecesByObjectId ? Object.keys(runtime.piecesByObjectId) : [];
    ids.sort(function (a, b) { return (Number(a) || 0) - (Number(b) || 0); });
    for (var i = 0; i < ids.length; i += 1) {
      var piece = runtime.piecesByObjectId[ids[i]];
      if (!piece) { continue; }
      pieces.push({
        object_id: piece.object_id,
        side: piece.side,
        role: piece.role,
        file: piece.file,
        rank: piece.rank,
        captured: piece.captured === true,
        captured_by: String(piece.captured_by || ""),
        in_capture_tray: piece.in_capture_tray === true,
        capture_order: Number(piece.capture_order || 0) || 0,
        capture_tray_index: Number(piece.capture_tray_index || -1),
        has_moved: piece.has_moved === true
      });
    }
    return {
      turn: String(runtime && runtime.turn || "white"),
      endResult: String(runtime && (runtime.pendingEndResult || runtime.gameOver) || ""),
      halfmoveClock: Number(runtime && runtime.halfmoveClock || 0) || 0,
      positionKey: runtime ? chessPositionKey(runtime) : "",
      lastDoublePawn: runtime && runtime.lastDoublePawn ? {
        side: String(runtime.lastDoublePawn.side || ""),
        file: Number(runtime.lastDoublePawn.file || 0) || 0,
        rank: Number(runtime.lastDoublePawn.rank || 0) || 0
      } : null,
      pieces: pieces
    };
  }

  function restoreChessSnapshot(runtime, snapshot, moveIndex) {
    if (!runtime || !snapshot || !Array.isArray(snapshot.pieces)) { return false; }
    runtime.animations = [];
    runtime.selected = null;
    runtime.hoverSquare = null;
    runtime.hoverPiece = null;
    runtime.hoverPromotion = null;
    runtime.promotion = null;
    runtime.gameOver = null;
    runtime.pendingEndResult = String(snapshot.endResult || "");
    runtime.halfmoveClock = Number(snapshot.halfmoveClock || 0) || 0;
    runtime.pendingEndPieceObjectId = 0;
    runtime.endSequence = null;
    runtime.animations = [];
    clearChessPromotionOptions(runtime);
    var maxCaptureOrder = 0;
    for (var i = 0; i < snapshot.pieces.length; i += 1) {
      var saved = snapshot.pieces[i];
      var piece = runtime.piecesByObjectId[String(saved.object_id)] || null;
      if (!piece) { continue; }
      if (piece.start_mesh && piece.mesh !== piece.start_mesh) {
        removeMeshFromScene(piece.mesh);
        if (Array.isArray(config.meshes) && config.meshes.indexOf(piece.start_mesh) < 0) {
          config.meshes.push(piece.start_mesh);
        }
        piece.mesh = piece.start_mesh;
      }
      runtime.meshByObjectId[String(piece.object_id)] = piece.mesh;
      piece.role = String(saved.role || piece.start_role || "pawn");
      replaceChessPieceRoleMesh(runtime, piece, piece.role);
      piece.file = Number(saved.file || 0) || 0;
      piece.rank = Number(saved.rank || 0) || 0;
      piece.captured = saved.captured === true;
      piece.captured_by = String(saved.captured_by || "");
      piece.in_capture_tray = saved.in_capture_tray === true;
      piece.capture_order = Number(saved.capture_order || 0) || 0;
      maxCaptureOrder = Math.max(maxCaptureOrder, Number(piece.capture_order || 0) || 0);
      piece.capture_tray_index = Number(saved.capture_tray_index || -1);
      piece.capture_tray_center = null;
      piece.has_moved = saved.has_moved === true;
      piece._animating = false;
      setEntityProp(piece.mesh, "center", piece.in_capture_tray
        ? chessCapturedTrayCenter(runtime, piece, Math.max(0, Number(piece.capture_tray_index || 0) || 0))
        : pieceBoardCenter(piece, 0.0));
      piece.mesh._modelMatrix = null;
      setEntityProp(piece.mesh, "transform", null);
      setEntityProp(piece.mesh, "rotation", cloneJsonValue(piece.start_rotation || entityProp(piece.start_mesh || piece.mesh, "rotation", [0.0, 0.0, 0.0])));
      setEntityProp(piece.mesh, "visible", piece.captured !== true || piece.in_capture_tray === true);
      setEntityProp(piece.mesh, "color", pieceBaseColor(piece));
      setEntityProp(piece.mesh, "specular_strength", Number(runtime.cfg.piece_specular_strength || 0.055) || 0.055);
      setEntityProp(piece.mesh, "receives_shadow", true);
    }
    runtime.nextCaptureOrder = maxCaptureOrder;
    runtime.lastDoublePawn = snapshot.lastDoublePawn && typeof snapshot.lastDoublePawn === "object" ? {
      side: String(snapshot.lastDoublePawn.side || ""),
      file: Number(snapshot.lastDoublePawn.file || 0) || 0,
      rank: Number(snapshot.lastDoublePawn.rank || 0) || 0
    } : null;
    var capturers = ["white", "black"];
    for (var sideIndex = 0; sideIndex < capturers.length; sideIndex += 1) {
      var capturedForSide = assignChessCapturedTraySlots(runtime, capturers[sideIndex]);
      for (var capturedIndex = 0; capturedIndex < capturedForSide.length; capturedIndex += 1) {
        var trayPiece = capturedForSide[capturedIndex];
        if (trayPiece && trayPiece.mesh) {
          setEntityProp(trayPiece.mesh, "center", chessCapturedTrayCenter(runtime, trayPiece, capturedIndex));
          setEntityProp(trayPiece.mesh, "visible", true);
        }
      }
    }
    runtime.turn = String(snapshot.turn || "white");
    runtime.currentMoveIndex = Math.max(0, Number(moveIndex || 0) || 0);
    rebuildChessOccupancy(runtime);
    rebuildChessPositionCounts(runtime);
    resetChessHighlights(runtime);
    refreshChessPieceSelectionPose(runtime);
    updateChessPanel(runtime);
    markChessSceneDirty(runtime);
    requestChessInteractionFrame(runtime);
    return true;
  }

  function recordChessHistorySnapshot(runtime) {
    if (!runtime) { return; }
    var index = Math.max(0, Number(runtime.currentMoveIndex || 0) || 0);
    runtime.historySnapshots = Array.isArray(runtime.historySnapshots) ? runtime.historySnapshots : [];
    runtime.historySnapshots[index] = chessSnapshot(runtime);
    runtime.historySnapshots = runtime.historySnapshots.slice(0, index + 1);
  }

  function restoreChessHistory(runtime, moveIndex) {
    if (!runtime || runtime.promotion) { return false; }
    var index = Math.max(0, Number(moveIndex || 0) || 0);
    if (!Array.isArray(runtime.historySnapshots) || !runtime.historySnapshots[index]) { return false; }
    return restoreChessSnapshot(runtime, runtime.historySnapshots[index], index);
  }

  function commitChessMove(runtime, notation) {
    truncateChessFuture(runtime);
    runtime.moves.push(String(notation || ""));
    runtime.currentMoveIndex = runtime.moves.length;
    runtime.pendingAutoSwitchAfterAnimations = runtime.autoSwitchView === true;
  }

  function chessCastleRightsKey(runtime) {
    var whiteKing = chessPieceAt(runtime, 5, 1);
    var blackKing = chessPieceAt(runtime, 5, 8);
    var whiteKingRook = chessPieceAt(runtime, 8, 1);
    var whiteQueenRook = chessPieceAt(runtime, 1, 1);
    var blackKingRook = chessPieceAt(runtime, 8, 8);
    var blackQueenRook = chessPieceAt(runtime, 1, 8);
    var out = "";
    if (whiteKing && whiteKing.side === "white" && String(whiteKing.role || "") === "king" && whiteKing.has_moved !== true) {
      if (whiteKingRook && whiteKingRook.side === "white" && String(whiteKingRook.role || "") === "rook" && whiteKingRook.has_moved !== true) { out += "K"; }
      if (whiteQueenRook && whiteQueenRook.side === "white" && String(whiteQueenRook.role || "") === "rook" && whiteQueenRook.has_moved !== true) { out += "Q"; }
    }
    if (blackKing && blackKing.side === "black" && String(blackKing.role || "") === "king" && blackKing.has_moved !== true) {
      if (blackKingRook && blackKingRook.side === "black" && String(blackKingRook.role || "") === "rook" && blackKingRook.has_moved !== true) { out += "k"; }
      if (blackQueenRook && blackQueenRook.side === "black" && String(blackQueenRook.role || "") === "rook" && blackQueenRook.has_moved !== true) { out += "q"; }
    }
    return out || "-";
  }

  function chessPositionKey(runtime) {
    var ids = runtime && runtime.piecesByObjectId ? Object.keys(runtime.piecesByObjectId) : [];
    var pieces = [];
    for (var i = 0; i < ids.length; i += 1) {
      var piece = runtime.piecesByObjectId[ids[i]];
      if (!piece || piece.captured) { continue; }
      pieces.push(String(piece.side || "") + ":" + String(piece.role || "") + ":" + String(Number(piece.file || 0) || 0) + ":" + String(Number(piece.rank || 0) || 0));
    }
    pieces.sort();
    var ep = runtime && runtime.lastDoublePawn
      ? String(runtime.lastDoublePawn.side || "") + ":" + String(Number(runtime.lastDoublePawn.file || 0) || 0) + ":" + String(Number(runtime.lastDoublePawn.rank || 0) || 0)
      : "-";
    return String(runtime && runtime.turn || "white") + "|" + chessCastleRightsKey(runtime) + "|" + ep + "|" + pieces.join(",");
  }

  function rebuildChessPositionCounts(runtime) {
    if (!runtime) { return; }
    runtime.positionCounts = Object.create(null);
    var snapshots = Array.isArray(runtime.historySnapshots) ? runtime.historySnapshots : [];
    var limit = Math.min(Math.max(0, Number(runtime.currentMoveIndex || 0) || 0), Math.max(0, snapshots.length - 1));
    for (var i = 0; i <= limit; i += 1) {
      var key = String(snapshots[i] && snapshots[i].positionKey || "");
      if (!key) { continue; }
      runtime.positionCounts[key] = (Number(runtime.positionCounts[key] || 0) || 0) + 1;
    }
  }

  function updateChessDrawCountersAfterMove(runtime, movedPiece, capturedPiece) {
    if (!runtime) { return; }
    var pawnMove = String(movedPiece && movedPiece.role || "") === "pawn";
    runtime.halfmoveClock = (pawnMove || capturedPiece)
      ? 0
      : (Number(runtime.halfmoveClock || 0) || 0) + 1;
    var key = chessPositionKey(runtime);
    if (!runtime.positionCounts) { runtime.positionCounts = Object.create(null); }
    runtime.positionCounts[key] = (Number(runtime.positionCounts[key] || 0) || 0) + 1;
  }

  function chessDrawRuleResult(runtime) {
    if (!runtime) { return ""; }
    if ((Number(runtime.halfmoveClock || 0) || 0) >= 100) { return "draw"; }
    var key = chessPositionKey(runtime);
    if (runtime.positionCounts && (Number(runtime.positionCounts[key] || 0) || 0) >= 3) { return "draw"; }
    return "";
  }

  function runtimeMeshByObjectId(runtime, objectId) {
    return runtime && runtime.meshByObjectId ? runtime.meshByObjectId[String(Number(objectId) || 0)] || null : null;
  }

  function chessSquareKey(file, rank) {
    return String(file) + "," + String(rank);
  }

  function chessBoardX(file) {
    return (Number(file) - 4.5);
  }

  function chessBoardY(rank) {
    return (Number(rank) - 4.5);
  }

  function chessPieceValue(piece) {
    var role = String(piece && piece.role || "pawn");
    if (role === "queen") { return 9; }
    if (role === "rook") { return 5; }
    if (role === "bishop" || role === "knight") { return 3; }
    if (role === "king") { return 99; }
    return 1;
  }

  function chessBotControllerForSide(runtime, side) {
    if (!runtime) { return "human"; }
    var spec = runtime.playerModeSpec || chessPlayerModeById(runtime, runtime.playerMode);
    return String(side) === "black" ? String(spec.black || "human") : String(spec.white || "human");
  }

  function chessBotActiveForTurn(runtime) {
    return !!(runtime && chessBotControllerForSide(runtime, runtime.turn) === "bot");
  }

  function cancelChessBotTimer(runtime) {
    if (!runtime || !runtime.botTimerId) { return; }
    global.clearTimeout(runtime.botTimerId);
    runtime.botTimerId = 0;
    runtime.botThinkingSide = "";
  }

  function chessCapturedTrayCenter(runtime, piece, index) {
    var capturerSide = String(piece && piece.captured_by || "");
    var baseZ = Number(piece && piece.base_z != null ? piece.base_z : runtime && runtime.cfg && runtime.cfg.piece_base_z != null ? runtime.cfg.piece_base_z : 0.065) || 0.065;
    if (piece && Array.isArray(piece.capture_tray_center) && piece.capture_tray_center.length >= 3) {
      return [Number(piece.capture_tray_center[0] || 0.0), Number(piece.capture_tray_center[1] || 0.0), baseZ];
    }
    var safeIndex = Math.max(0, Number(index || 0) || 0);
    var sideY = capturerSide === "black" ? 4.82 : -4.82;
    var rowDir = capturerSide === "black" ? 1.0 : -1.0;
    return [-3.7 + (safeIndex * 0.62), sideY + (Math.floor(safeIndex / 12) * rowDir * 0.74), baseZ];
  }

  function chessPieceFootprintRadius(piece) {
    var mesh = piece && piece.mesh ? piece.mesh : null;
    var verts = mesh ? entityProp(mesh, "vertices", []) : [];
    if (!numericArrayLike(verts) || verts.length < 10) { return 0.31; }
    var minX = Infinity;
    var maxX = -Infinity;
    var minY = Infinity;
    var maxY = -Infinity;
    for (var i = 0; i + 1 < verts.length; i += 10) {
      var x = Number(verts[i] || 0.0);
      var y = Number(verts[i + 1] || 0.0);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
      return 0.31;
    }
    return Math.max(0.20, Math.min(0.42, Math.max((maxX - minX) * 0.5, (maxY - minY) * 0.5)));
  }

  function chessPieceFallContactPivot(piece, baseModel, direction, fallback) {
    var mesh = piece && piece.mesh ? piece.mesh : null;
    var verts = mesh ? entityProp(mesh, "vertices", []) : [];
    var model = toMatrix4(baseModel, null);
    if (!numericArrayLike(verts) || verts.length < 10 || !model) {
      return finiteVec3(fallback, [0.0, 0.0, 0.0]);
    }
    var dir = normalize3([Number(direction && direction[0] || 0.0), Number(direction && direction[1] || 0.0), 0.0], [1.0, 0.0, 0.0]);
    var world = [];
    var minZ = Infinity;
    for (var i = 0; i + 2 < verts.length; i += 10) {
      var p = transformPointMat4(model, Number(verts[i] || 0.0), Number(verts[i + 1] || 0.0), Number(verts[i + 2] || 0.0));
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2])) { continue; }
      world.push(p);
      minZ = Math.min(minZ, p[2]);
    }
    if (!world.length || !Number.isFinite(minZ)) {
      return finiteVec3(fallback, [0.0, 0.0, 0.0]);
    }
    var zTolerance = 0.012;
    var best = null;
    var bestDot = -Infinity;
    for (var w = 0; w < world.length; w += 1) {
      var wp = world[w];
      if (wp[2] > minZ + zTolerance) { continue; }
      var dot = (wp[0] * dir[0]) + (wp[1] * dir[1]);
      if (!best || dot > bestDot) {
        best = wp;
        bestDot = dot;
      }
    }
    return best ? best.slice() : finiteVec3(fallback, [0.0, 0.0, 0.0]);
  }

  function assignChessCapturedTraySlots(runtime, capturerSide) {
    var pieces = chessCapturedPiecesForSide(runtime, capturerSide);
    var sideY = String(capturerSide || "") === "black" ? 4.82 : -4.82;
    var rowDir = String(capturerSide || "") === "black" ? 1.0 : -1.0;
    var leftEdge = -3.95;
    var rightEdge = 3.95;
    var gap = 0.10;
    var row = 0;
    var x = leftEdge;
    for (var i = 0; i < pieces.length; i += 1) {
      var piece = pieces[i];
      if (!piece) { continue; }
      var radius = chessPieceFootprintRadius(piece);
      if (i > 0 && x + (radius * 2.0) > rightEdge) {
        row += 1;
        x = leftEdge;
      }
      var centerX = x + radius;
      piece.capture_tray_index = i;
      piece.capture_tray_center = [centerX, sideY + (row * rowDir * 0.74), Number(piece.base_z || 0.065) || 0.065];
      x = centerX + radius + gap;
    }
    return pieces;
  }

  function chessSortCapturedPieces(a, b) {
    var valueDelta = chessPieceValue(a) - chessPieceValue(b);
    if (valueDelta !== 0) { return valueDelta; }
    var roleDelta = String(a && a.role || "").localeCompare(String(b && b.role || ""));
    if (roleDelta !== 0) { return roleDelta; }
    var orderDelta = (Number(a && a.capture_order || 0) || 0) - (Number(b && b.capture_order || 0) || 0);
    if (orderDelta !== 0) { return orderDelta; }
    return Number(a && a.object_id || 0) - Number(b && b.object_id || 0);
  }

  function chessCapturedPiecesForSide(runtime, capturerSide) {
    var out = [];
    var ids = runtime && runtime.piecesByObjectId ? Object.keys(runtime.piecesByObjectId) : [];
    for (var i = 0; i < ids.length; i += 1) {
      var piece = runtime.piecesByObjectId[ids[i]];
      if (piece && piece.captured === true && String(piece.captured_by || "") === capturerSide) {
        out.push(piece);
      }
    }
    out.sort(chessSortCapturedPieces);
    return out;
  }

  function chessPathLength(path) {
    if (!Array.isArray(path) || path.length < 2) { return 0.0; }
    var total = 0.0;
    for (var i = 1; i < path.length; i += 1) {
      var a = toVec3(path[i - 1], [0.0, 0.0, 0.0]);
      var b = toVec3(path[i], [0.0, 0.0, 0.0]);
      var dx = Number(b[0] || 0.0) - Number(a[0] || 0.0);
      var dy = Number(b[1] || 0.0) - Number(a[1] || 0.0);
      var dz = Number(b[2] || 0.0) - Number(a[2] || 0.0);
      total += Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
    }
    return total;
  }

  function chessMotionDurationMs(runtime, path) {
    var cfg = runtime && runtime.cfg ? runtime.cfg : {};
    var minDurationMs = Math.max(16.0, Number(cfg.piece_motion_min_duration_ms || 80.0) || 80.0);
    var unitsPerSecond = Math.max(0.1, Number(cfg.piece_motion_units_per_second || 4.8) || 4.8);
    var pathLength = Math.max(0.0, chessPathLength(path));
    return Math.max(minDurationMs, (pathLength / unitsPerSecond) * 1000.0);
  }

  function queueChessAnimation(runtime, piece, path, capturedPiece, options) {
    if (!runtime || !piece || !piece.mesh || !Array.isArray(path) || path.length < 2) { return; }
    options = options && typeof options === "object" ? options : {};
    var normalizedPath = path.map(function (point) { return toVec3(point, [0.0, 0.0, 0.0]); });
    runtime.animations = Array.isArray(runtime.animations)
      ? runtime.animations.filter(function (anim) { return !anim || anim.piece !== piece; })
      : [];
    piece._animating = true;
    var fromRotation = options.from_rotation ? toVec3(options.from_rotation, [0.0, 0.0, 0.0]) : toVec3(entityProp(piece.mesh, "rotation", [0.0, 0.0, 0.0]), [0.0, 0.0, 0.0]);
    var toRotation = options.to_rotation ? toVec3(options.to_rotation, fromRotation) : fromRotation.slice();
    runtime.animations.push({
      piece: piece,
      captured: capturedPiece || null,
      path: normalizedPath,
      path_length: chessPathLength(normalizedPath),
      duration_ms: Math.max(16.0, Number(options.duration_ms || 0.0) || chessMotionDurationMs(runtime, normalizedPath)),
      easing: String(options.easing || "linear"),
      fall_pose: options.fall_pose && typeof options.fall_pose === "object" ? cloneJsonValue(options.fall_pose) : null,
      from: toVec3(normalizedPath[0], [0.0, 0.0, 0.0]),
      to: toVec3(normalizedPath[normalizedPath.length - 1], [0.0, 0.0, 0.0]),
      from_rotation: fromRotation,
      to_rotation: toRotation,
      start: global.performance && typeof global.performance.now === "function" ? global.performance.now() : Date.now(),
      elapsed_ms: 0.0,
      last_tick_ms: 0.0,
      progress: 0.0,
    });
  }

  function queueCapturedPieceAnimation(runtime, capturedPiece, capturerSide) {
    if (!runtime || !capturedPiece || !capturedPiece.mesh) { return; }
    var before = chessCapturedPiecesForSide(runtime, capturerSide);
    capturedPiece.captured = true;
    capturedPiece.captured_by = capturerSide;
    capturedPiece.in_capture_tray = true;
    runtime.nextCaptureOrder = Number(runtime.nextCaptureOrder || 0) || 0;
    runtime.nextCaptureOrder += 1;
    capturedPiece.capture_order = runtime.nextCaptureOrder;
    setEntityProp(capturedPiece.mesh, "visible", true);
    var capturedForSide = assignChessCapturedTraySlots(runtime, capturerSide);
    var targetIndex = Math.max(0, capturedForSide.indexOf(capturedPiece));
    for (var i = 0; i < capturedForSide.length; i += 1) {
      var trayPiece = capturedForSide[i];
      if (!trayPiece || trayPiece === capturedPiece || !trayPiece.mesh) { continue; }
      var oldIndex = before.indexOf(trayPiece);
      if (oldIndex >= 0 && i <= oldIndex) { continue; }
      var currentCenter = toVec3(entityProp(trayPiece.mesh, "center", chessCapturedTrayCenter(runtime, trayPiece, Math.max(0, oldIndex))), chessCapturedTrayCenter(runtime, trayPiece, Math.max(0, oldIndex)));
      var sortedCenter = chessCapturedTrayCenter(runtime, trayPiece, i);
      queueChessAnimation(runtime, trayPiece, [currentCenter, sortedCenter], null);
    }
    var fromCenter = toVec3(entityProp(capturedPiece.mesh, "center", pieceBoardCenter(capturedPiece, 0.0)), pieceBoardCenter(capturedPiece, 0.0));
    var trayCenter = chessCapturedTrayCenter(runtime, capturedPiece, targetIndex);
    var liftZ = Math.max(Number(fromCenter[2] || 0.0), Number(trayCenter[2] || 0.0)) + 1.05;
    queueChessAnimation(runtime, capturedPiece, [
      fromCenter,
      [fromCenter[0], fromCenter[1], liftZ],
      [trayCenter[0], trayCenter[1], liftZ],
      trayCenter
    ], null);
  }

  function chessSquareFromObjectId(runtime, objectId) {
    var oid = Number(objectId) || 0;
    var first = Number(runtime.cfg.square_object_id_first || 2) || 2;
    var last = Number(runtime.cfg.square_object_id_last || 65) || 65;
    if (oid < first || oid > last) { return null; }
    var index = oid - first;
    return { file: (index % 8) + 1, rank: Math.floor(index / 8) + 1, object_id: oid };
  }

  function chessSquareObjectId(runtime, file, rank) {
    return Number(runtime.cfg.square_object_id_first || 2) + ((Number(rank) - 1) * 8) + (Number(file) - 1);
  }

  function chessSquareRegionObjectId(cfg) {
    return Number(cfg && cfg.square_region_object_id || cfg && cfg.square_object_id_first || 2) || 2;
  }

  function chessSquareFromSimplexId(runtime, simplexId) {
    var sid = Number(simplexId || 0) | 0;
    if (sid <= 0) { return null; }
    var index = sid - 1;
    if (index < 0 || index >= 64) { return null; }
    return {
      file: (index % 8) + 1,
      rank: Math.floor(index / 8) + 1,
      object_id: chessSquareObjectId(runtime, (index % 8) + 1, Math.floor(index / 8) + 1)
    };
  }

  function chessSquareState(runtime, file, rank) {
    if (!runtime.squareStates) { runtime.squareStates = Object.create(null); }
    return runtime.squareStates[chessSquareKey(file, rank)] || {
      state: "idle",
      color: [0.2, 1.0, 0.2, 0.0]
    };
  }

  function setChessSquareRegionState(runtime, file, rank, stateName, color) {
    if (!runtime.squareStates) { runtime.squareStates = Object.create(null); }
    runtime.squareRegionHasActiveState = true;
    var key = chessSquareKey(file, rank);
    var state = {
      state: String(stateName || "idle"),
      color: toRgba(color, [0.2, 1.0, 0.2, 0.0])
    };
    runtime.squareStates[key] = state;
  }

  function clearChessSquareRegionStates(runtime) {
    runtime.squareStates = Object.create(null);
    runtime.squareRegionHasActiveState = false;
  }

  function isChessSquareSourceMesh(mesh, cfg) {
    if (!cfg || !mesh) { return false; }
    var oid = Number(entityProp(mesh, "object_id", 0) || 0);
    var first = Number(cfg.square_object_id_first || 2) || 2;
    var last = Number(cfg.square_object_id_last || 65) || 65;
    if (oid >= first && oid <= last) { return true; }
    return /^sq_[a-h][1-8]$/.test(String(entityProp(mesh, "id", mesh.id || "")));
  }

  function suppressChessSquareVisualMesh(mesh) {
    if (!mesh || typeof mesh !== "object") { return mesh; }
    setEntityProp(mesh, "visible", false);
    setEntityProp(mesh, "alpha", 0.0);
    setEntityProp(mesh, "depth_write", false);
    setEntityProp(mesh, "transparent", true);
    setEntityProp(mesh, "pickable", false);
    return mesh;
  }

  function assertChessHitRegionContract(cfg) {
    var regions = cfg && Array.isArray(cfg.hit_regions) ? cfg.hit_regions : [];
    var wantedId = String(cfg && cfg.hit_region_id || "vkf_chess_board_squares");
    var found = null;
    for (var i = 0; i < regions.length; i += 1) {
      var region = regions[i] || {};
      if (String(region.id || "") === wantedId || String(region.kind || "") === "plane_grid") {
        found = region;
        break;
      }
    }
    if (!found) {
      failFast("chess interaction requires a plane_grid hit region named " + wantedId);
    }
    if (String(found.kind || "") !== "plane_grid") {
      failFast("chess hit region " + wantedId + " must be kind=plane_grid");
    }
    if (Number(found.columns || 0) !== 8 || Number(found.rows || 0) !== 8) {
      failFast("chess hit region " + wantedId + " must be an 8x8 grid");
    }
    if (Number(found.object_id_first || 0) !== Number(cfg.square_object_id_first || 2)) {
      failFast("chess hit region object_id_first must match square_object_id_first");
    }
    if (found.exclusive !== true) {
      failFast("chess hit region " + wantedId + " must be exclusive=true");
    }
  }

  function chessSquareHighlightColors(runtime) {
    var out = [];
    for (var rank = 1; rank <= 8; rank += 1) {
      for (var file = 1; file <= 8; file += 1) {
        var state = runtime ? chessSquareState(runtime, file, rank) : null;
        out.push(state ? state.color : [0.0, 0.0, 0.0, 0.0]);
      }
    }
    return out;
  }

  function attachChessBoardHighlights(mesh, runtime) {
    if (!mesh || !runtime || String(entityProp(mesh, "id", mesh.id || "")) !== "board_reflection_overlay") {
      return mesh;
    }
    var next = Object.assign({}, mesh);
    var surface = next.surface_system && typeof next.surface_system === "object"
      ? Object.assign({}, next.surface_system)
      : {};
    surface.square_highlights = chessSquareHighlightColors(runtime);
    next.surface_system = surface;
    return next;
  }

  function attachChessSquareVisualState(mesh, runtime) {
    if (!mesh || !runtime) { return mesh; }
    var square = chessSquareFromObjectId(runtime, Number(entityProp(mesh, "object_id", 0) || 0));
    if (!square) { return mesh; }
    var next = Object.assign({}, mesh);
    var state = chessSquareState(runtime, square.file, square.rank);
    setChessSquareVisualState(next, state.state, state.color);
    return next;
  }

  function chessPieceFromObjectId(runtime, objectId) {
    var oid = Number(objectId) || 0;
    return runtime && runtime.piecesByObjectId ? runtime.piecesByObjectId[String(oid)] || null : null;
  }

  function chessPieceAt(runtime, file, rank) {
    return runtime.occupied[chessSquareKey(file, rank)] || null;
  }

  function chessPathClear(runtime, piece, toFile, toRank) {
    var df = Math.sign(Number(toFile) - Number(piece.file));
    var dr = Math.sign(Number(toRank) - Number(piece.rank));
    var f = Number(piece.file) + df;
    var r = Number(piece.rank) + dr;
    while (f !== Number(toFile) || r !== Number(toRank)) {
      if (chessPieceAt(runtime, f, r)) { return false; }
      f += df;
      r += dr;
    }
    return true;
  }

  function chessPieceAttacksSquare(runtime, piece, toFile, toRank) {
    if (!piece || piece.captured) { return false; }
    var df = Number(toFile) - Number(piece.file);
    var dr = Number(toRank) - Number(piece.rank);
    var adf = Math.abs(df);
    var adr = Math.abs(dr);
    if (df === 0 && dr === 0) { return false; }
    var role = String(piece.role || "");
    if (role === "pawn") {
      return adf === 1 && dr === (piece.side === "white" ? 1 : -1);
    }
    if (role === "knight") { return (adf === 1 && adr === 2) || (adf === 2 && adr === 1); }
    if (role === "king") { return adf <= 1 && adr <= 1; }
    if (role === "rook") { return (df === 0 || dr === 0) && chessPathClear(runtime, piece, toFile, toRank); }
    if (role === "bishop") { return adf === adr && chessPathClear(runtime, piece, toFile, toRank); }
    if (role === "queen") { return ((df === 0 || dr === 0) || adf === adr) && chessPathClear(runtime, piece, toFile, toRank); }
    return false;
  }

  function chessSquareAttackedBy(runtime, file, rank, side) {
    var ids = Object.keys(runtime.piecesByObjectId);
    for (var i = 0; i < ids.length; i += 1) {
      var piece = runtime.piecesByObjectId[ids[i]];
      if (piece && piece.side === side && chessPieceAttacksSquare(runtime, piece, file, rank)) {
        return true;
      }
    }
    return false;
  }

  function chessFindKing(runtime, side) {
    var ids = Object.keys(runtime.piecesByObjectId);
    for (var i = 0; i < ids.length; i += 1) {
      var piece = runtime.piecesByObjectId[ids[i]];
      if (piece && !piece.captured && piece.side === side && String(piece.role || "") === "king") {
        return piece;
      }
    }
    return null;
  }

  function chessKingInCheck(runtime, side) {
    var king = chessFindKing(runtime, side);
    if (!king) { return false; }
    var enemySide = side === "white" ? "black" : "white";
    return chessSquareAttackedBy(runtime, king.file, king.rank, enemySide);
  }

  function chessCastleInfo(runtime, piece, toFile, toRank) {
    if (!piece || piece.captured || String(piece.role || "") !== "king") { return null; }
    if (piece.has_moved === true) { return null; }
    if (Number(piece.file) !== 5 || Number(piece.rank) !== Number(toRank)) { return null; }
    var df = Number(toFile) - Number(piece.file);
    if (Math.abs(df) !== 2) { return null; }
    if (chessPieceAt(runtime, toFile, toRank)) { return null; }
    var kingside = df > 0;
    var rookFile = kingside ? 8 : 1;
    var rookToFile = kingside ? 6 : 4;
    var throughFile = kingside ? 6 : 4;
    var rook = chessPieceAt(runtime, rookFile, toRank);
    if (!rook || rook.side !== piece.side || String(rook.role || "") !== "rook" || rook.has_moved === true) {
      return null;
    }
    var clearFiles = kingside ? [6, 7] : [4, 3, 2];
    for (var i = 0; i < clearFiles.length; i += 1) {
      if (chessPieceAt(runtime, clearFiles[i], toRank)) { return null; }
    }
    var enemySide = piece.side === "white" ? "black" : "white";
    if (chessSquareAttackedBy(runtime, 5, toRank, enemySide)) { return null; }
    if (chessSquareAttackedBy(runtime, throughFile, toRank, enemySide)) { return null; }
    if (chessSquareAttackedBy(runtime, toFile, toRank, enemySide)) { return null; }
    return {
      rook: rook,
      rookFromFile: rookFile,
      rookToFile: rookToFile,
      notation: kingside ? "O-O" : "O-O-O"
    };
  }

  function chessEnPassantCapturedPiece(runtime, piece, toFile, toRank) {
    if (!runtime || !piece || piece.captured || String(piece.role || "") !== "pawn") { return null; }
    var last = runtime.lastDoublePawn || null;
    if (!last || !last.side || last.side === piece.side) { return null; }
    var dir = piece.side === "white" ? 1 : -1;
    if (Math.abs(Number(toFile) - Number(piece.file)) !== 1) { return null; }
    if (Number(toRank) - Number(piece.rank) !== dir) { return null; }
    if (Number(toFile) !== Number(last.file)) { return null; }
    if (Number(last.rank) !== Number(piece.rank)) { return null; }
    if (chessPieceAt(runtime, toFile, toRank)) { return null; }
    var captured = chessPieceAt(runtime, last.file, last.rank);
    if (!captured || captured.side !== last.side || String(captured.role || "") !== "pawn") { return null; }
    return captured;
  }

  function recordChessLastDoublePawn(runtime, piece, fromRank, toFile, toRank) {
    if (!runtime) { return; }
    if (piece && String(piece.role || "") === "pawn" && Math.abs(Number(toRank) - Number(fromRank)) === 2) {
      runtime.lastDoublePawn = {
        side: String(piece.side || ""),
        file: Number(toFile) || 0,
        rank: Number(toRank) || 0
      };
      return;
    }
    runtime.lastDoublePawn = null;
  }

  function chessPseudoLegalMove(runtime, piece, toFile, toRank) {
    if (!piece || piece.captured) { return false; }
    if (toFile < 1 || toFile > 8 || toRank < 1 || toRank > 8) { return false; }
    if (piece.side !== runtime.turn) { return false; }
    var target = chessPieceAt(runtime, toFile, toRank);
    if (target && target.side === piece.side) { return false; }
    var df = Number(toFile) - Number(piece.file);
    var dr = Number(toRank) - Number(piece.rank);
    var adf = Math.abs(df);
    var adr = Math.abs(dr);
    if (df === 0 && dr === 0) { return false; }
    var role = String(piece.role || "");
    if (role === "pawn") {
      var dir = piece.side === "white" ? 1 : -1;
      var startRank = piece.side === "white" ? 2 : 7;
      if (target) { return adf === 1 && dr === dir; }
      if (adf === 1 && dr === dir && chessEnPassantCapturedPiece(runtime, piece, toFile, toRank)) { return true; }
      if (df === 0 && dr === dir) { return true; }
      if (df === 0 && Number(piece.rank) === startRank && dr === dir * 2) {
        return !chessPieceAt(runtime, Number(piece.file), Number(piece.rank) + dir);
      }
      return false;
    }
    if (role === "knight") { return (adf === 1 && adr === 2) || (adf === 2 && adr === 1); }
    if (role === "king") { return (adf <= 1 && adr <= 1) || !!chessCastleInfo(runtime, piece, toFile, toRank); }
    if (role === "rook") { return (df === 0 || dr === 0) && chessPathClear(runtime, piece, toFile, toRank); }
    if (role === "bishop") { return adf === adr && chessPathClear(runtime, piece, toFile, toRank); }
    if (role === "queen") { return ((df === 0 || dr === 0) || adf === adr) && chessPathClear(runtime, piece, toFile, toRank); }
    return false;
  }

  function chessWouldLeaveKingInCheck(runtime, piece, toFile, toRank) {
    var fromFile = Number(piece.file);
    var fromRank = Number(piece.rank);
    var target = chessPieceAt(runtime, toFile, toRank);
    var enPassantCaptured = chessEnPassantCapturedPiece(runtime, piece, toFile, toRank);
    var castle = chessCastleInfo(runtime, piece, toFile, toRank);
    var rook = castle && castle.rook ? castle.rook : null;
    var rookFromFile = castle ? castle.rookFromFile : 0;
    var rookToFile = castle ? castle.rookToFile : 0;
    var rookRank = Number(toRank);
    delete runtime.occupied[chessSquareKey(fromFile, fromRank)];
    if (target) {
      target.captured = true;
      delete runtime.occupied[chessSquareKey(toFile, toRank)];
    }
    if (enPassantCaptured) {
      enPassantCaptured.captured = true;
      delete runtime.occupied[chessSquareKey(enPassantCaptured.file, enPassantCaptured.rank)];
    }
    piece.file = Number(toFile);
    piece.rank = Number(toRank);
    runtime.occupied[chessSquareKey(piece.file, piece.rank)] = piece;
    if (rook) {
      delete runtime.occupied[chessSquareKey(rookFromFile, rookRank)];
      rook.file = rookToFile;
      rook.rank = rookRank;
      runtime.occupied[chessSquareKey(rook.file, rook.rank)] = rook;
    }
    var inCheck = chessKingInCheck(runtime, piece.side);
    delete runtime.occupied[chessSquareKey(piece.file, piece.rank)];
    piece.file = fromFile;
    piece.rank = fromRank;
    runtime.occupied[chessSquareKey(fromFile, fromRank)] = piece;
    if (target) {
      target.captured = false;
      runtime.occupied[chessSquareKey(toFile, toRank)] = target;
    }
    if (enPassantCaptured) {
      enPassantCaptured.captured = false;
      runtime.occupied[chessSquareKey(enPassantCaptured.file, enPassantCaptured.rank)] = enPassantCaptured;
    }
    if (rook) {
      delete runtime.occupied[chessSquareKey(rook.file, rook.rank)];
      rook.file = rookFromFile;
      rook.rank = rookRank;
      runtime.occupied[chessSquareKey(rook.file, rook.rank)] = rook;
    }
    return inCheck;
  }

  function chessLegalMove(runtime, piece, toFile, toRank) {
    if (!chessPseudoLegalMove(runtime, piece, toFile, toRank)) { return false; }
    return !chessWouldLeaveKingInCheck(runtime, piece, toFile, toRank);
  }

  function chessBotSideSign(pieceSide, perspective) {
    return String(pieceSide) === String(perspective) ? 1 : -1;
  }

  function chessBotRoleValue(role) {
    role = String(role || "pawn");
    if (role === "king") { return 20000; }
    if (role === "queen") { return 900; }
    if (role === "rook") { return 500; }
    if (role === "knight") { return 325; }
    if (role === "bishop") { return 315; }
    return 100;
  }

  function chessBotCenterDistance(file, rank) {
    return Math.abs((Number(file) * 2) - 9) + Math.abs((Number(rank) * 2) - 9);
  }

  function chessBotCenterBonus(piece) {
    var dist = chessBotCenterDistance(piece.file, piece.rank);
    var role = String(piece.role || "");
    if (role === "knight") { return 36 - (dist * 5); }
    if (role === "bishop") { return 18 - (dist * 2); }
    if (role === "queen") { return 10 - dist; }
    if (role === "pawn") { return 8 - dist; }
    return 0;
  }

  function chessBotPawnAdvanceBonus(piece) {
    if (String(piece.role || "") !== "pawn") { return 0; }
    return String(piece.side) === "white" ? (Number(piece.rank) - 2) * 12 : (7 - Number(piece.rank)) * 12;
  }

  function chessBotDevelopedBonus(piece) {
    var role = String(piece.role || "");
    if (role === "pawn" || role === "king") { return 0; }
    if (piece.has_moved === true) { return 18; }
    if (String(piece.side) === "white") { return Number(piece.rank) > 1 ? 18 : 0; }
    return Number(piece.rank) < 8 ? 18 : 0;
  }

  function chessBotProtectedBonus(runtime, piece) {
    return chessSquareAttackedBy(runtime, piece.file, piece.rank, piece.side) ? 12 : 0;
  }

  function chessBotOpponentSide(side) {
    return String(side) === "white" ? "black" : "white";
  }

  function chessBotLeastValuableAttacker(runtime, side, file, rank) {
    var best = null;
    var ids = Object.keys(runtime.piecesByObjectId);
    for (var i = 0; i < ids.length; i += 1) {
      var piece = runtime.piecesByObjectId[ids[i]];
      if (!piece || piece.captured || piece.side !== side) { continue; }
      if (!chessPieceAttacksSquare(runtime, piece, file, rank)) { continue; }
      if (!best || chessBotRoleValue(piece.role) < chessBotRoleValue(best.role)) {
        best = piece;
      }
    }
    return best;
  }

  function chessBotPieceSafetyScore(runtime, piece) {
    if (!piece || piece.captured || String(piece.role || "") === "king") { return 0; }
    var enemySide = chessBotOpponentSide(piece.side);
    var attacked = chessSquareAttackedBy(runtime, piece.file, piece.rank, enemySide);
    var defended = chessSquareAttackedBy(runtime, piece.file, piece.rank, piece.side);
    if (!attacked) { return defended ? 8 : 0; }
    var leastEnemy = chessBotLeastValuableAttacker(runtime, enemySide, piece.file, piece.rank);
    var enemyValue = leastEnemy ? chessBotRoleValue(leastEnemy.role) : 0;
    var pieceValue = chessBotRoleValue(piece.role);
    var penalty = defended ? Math.round(pieceValue * 0.14) : Math.round(pieceValue * 0.55);
    if (enemyValue > 0 && enemyValue < pieceValue) {
      penalty += Math.round((pieceValue - enemyValue) * (defended ? 0.16 : 0.34));
    }
    return -penalty;
  }

  function chessBotBishopPairScore(runtime, side) {
    var bishops = 0;
    var ids = Object.keys(runtime.piecesByObjectId);
    for (var i = 0; i < ids.length; i += 1) {
      var piece = runtime.piecesByObjectId[ids[i]];
      if (piece && !piece.captured && piece.side === side && String(piece.role || "") === "bishop") {
        bishops += 1;
      }
    }
    return bishops >= 2 ? 55 : 0;
  }

  function chessBotKingEscapeCount(runtime, side) {
    var king = chessFindKing(runtime, side);
    if (!king) { return 0; }
    var previousTurn = runtime.turn;
    var count = 0;
    runtime.turn = side;
    try {
      for (var df = -1; df <= 1; df += 1) {
        for (var dr = -1; dr <= 1; dr += 1) {
          if (df === 0 && dr === 0) { continue; }
          if (chessLegalMove(runtime, king, Number(king.file) + df, Number(king.rank) + dr)) {
            count += 1;
          }
        }
      }
    } finally {
      runtime.turn = previousTurn;
    }
    return count;
  }

  function chessBotKingTropismScore(runtime, side) {
    var enemySide = chessBotOpponentSide(side);
    var enemyKing = chessFindKing(runtime, enemySide);
    if (!enemyKing) { return 0; }
    var score = 0;
    var ids = Object.keys(runtime.piecesByObjectId);
    for (var i = 0; i < ids.length; i += 1) {
      var piece = runtime.piecesByObjectId[ids[i]];
      if (!piece || piece.captured || piece.side !== side) { continue; }
      var role = String(piece.role || "");
      if (role === "king" || role === "pawn") { continue; }
      var dist = Math.abs(Number(piece.file) - Number(enemyKing.file)) + Math.abs(Number(piece.rank) - Number(enemyKing.rank));
      var closeness = Math.max(0, 9 - dist);
      var weight = role === "queen" ? 8 : role === "rook" ? 5 : 3;
      score += closeness * weight;
    }
    return score;
  }

  function chessBotMatingNetScore(runtime, side) {
    var material = chessBotMaterialBalanceForSide(runtime, side);
    if (material < 360) { return 0; }
    var enemySide = chessBotOpponentSide(side);
    var enemyKing = chessFindKing(runtime, enemySide);
    var ownKing = chessFindKing(runtime, side);
    if (!enemyKing) { return 0; }
    var edgeDistance = Math.min(
      Number(enemyKing.file) - 1,
      8 - Number(enemyKing.file),
      Number(enemyKing.rank) - 1,
      8 - Number(enemyKing.rank)
    );
    var escapeCount = chessBotKingEscapeCount(runtime, enemySide);
    var score = Math.max(0, 4 - edgeDistance) * 24 + Math.max(0, 8 - escapeCount) * 14;
    if (ownKing) {
      var kingDist = Math.abs(Number(ownKing.file) - Number(enemyKing.file)) + Math.abs(Number(ownKing.rank) - Number(enemyKing.rank));
      score += Math.max(0, 8 - kingDist) * 5;
    }
    return score + chessBotKingTropismScore(runtime, side);
  }

  function chessBotCastledBonus(piece) {
    if (String(piece.role || "") !== "king") { return 0; }
    if (String(piece.side) === "white" && Number(piece.rank) === 1) {
      if (Number(piece.file) === 7) { return 55; }
      if (Number(piece.file) === 3) { return 45; }
    }
    if (String(piece.side) === "black" && Number(piece.rank) === 8) {
      if (Number(piece.file) === 7) { return 55; }
      if (Number(piece.file) === 3) { return 45; }
    }
    return 0;
  }

  function chessBotSideCastleRightsScore(runtime, side) {
    var kingRank = side === "white" ? 1 : 8;
    var king = chessPieceAt(runtime, 5, kingRank);
    if (!king || king.side !== side || String(king.role || "") !== "king" || king.has_moved === true) { return 0; }
    var score = 0;
    var kingRook = chessPieceAt(runtime, 8, kingRank);
    var queenRook = chessPieceAt(runtime, 1, kingRank);
    if (kingRook && kingRook.side === side && String(kingRook.role || "") === "rook" && kingRook.has_moved !== true) { score += 76; }
    if (queenRook && queenRook.side === side && String(queenRook.role || "") === "rook" && queenRook.has_moved !== true) { score += 48; }
    return score;
  }

  function chessBotOpeningPhase(runtime) {
    var moveCount = runtime && Array.isArray(runtime.moves) ? runtime.moves.length : 0;
    var nonPawnMaterial = 0;
    var ids = Object.keys(runtime.piecesByObjectId);
    for (var i = 0; i < ids.length; i += 1) {
      var piece = runtime.piecesByObjectId[ids[i]];
      if (!piece || piece.captured) { continue; }
      var role = String(piece.role || "");
      if (role !== "pawn" && role !== "king") { nonPawnMaterial += chessBotRoleValue(role); }
    }
    if (moveCount < 12) { return 1.0; }
    if (moveCount > 28 || nonPawnMaterial < 3600) { return 0.0; }
    return Math.max(0.0, Math.min(1.0, (28 - moveCount) / 16));
  }

  function chessBotPseudoMobilityForPiece(runtime, piece) {
    if (!piece || piece.captured) { return 0; }
    var count = 0;
    var previousTurn = runtime.turn;
    runtime.turn = piece.side;
    try {
      for (var rank = 1; rank <= 8; rank += 1) {
        for (var file = 1; file <= 8; file += 1) {
          if (chessPseudoLegalMove(runtime, piece, file, rank)) { count += 1; }
        }
      }
    } finally {
      runtime.turn = previousTurn;
    }
    return count;
  }

  function chessBotControlScoreForPiece(runtime, piece) {
    if (!piece || piece.captured) { return 0; }
    var score = 0;
    var mobility = 0;
    for (var rank = 1; rank <= 8; rank += 1) {
      for (var file = 1; file <= 8; file += 1) {
        if (!chessPieceAttacksSquare(runtime, piece, file, rank)) { continue; }
        mobility += 1;
        var centerWeight = 7 - Math.min(6, chessBotCenterDistance(file, rank));
        score += 2 + centerWeight;
        var target = chessPieceAt(runtime, file, rank);
        if (target && target.side !== piece.side) {
          score += Math.min(80, Math.floor(chessBotRoleValue(target.role) / 8));
        }
        if ((file === 4 || file === 5) && (rank === 4 || rank === 5)) { score += 18; }
      }
    }
    return score + (mobility * 3);
  }

  function chessBotKingSafetyScore(runtime, side) {
    var king = chessFindKing(runtime, side);
    if (!king) { return -20000; }
    var enemySide = side === "white" ? "black" : "white";
    var score = chessKingInCheck(runtime, side) ? -120 : 0;
    var homeRank = side === "white" ? 1 : 8;
    if (Number(king.rank) === homeRank && (Number(king.file) === 7 || Number(king.file) === 3)) {
      score += 44;
    }
    var pawnDir = side === "white" ? 1 : -1;
    for (var df = -1; df <= 1; df += 1) {
      var shield = chessPieceAt(runtime, Number(king.file) + df, Number(king.rank) + pawnDir);
      if (shield && shield.side === side && String(shield.role || "") === "pawn") { score += 13; }
    }
    for (var rank = Math.max(1, Number(king.rank) - 1); rank <= Math.min(8, Number(king.rank) + 1); rank += 1) {
      for (var file = Math.max(1, Number(king.file) - 1); file <= Math.min(8, Number(king.file) + 1); file += 1) {
        if (chessSquareAttackedBy(runtime, file, rank, enemySide)) { score -= 18; }
        if (chessSquareAttackedBy(runtime, file, rank, side)) { score += 5; }
      }
    }
    return score;
  }

  function chessBotOpeningPieceScore(runtime, piece) {
    if (!piece || piece.captured) { return 0; }
    var phase = chessBotOpeningPhase(runtime);
    if (phase <= 0.0) { return 0; }
    var side = String(piece.side || "");
    var role = String(piece.role || "");
    var score = 0;
    if (role === "pawn") {
      if ((Number(piece.file) === 4 || Number(piece.file) === 5) && (Number(piece.rank) === 4 || Number(piece.rank) === 5)) { score += 34; }
      if ((Number(piece.file) === 3 || Number(piece.file) === 6) && (Number(piece.rank) === 4 || Number(piece.rank) === 5)) { score += 12; }
    }
    if (role === "knight") {
      if ((side === "white" && Number(piece.rank) > 1) || (side === "black" && Number(piece.rank) < 8)) { score += 42; }
      if (Number(piece.file) === 3 || Number(piece.file) === 6) { score += 18; }
    }
    if (role === "bishop") {
      if ((side === "white" && Number(piece.rank) > 1) || (side === "black" && Number(piece.rank) < 8)) { score += 34; }
    }
    if (role === "rook") {
      var homeRank = side === "white" ? 1 : 8;
      var onHomeCorner = Number(piece.rank) === homeRank && (Number(piece.file) === 1 || Number(piece.file) === 8);
      if (!onHomeCorner && piece.has_moved === true) { score -= 58; }
    }
    if (role === "queen") {
      var queenHomeRank = side === "white" ? 1 : 8;
      if (Number(piece.rank) !== queenHomeRank || Number(piece.file) !== 4) { score -= 22; }
    }
    return Math.round(score * phase);
  }

  function chessBotEvaluate(runtime, perspective) {
    var score = runtime.turn === perspective ? 8 : -8;
    score += (chessBotSideCastleRightsScore(runtime, perspective) - chessBotSideCastleRightsScore(runtime, perspective === "white" ? "black" : "white"));
    score += (chessBotKingSafetyScore(runtime, perspective) - chessBotKingSafetyScore(runtime, perspective === "white" ? "black" : "white"));
    score += (chessBotBishopPairScore(runtime, perspective) - chessBotBishopPairScore(runtime, perspective === "white" ? "black" : "white"));
    score += (chessBotMatingNetScore(runtime, perspective) - chessBotMatingNetScore(runtime, perspective === "white" ? "black" : "white"));
    var ids = Object.keys(runtime.piecesByObjectId);
    var whiteMaterial = 0;
    var blackMaterial = 0;
    var whiteQueen = false;
    var blackQueen = false;
    for (var i = 0; i < ids.length; i += 1) {
      var piece = runtime.piecesByObjectId[ids[i]];
      if (!piece || piece.captured) { continue; }
      var roleValue = chessBotRoleValue(piece.role);
      if (String(piece.role || "") !== "king") {
        if (piece.side === "white") { whiteMaterial += roleValue; } else { blackMaterial += roleValue; }
      }
      if (String(piece.role || "") === "queen") {
        if (piece.side === "white") { whiteQueen = true; } else { blackQueen = true; }
      }
      var raw = chessBotRoleValue(piece.role) +
        chessBotCenterBonus(piece) +
        chessBotPawnAdvanceBonus(piece) +
        chessBotDevelopedBonus(piece) +
        chessBotProtectedBonus(runtime, piece) +
        chessBotCastledBonus(piece) +
        chessBotOpeningPieceScore(runtime, piece) +
        chessBotControlScoreForPiece(runtime, piece) +
        chessBotPieceSafetyScore(runtime, piece);
      score += raw * chessBotSideSign(piece.side, perspective);
    }
    var materialBalance = perspective === "white" ? whiteMaterial - blackMaterial : blackMaterial - whiteMaterial;
    var ownQueen = perspective === "white" ? whiteQueen : blackQueen;
    var enemyQueen = perspective === "white" ? blackQueen : whiteQueen;
    if (materialBalance < -220 && ownQueen && enemyQueen) { score += 120; }
    if (materialBalance < -220 && !ownQueen && !enemyQueen) { score -= 120; }
    if (materialBalance > 220 && !ownQueen && !enemyQueen) { score += 80; }
    if (materialBalance > 220 && ownQueen && enemyQueen) { score -= 40; }
    return score;
  }

  function chessBotMoveList(runtime, side) {
    var previousTurn = runtime.turn;
    var moves = [];
    runtime.turn = side;
    try {
      var ids = Object.keys(runtime.piecesByObjectId).sort(function (a, b) { return (Number(a) || 0) - (Number(b) || 0); });
      for (var i = 0; i < ids.length; i += 1) {
        var piece = runtime.piecesByObjectId[ids[i]];
        if (!piece || piece.captured || piece.side !== side) { continue; }
        for (var rank = 1; rank <= 8; rank += 1) {
          for (var file = 1; file <= 8; file += 1) {
            if (chessLegalMove(runtime, piece, file, rank)) {
              if (chessIsPromotionMove(piece, rank)) {
                var roles = chessPromotionRoles();
                for (var pr = 0; pr < roles.length; pr += 1) {
                  moves.push({ piece: piece, toFile: file, toRank: rank, promotionRole: roles[pr] });
                }
              } else {
                moves.push({ piece: piece, toFile: file, toRank: rank, promotionRole: "" });
              }
            }
          }
        }
      }
    } finally {
      runtime.turn = previousTurn;
    }
    return moves;
  }

  function chessBotStateSnapshot(runtime) {
    var pieces = [];
    var ids = Object.keys(runtime.piecesByObjectId);
    for (var i = 0; i < ids.length; i += 1) {
      var piece = runtime.piecesByObjectId[ids[i]];
      if (!piece) { continue; }
      pieces.push({
        object_id: piece.object_id,
        role: piece.role,
        file: piece.file,
        rank: piece.rank,
        captured: piece.captured === true,
        has_moved: piece.has_moved === true
      });
    }
    return {
      turn: runtime.turn,
      lastDoublePawn: runtime.lastDoublePawn ? {
        side: runtime.lastDoublePawn.side,
        file: runtime.lastDoublePawn.file,
        rank: runtime.lastDoublePawn.rank
      } : null,
      pieces: pieces
    };
  }

  function restoreChessBotState(runtime, snapshot) {
    if (!snapshot) { return; }
    for (var i = 0; i < snapshot.pieces.length; i += 1) {
      var saved = snapshot.pieces[i];
      var piece = runtime.piecesByObjectId[String(saved.object_id)] || null;
      if (!piece) { continue; }
      piece.file = saved.file;
      piece.rank = saved.rank;
      piece.role = saved.role;
      piece.captured = saved.captured === true;
      piece.has_moved = saved.has_moved === true;
    }
    runtime.turn = snapshot.turn;
    runtime.lastDoublePawn = snapshot.lastDoublePawn ? {
      side: snapshot.lastDoublePawn.side,
      file: snapshot.lastDoublePawn.file,
      rank: snapshot.lastDoublePawn.rank
    } : null;
    rebuildChessOccupancy(runtime);
  }

  function applyChessBotMoveState(runtime, move) {
    var piece = move && move.piece;
    if (!piece) { return false; }
    var toFile = Number(move.toFile);
    var toRank = Number(move.toRank);
    if (!chessLegalMove(runtime, piece, toFile, toRank)) { return false; }
    var target = chessPieceAt(runtime, toFile, toRank);
    var enPassantCaptured = chessEnPassantCapturedPiece(runtime, piece, toFile, toRank);
    var castle = chessCastleInfo(runtime, piece, toFile, toRank);
    var fromRank = Number(piece.rank);
    delete runtime.occupied[chessSquareKey(piece.file, piece.rank)];
    if (target) {
      target.captured = true;
      delete runtime.occupied[chessSquareKey(target.file, target.rank)];
    }
    if (enPassantCaptured) {
      enPassantCaptured.captured = true;
      delete runtime.occupied[chessSquareKey(enPassantCaptured.file, enPassantCaptured.rank)];
    }
    piece.file = toFile;
    piece.rank = toRank;
    piece.has_moved = true;
    if (String(piece.role || "") === "pawn" && (toRank === 1 || toRank === 8)) {
      piece.role = String(move.promotionRole || "queen");
    }
    runtime.occupied[chessSquareKey(piece.file, piece.rank)] = piece;
    if (castle && castle.rook) {
      var rook = castle.rook;
      delete runtime.occupied[chessSquareKey(castle.rookFromFile, toRank)];
      rook.file = castle.rookToFile;
      rook.rank = toRank;
      rook.has_moved = true;
      runtime.occupied[chessSquareKey(rook.file, rook.rank)] = rook;
    }
    recordChessLastDoublePawn(runtime, piece, fromRank, toFile, toRank);
    runtime.turn = runtime.turn === "white" ? "black" : "white";
    return true;
  }

  function chessBotTerminalScore(runtime, perspective, sideToMove) {
    if (chessKingInCheck(runtime, sideToMove)) {
      return sideToMove === perspective ? -1000000 : 1000000;
    }
    return 0;
  }

  function chessBotMoveOrderingScore(runtime, move) {
    var score = 0;
    var piece = move && move.piece ? move.piece : null;
    if (!piece) { return score; }
    var target = chessPieceAt(runtime, move.toFile, move.toRank) || chessEnPassantCapturedPiece(runtime, piece, move.toFile, move.toRank);
    var see = chessBotStaticExchangeScore(runtime, move);
    if (target) { score += (chessBotRoleValue(target.role) * 10) - chessBotRoleValue(piece.role) + (see * 3); }
    if (move.promotionRole) { score += chessBotRoleValue(move.promotionRole); }
    if (see < -80) { score -= 1200; }
    score += Math.max(0, 7 - chessBotCenterDistance(move.toFile, move.toRank));
    return score;
  }

  function chessBotMaterialBalanceForSide(runtime, side) {
    var own = 0;
    var enemy = 0;
    var ids = Object.keys(runtime.piecesByObjectId);
    for (var i = 0; i < ids.length; i += 1) {
      var piece = runtime.piecesByObjectId[ids[i]];
      if (!piece || piece.captured || String(piece.role || "") === "king") { continue; }
      if (piece.side === side) { own += chessBotRoleValue(piece.role); }
      else { enemy += chessBotRoleValue(piece.role); }
    }
    return own - enemy;
  }

  function chessBotPreMoveStrategicAdjustment(runtime, move, perspective) {
    var piece = move && move.piece ? move.piece : null;
    if (!piece) { return 0; }
    var target = chessPieceAt(runtime, move.toFile, move.toRank) || chessEnPassantCapturedPiece(runtime, piece, move.toFile, move.toRank);
    var adjustment = 0;
    var materialBalance = chessBotMaterialBalanceForSide(runtime, perspective);
    if (materialBalance < -220 && String(piece.role || "") === "queen" && target && String(target.role || "") === "queen") {
      adjustment -= Math.min(260, 90 + Math.round(Math.abs(materialBalance) * 0.08));
    }
    if (target) {
      var see = chessBotStaticExchangeScore(runtime, move);
      if (see < 0) { adjustment += see * 3; }
    }
    return adjustment;
  }

  function chessBotFindQueen(runtime, side) {
    var ids = Object.keys(runtime.piecesByObjectId);
    for (var i = 0; i < ids.length; i += 1) {
      var piece = runtime.piecesByObjectId[ids[i]];
      if (piece && !piece.captured && piece.side === side && String(piece.role || "") === "queen") {
        return piece;
      }
    }
    return null;
  }

  function chessBotPostMoveStrategicAdjustment(runtime, movedPiece, perspective, wasInCheck) {
    var adjustment = 0;
    var queen = chessBotFindQueen(runtime, perspective);
    var enemySide = chessBotOpponentSide(perspective);
    if (queen) {
      var queenAttacked = chessSquareAttackedBy(runtime, queen.file, queen.rank, enemySide);
      var queenDefended = chessSquareAttackedBy(runtime, queen.file, queen.rank, perspective);
      if (queenAttacked && !queenDefended) { adjustment -= wasInCheck ? 760 : 520; }
      else if (queenAttacked) { adjustment -= wasInCheck ? 340 : 220; }
      var leastEnemy = chessBotLeastValuableAttacker(runtime, enemySide, queen.file, queen.rank);
      if (leastEnemy && chessBotRoleValue(leastEnemy.role) < chessBotRoleValue("queen")) {
        adjustment -= Math.round((chessBotRoleValue("queen") - chessBotRoleValue(leastEnemy.role)) * (queenDefended ? 0.25 : 0.55));
      }
    } else {
      adjustment -= 900;
    }
    if (wasInCheck && movedPiece && String(movedPiece.role || "") === "king") {
      adjustment += 80;
    }
    return adjustment;
  }

  function chessBotOrderedMoveList(runtime, side) {
    return chessBotMoveList(runtime, side).sort(function (a, b) {
      return chessBotMoveOrderingScore(runtime, b) - chessBotMoveOrderingScore(runtime, a);
    });
  }

  function chessBotSearchTimedOut(context) {
    return !!(context &&
      ((context.deadlineMs && Date.now() >= context.deadlineMs) ||
        (context.nodeLimit && context.nodes >= context.nodeLimit)));
  }

  function chessBotStaticExchangeScore(runtime, move) {
    var piece = move && move.piece ? move.piece : null;
    if (!piece) { return 0; }
    var target = chessPieceAt(runtime, move.toFile, move.toRank) || chessEnPassantCapturedPiece(runtime, piece, move.toFile, move.toRank);
    var gain0 = target ? chessBotRoleValue(target.role) : 0;
    if (move.promotionRole) {
      gain0 += chessBotRoleValue(move.promotionRole) - chessBotRoleValue("pawn");
    }
    if (!target && !move.promotionRole) { return 0; }
    var snapshot = chessBotStateSnapshot(runtime);
    var gains = [gain0];
    if (!applyChessBotMoveState(runtime, move)) {
      restoreChessBotState(runtime, snapshot);
      return gain0;
    }
    var side = runtime.turn;
    var capturedValue = chessBotRoleValue(piece.role);
    for (var depth = 1; depth <= 8; depth += 1) {
      var attacker = chessBotLeastValuableAttacker(runtime, side, move.toFile, move.toRank);
      if (!attacker) { break; }
      gains[depth] = capturedValue - gains[depth - 1];
      capturedValue = chessBotRoleValue(attacker.role);
      attacker.captured = true;
      delete runtime.occupied[chessSquareKey(attacker.file, attacker.rank)];
      side = chessBotOpponentSide(side);
    }
    for (var i = gains.length - 1; i > 0; i -= 1) {
      gains[i - 1] = -Math.max(-gains[i - 1], gains[i]);
    }
    restoreChessBotState(runtime, snapshot);
    return gains[0] || 0;
  }

  function chessBotTacticalMoveList(runtime, side) {
    var moves = chessBotMoveList(runtime, side).filter(function (move) {
      return !!(
        chessPieceAt(runtime, move.toFile, move.toRank) ||
        chessEnPassantCapturedPiece(runtime, move.piece, move.toFile, move.toRank) ||
        move.promotionRole
      );
    });
    return moves.sort(function (a, b) {
      return chessBotMoveOrderingScore(runtime, b) - chessBotMoveOrderingScore(runtime, a);
    });
  }

  function chessBotQuiescenceScore(runtime, perspective, alpha, beta, context, qDepth) {
    if (context) { context.nodes = Number(context.nodes || 0) + 1; }
    var standPat = chessBotEvaluate(runtime, perspective);
    if (chessBotSearchTimedOut(context) || qDepth <= 0) { return standPat; }
    var side = runtime.turn;
    var maximizing = side === perspective;
    var best = standPat;
    var a = Number(alpha);
    var b = Number(beta);
    if (maximizing) {
      if (best >= b) { return best; }
      a = Math.max(a, best);
    } else {
      if (best <= a) { return best; }
      b = Math.min(b, best);
    }
    var moves = chessBotTacticalMoveList(runtime, side);
    for (var i = 0; i < moves.length; i += 1) {
      var see = chessBotStaticExchangeScore(runtime, moves[i]);
      if (see < -70 && !moves[i].promotionRole) { continue; }
      var snapshot = chessBotStateSnapshot(runtime);
      if (!applyChessBotMoveState(runtime, moves[i])) {
        restoreChessBotState(runtime, snapshot);
        continue;
      }
      var score = chessBotQuiescenceScore(runtime, perspective, a, b, context, qDepth - 1);
      restoreChessBotState(runtime, snapshot);
      if (maximizing) {
        best = Math.max(best, score);
        a = Math.max(a, best);
      } else {
        best = Math.min(best, score);
        b = Math.min(b, best);
      }
      if (b <= a || chessBotSearchTimedOut(context)) { break; }
    }
    return best;
  }

  function chessBotMinimaxScore(runtime, depth, perspective, alpha, beta, context) {
    if (context) { context.nodes = Number(context.nodes || 0) + 1; }
    if (chessBotSearchTimedOut(context)) { return chessBotEvaluate(runtime, perspective); }
    if (depth <= 0) { return chessBotQuiescenceScore(runtime, perspective, alpha, beta, context, 3); }
    var side = runtime.turn;
    var moves = chessBotOrderedMoveList(runtime, side);
    if (!moves.length) { return chessBotTerminalScore(runtime, perspective, side); }
    var maximizing = side === perspective;
    var best = maximizing ? -Infinity : Infinity;
    var a = Number(alpha);
    var b = Number(beta);
    for (var i = 0; i < moves.length; i += 1) {
      var snapshot = chessBotStateSnapshot(runtime);
      if (!applyChessBotMoveState(runtime, moves[i])) {
        restoreChessBotState(runtime, snapshot);
        continue;
      }
      var score = chessBotMinimaxScore(runtime, depth - 1, perspective, a, b, context);
      restoreChessBotState(runtime, snapshot);
      if (maximizing) {
        best = Math.max(best, score);
        a = Math.max(a, best);
      } else {
        best = Math.min(best, score);
        b = Math.min(b, best);
      }
      if (b <= a) { break; }
      if (chessBotSearchTimedOut(context)) { break; }
    }
    return best;
  }

  function chessBotRandomJitter(runtime, move) {
    var cfg = runtime && runtime.cfg ? runtime.cfg : {};
    var amount = Math.max(0, Number(cfg.bot_random_cp || 10) || 10);
    if (amount <= 0) { return 0; }
    var oid = Number(move && move.piece && move.piece.object_id || 0) || 0;
    var seed = ((Date.now() & 0xffff) ^ (oid * 1103) ^ (Number(move && move.toFile || 0) * 97) ^ (Number(move && move.toRank || 0) * 193)) >>> 0;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return ((seed / 4294967295) * 2.0 - 1.0) * amount;
  }

  function chessBotChooseEquivalentBestMove(runtime, scoredMoves) {
    if (!Array.isArray(scoredMoves) || !scoredMoves.length) { return null; }
    var cfg = runtime && runtime.cfg ? runtime.cfg : {};
    var margin = Math.max(0, Number(cfg.bot_random_equal_cp || 18) || 18);
    var bestScore = scoredMoves[0].score;
    for (var i = 1; i < scoredMoves.length; i += 1) {
      bestScore = Math.max(bestScore, Number(scoredMoves[i].score || -Infinity));
    }
    var equivalents = [];
    for (var j = 0; j < scoredMoves.length; j += 1) {
      if (bestScore - Number(scoredMoves[j].score || -Infinity) <= margin) {
        equivalents.push(scoredMoves[j]);
      }
    }
    equivalents.sort(function (a, b) { return Number(b.score || 0) - Number(a.score || 0); });
    if (equivalents.length > 10) { equivalents = equivalents.slice(0, 10); }
    if (equivalents.length <= 1) { return equivalents[0] ? equivalents[0].move : scoredMoves[0].move; }
    var index = Math.floor(Math.random() * equivalents.length);
    return equivalents[Math.max(0, Math.min(equivalents.length - 1, index))].move;
  }

  function chessBotBestMove(runtime) {
    var perspective = runtime.turn;
    var rootWasInCheck = chessKingInCheck(runtime, perspective);
    var moves = chessBotOrderedMoveList(runtime, perspective);
    var cfg = runtime && runtime.cfg ? runtime.cfg : {};
    var maxDepth = Math.max(1, Math.min(6, Number(cfg.bot_search_plies || 4) || 4));
    var thinkMs = Math.max(120, Math.min(1400, Number(cfg.bot_search_ms || 900) || 900));
    var context = {
      deadlineMs: Date.now() + thinkMs,
      nodeLimit: Math.max(800, Number(cfg.bot_node_limit || 12000) || 12000),
      nodes: 0
    };
    var best = moves.length ? { score: -Infinity, move: moves[0] } : null;
    var bestDepthScores = best ? [best] : [];
    for (var depth = 1; depth <= maxDepth; depth += 1) {
      var depthBest = null;
      var depthScores = [];
      for (var i = 0; i < moves.length; i += 1) {
        var preAdjustment = chessBotPreMoveStrategicAdjustment(runtime, moves[i], perspective);
        var snapshot = chessBotStateSnapshot(runtime);
        var movingPiece = moves[i] && moves[i].piece ? moves[i].piece : null;
        if (!applyChessBotMoveState(runtime, moves[i])) {
          restoreChessBotState(runtime, snapshot);
          continue;
        }
        var score = chessBotMinimaxScore(runtime, depth - 1, perspective, -Infinity, Infinity, context) +
          preAdjustment +
          chessBotPostMoveStrategicAdjustment(runtime, movingPiece, perspective, rootWasInCheck);
        restoreChessBotState(runtime, snapshot);
        depthScores.push({ score: score, move: moves[i] });
        if (!depthBest || score > depthBest.score) {
          depthBest = { score: score, move: moves[i] };
        }
        if (chessBotSearchTimedOut(context)) { break; }
      }
      if (depthBest) {
        best = depthBest;
        bestDepthScores = depthScores;
      }
      if (chessBotSearchTimedOut(context)) { break; }
      if (depth >= 3 && Date.now() + 120 >= context.deadlineMs) { break; }
      }
    return chessBotChooseEquivalentBestMove(runtime, bestDepthScores) || (best ? best.move : null);
  }

  function chessSideHasLegalMove(runtime, side) {
    var previousTurn = runtime.turn;
    runtime.turn = side;
    try {
      var ids = Object.keys(runtime.piecesByObjectId);
      for (var i = 0; i < ids.length; i += 1) {
        var piece = runtime.piecesByObjectId[ids[i]];
        if (!piece || piece.captured || piece.side !== side) { continue; }
        for (var rank = 1; rank <= 8; rank += 1) {
          for (var file = 1; file <= 8; file += 1) {
            if (chessLegalMove(runtime, piece, file, rank)) { return true; }
          }
        }
      }
      return false;
    } finally {
      runtime.turn = previousTurn;
    }
  }

  function chessNotation(piece, target, toFile, toRank, enPassantCaptured, fromFile) {
    var role = String(piece.role || "pawn");
    var prefix = role === "pawn" ? "" : role.charAt(0).toUpperCase();
    var fileName = "abcdefgh".charAt(Math.max(0, Math.min(7, Number(toFile) - 1)));
    if (role === "pawn" && (target || enPassantCaptured)) {
      var fromFileName = "abcdefgh".charAt(Math.max(0, Math.min(7, Number(fromFile || piece.file) - 1)));
      return fromFileName + "x" + fileName + String(toRank);
    }
    return prefix + (target ? "x" : "") + fileName + String(toRank);
  }

  function chessMoveNotation(runtime, piece, target, toFile, toRank, castle, enPassantCaptured, fromFile) {
    var notation = castle ? castle.notation : chessNotation(piece, target, toFile, toRank, enPassantCaptured, fromFile);
    var enemySide = piece.side === "white" ? "black" : "white";
    if (!chessKingInCheck(runtime, enemySide)) { return notation; }
    return notation + (chessSideHasLegalMove(runtime, enemySide) ? "+" : "++");
  }

  function chessEndWinningSide(result) {
    if (result === "white_win") { return "white"; }
    if (result === "black_win") { return "black"; }
    return "";
  }

  function chessEndMatedKing(runtime, result) {
    var winningSide = chessEndWinningSide(result);
    if (!winningSide) { return null; }
    return chessFindKing(runtime, winningSide === "white" ? "black" : "white");
  }

  function chessFallDirectionSeed(runtime, piece) {
    var moveCount = runtime && Array.isArray(runtime.moves) ? runtime.moves.length : 0;
    var oid = Number(piece && piece.object_id || 0) || 0;
    return (moveCount * 37 + oid * 17 + Number(piece && piece.file || 0) * 11 + Number(piece && piece.rank || 0) * 7) | 0;
  }

  function chessMatedKingFallPose(runtime, king) {
    var origin = pieceBoardCenter(king, 0.0);
    var candidates = [
      [2, 1], [2, -1], [-2, 1], [-2, -1],
      [1, 2], [1, -2], [-1, 2], [-1, -2]
    ];
    var seed = chessFallDirectionSeed(runtime, king);
    var best = null;
    var ids = runtime && runtime.piecesByObjectId ? Object.keys(runtime.piecesByObjectId) : [];
    var kingRadius = Math.max(0.22, chessPieceFootprintRadius(king));
    var fallDistance = Math.max(0.74, kingRadius * 2.2);
    for (var i = 0; i < candidates.length; i += 1) {
      var cand = candidates[(i + Math.abs(seed)) % candidates.length];
      var len = Math.max(0.0001, Math.sqrt((cand[0] * cand[0]) + (cand[1] * cand[1])));
      var dx = cand[0] / len;
      var dy = cand[1] / len;
      var distance = fallDistance;
      var target = [
        Math.max(-3.72, Math.min(3.72, origin[0] + (dx * distance))),
        Math.max(-3.72, Math.min(3.72, origin[1] + (dy * distance))),
        Number(origin[2] || 0.0)
      ];
      var clearance = 99.0;
      for (var p = 0; p < ids.length; p += 1) {
        var other = runtime.piecesByObjectId[ids[p]];
        if (!other || other === king || other.captured || other.in_capture_tray || !other.mesh) { continue; }
        var otherCenter = toVec3(entityProp(other.mesh, "center", pieceBoardCenter(other, 0.0)), pieceBoardCenter(other, 0.0));
        var ox = Number(otherCenter[0] || 0.0) - target[0];
        var oy = Number(otherCenter[1] || 0.0) - target[1];
        clearance = Math.min(clearance, Math.sqrt((ox * ox) + (oy * oy)) - kingRadius - chessPieceFootprintRadius(other));
      }
      var edgePenalty = Math.abs(target[0] - (origin[0] + dx * distance)) + Math.abs(target[1] - (origin[1] + dy * distance));
      var score = clearance - (edgePenalty * 2.0);
      if (!best || score > best.score) {
        best = { direction: [dx, dy], center: target, score: score };
      }
    }
    var dir = best ? best.direction : [1.0, 0.0];
    var axis = [-dir[1], dir[0], 0.0];
    var baseModel = matrixForMesh({
      center: toVec3(entityProp(king.mesh, "center", origin), origin),
      rotation: toVec3(entityProp(king.mesh, "rotation", king.start_rotation || [0.0, 0.0, 0.0]), [0.0, 0.0, 0.0]),
      scale: [1.0, 1.0, 1.0]
    });
    var pivot = chessPieceFallContactPivot(king, baseModel, dir, origin);
    return {
      center: best ? best.center : origin,
      direction: dir,
      pivot: pivot,
      axis: axis,
      angle_rad: Math.PI * 0.58,
      base_model: baseModel,
      base_center: origin,
      base_rotation: toVec3(entityProp(king.mesh, "rotation", king.start_rotation || [0.0, 0.0, 0.0]), [0.0, 0.0, 0.0])
    };
  }

  function chessEndTargetCenter(runtime, piece, result) {
    var side = String(piece && piece.side || "");
    if (String(piece && piece.role || "") === "king") {
      if (result === "white_win" && side === "white") { return [0.0, 0.0, Number(piece.base_z || 0.065) || 0.065]; }
      if (result === "black_win" && side === "black") { return [0.0, 0.0, Number(piece.base_z || 0.065) || 0.065]; }
      if (result === "draw") {
        return side === "white"
          ? [-0.45, 0.0, Number(piece.base_z || 0.065) || 0.065]
          : [0.45, 0.0, Number(piece.base_z || 0.065) || 0.065];
      }
    }
    return [chessBoardX(piece.start_file), chessBoardY(piece.start_rank), Number(piece.base_z || 0.065) || 0.065];
  }

  function startChessEndAnimation(runtime, result) {
    if (!runtime || runtime.gameOver) { return; }
    runtime.gameOver = String(result || "draw");
    runtime.pendingEndResult = "";
    runtime.pendingEndPieceObjectId = 0;
    runtime.selected = null;
    runtime.hoverSquare = null;
    runtime.hoverPiece = null;
    runtime.hoverPromotion = null;
    clearChessPromotionOptions(runtime);
    var now = global.performance && typeof global.performance.now === "function" ? global.performance.now() : Date.now();
    runtime.endSequence = {
      result: runtime.gameOver,
      stage: runtime.gameOver === "draw" ? "wait_before_center" : "wait_before_fall",
      due_ms: now + 1000.0
    };
    resetChessHighlights(runtime, { skipPieceRefresh: true });
    updateChessPanel(runtime);
    markChessSceneDirty(runtime);
    if (runtime.gameOver !== "draw") {
      startChessMatedKingFall(runtime);
    }
    requestChessInteractionFrame(runtime);
  }

  function chessPendingEndPieceAnimating(runtime) {
    var oid = Number(runtime && runtime.pendingEndPieceObjectId || 0) || 0;
    if (!oid || !Array.isArray(runtime.animations)) { return false; }
    for (var i = 0; i < runtime.animations.length; i += 1) {
      var anim = runtime.animations[i];
      if (anim && anim.piece && Number(anim.piece.object_id || 0) === oid) {
        return true;
      }
    }
    return false;
  }

  function startChessMatedKingFall(runtime) {
    if (!runtime || !runtime.endSequence) { return; }
    var matedKing = chessEndMatedKing(runtime, runtime.endSequence.result);
    var matedFallPose = matedKing ? chessMatedKingFallPose(runtime, matedKing) : null;
    if (!matedKing || !matedFallPose) {
      runtime.endSequence.stage = "wait_before_center";
      runtime.endSequence.due_ms = (global.performance && typeof global.performance.now === "function" ? global.performance.now() : Date.now()) + 1000.0;
      return;
    }
    var fromCenter = toVec3(entityProp(matedKing.mesh, "center", pieceBoardCenter(matedKing, 0.0)), pieceBoardCenter(matedKing, 0.0));
    queueChessAnimation(runtime, matedKing, [fromCenter, fromCenter], null, {
      fall_pose: matedFallPose,
      duration_ms: 760.0,
      easing: "king_fall"
    });
    runtime.endSequence.stage = "falling";
    markChessSceneDirty(runtime);
    requestChessInteractionFrame(runtime);
  }

  function startChessEndCenterAnimation(runtime) {
    if (!runtime || !runtime.endSequence) { return; }
    var result = String(runtime.endSequence.result || runtime.gameOver || "draw");
    var matedKing = chessEndMatedKing(runtime, result);
    var ids = Object.keys(runtime.piecesByObjectId);
    for (var i = 0; i < ids.length; i += 1) {
      var piece = runtime.piecesByObjectId[ids[i]];
      if (!piece || !piece.mesh) { continue; }
      if (piece.start_role === "pawn" && piece.role !== "pawn") {
        replaceChessPieceRoleMesh(runtime, piece, "pawn");
      }
      piece.captured = false;
      piece.captured_by = "";
      piece.in_capture_tray = false;
      piece.capture_order = 0;
      piece.capture_tray_index = -1;
      piece.capture_tray_center = null;
      setEntityProp(piece.mesh, "visible", true);
      setEntityProp(piece.mesh, "pickable", true);
      setEntityProp(piece.mesh, "color", pieceBaseColor(piece));
      var fromCenter = toVec3(entityProp(piece.mesh, "center", pieceBoardCenter(piece, 0.0)), pieceBoardCenter(piece, 0.0));
      if (piece !== matedKing || result === "draw") {
        piece.file = piece.start_file;
        piece.rank = piece.start_rank;
        piece.mesh._modelMatrix = null;
        setEntityProp(piece.mesh, "transform", null);
        setEntityProp(piece.mesh, "rotation", cloneJsonValue(piece.start_rotation || entityProp(piece.start_mesh || piece.mesh, "rotation", [0.0, 0.0, 0.0])));
        var toCenter = chessEndTargetCenter(runtime, piece, result);
        queueChessAnimation(runtime, piece, [fromCenter, toCenter], null);
      }
    }
    runtime.endSequence.stage = "centering";
    rebuildChessOccupancy(runtime);
    resetChessHighlights(runtime, { skipPieceRefresh: true });
    updateChessPanel(runtime);
    markChessSceneDirty(runtime);
    requestChessInteractionFrame(runtime);
  }

  function advanceChessEndSequence(runtime, now) {
    if (!runtime || !runtime.endSequence) { return false; }
    var seq = runtime.endSequence;
    var stage = String(seq.stage || "");
    if (stage === "wait_before_fall" || stage === "wait_before_center") {
      if (now < Number(seq.due_ms || 0.0)) { return true; }
      if (stage === "wait_before_fall") {
        startChessMatedKingFall(runtime);
      } else {
        startChessEndCenterAnimation(runtime);
      }
      return true;
    }
    if (stage === "falling") {
      runtime.endSequence.stage = "wait_before_center";
      runtime.endSequence.due_ms = now + 1000.0;
      return true;
    }
    if (stage === "centering") {
      runtime.endSequence = null;
    }
    return false;
  }

  function chessAnimationEase(anim, t) {
    var mode = String(anim && anim.easing || "linear");
    var x = Math.max(0.0, Math.min(1.0, Number(t || 0.0) || 0.0));
    if (mode !== "king_fall") { return x; }
    if (x < 0.78) {
      var fallT = x / 0.78;
      return 1.0 - Math.cos(fallT * Math.PI * 0.5);
    }
    var bounceT = (x - 0.78) / 0.22;
    return 1.0 + (Math.sin(bounceT * Math.PI) * 0.14 * (1.0 - bounceT));
  }

  function finishChessMoveResult(runtime, moverSide) {
    var drawByRule = chessDrawRuleResult(runtime);
    if (drawByRule) { return drawByRule; }
    var enemySide = moverSide === "white" ? "black" : "white";
    if (chessSideHasLegalMove(runtime, enemySide)) { return ""; }
    return chessKingInCheck(runtime, enemySide)
      ? (moverSide === "white" ? "white_win" : "black_win")
      : "draw";
  }

  function setChessSquareVisualState(mesh, stateName, fallbackColor) {
    if (!mesh) { return; }
    if (applyEntityStateEmbedding(mesh, stateName)) { return; }
    if (String(stateName || "") === "idle") {
      setEntityProp(mesh, "color", [0.2, 1.0, 0.2, 0.0]);
      setEntityProp(mesh, "visible", false);
      setEntityProp(mesh, "alpha", 0.0);
      setEntityProp(mesh, "pickable", false);
      return;
    }
    raiseChessHighlightMesh(mesh);
    setEntityProp(mesh, "visible", true);
    setEntityProp(mesh, "color", fallbackColor || [0.45, 1.0, 0.45, 0.36]);
    setEntityProp(mesh, "alpha", Number((fallbackColor || [0, 0, 0, 0.36])[3] || 0.36) || 0.36);
    setEntityProp(mesh, "transparent", true);
    setEntityProp(mesh, "depth_write", false);
    setEntityProp(mesh, "pickable", false);
  }

  function resetChessHighlights(runtime, options) {
    options = options && typeof options === "object" ? options : {};
    clearChessSquareRegionStates(runtime);
    if (options.skipPieceRefresh !== true) {
      refreshChessPieceSelectionPose(runtime);
    }
    if (runtime.hoverSquare && runtime.selected) {
      var sameAsSelected = runtime.selected &&
        Number(runtime.selected.file) === Number(runtime.hoverSquare.file) &&
        Number(runtime.selected.rank) === Number(runtime.hoverSquare.rank);
      if (sameAsSelected) {
        if (!updateChessBoardHighlightsFast(runtime)) {
          markChessSceneDirty(runtime);
        }
        return;
      }
      var legal = chessLegalMove(runtime, runtime.selected, runtime.hoverSquare.file, runtime.hoverSquare.rank);
      var stateName = legal ? "legal" : "illegal";
      var fallbackColor = legal
        ? (runtime.cfg.square_highlight_legal || [0.42, 0.88, 0.36, 0.58])
        : (runtime.cfg.square_highlight_illegal || [0.90, 0.20, 0.12, 0.62]);
      setChessSquareRegionState(runtime, runtime.hoverSquare.file, runtime.hoverSquare.rank, stateName, fallbackColor);
    }
    if (!updateChessBoardHighlightsFast(runtime)) {
      markChessSceneDirty(runtime);
    }
  }

  function raiseChessHighlightMesh(mesh) {
    var center = toVec3(entityProp(mesh, "center", [0.0, 0.0, 0.0]), [0.0, 0.0, 0.0]);
    center[2] = Math.max(Number(center[2] || 0.0), 0.12);
    setEntityProp(mesh, "center", center);
  }

  function pieceBoardCenter(piece, lift) {
    var baseZ = Number(piece && piece.base_z != null ? piece.base_z : 0.065) || 0.065;
    return [chessBoardX(piece.file), chessBoardY(piece.rank), baseZ + Math.max(0.0, Number(lift || 0.0) || 0.0)];
  }

  function targetPieceIsSelectable(runtime, piece) {
    return !!(!runtime.gameOver && !runtime.promotion && piece && piece.side === runtime.turn && !piece.captured);
  }

  function pieceBaseColor(piece) {
    return piece && piece.side === "black"
      ? [0.34, 0.22, 0.13, 1.0]
      : [1.0, 0.96, 0.78, 1.0];
  }

  function blendRgba(base, tint, amount) {
    var a = Math.max(0.0, Math.min(1.0, Number(amount || 0.0) || 0.0));
    return [
      (base[0] * (1.0 - a)) + (tint[0] * a),
      (base[1] * (1.0 - a)) + (tint[1] * a),
      (base[2] * (1.0 - a)) + (tint[2] * a),
      base[3]
    ];
  }

  function pieceInteractionColor(piece, hovered, selected) {
    var color = pieceBaseColor(piece);
    if (hovered) {
      color = blendRgba(color, [0.34, 0.70, 1.0, 1.0], 0.38);
    }
    if (selected) {
      color = blendRgba(color, [0.28, 0.78, 1.0, 1.0], 0.56);
    }
    return color;
  }

  function applyChessPieceInteractionVisual(runtime, mesh, side, hovered, selected, baseCenter) {
    if (!mesh) { return; }
    var center = Array.isArray(baseCenter)
      ? baseCenter.slice()
      : toVec3(entityProp(mesh, "center", [0.0, 0.0, 0.0]), [0.0, 0.0, 0.0]);
    setEntityProp(mesh, "center", center);
    setEntityProp(mesh, "color", pieceInteractionColor({ side: side }, hovered, selected));
    setEntityProp(mesh, "use_vertex_color", false);
    setEntityProp(mesh, "static_vertices", false);
    setEntityProp(mesh, "static_indices", false);
    delete mesh.__vfSmoothFieldMeshSource;
    delete mesh.__vfSmoothFieldMeshIndices;
    delete mesh.__vfSmoothFieldMeshVertices;
    setEntityProp(mesh, "specular_strength", (hovered || selected)
      ? Number(runtime.cfg.selected_piece_specular_strength || 0.08) || 0.08
      : Math.max(0.12, Number(runtime.cfg.piece_specular_strength || 0.055) || 0.055));
  }

  function chessPromotionRoles() {
    return ["queen", "rook", "bishop", "knight"];
  }

  function chessPieceLetter(role) {
    role = String(role || "");
    if (role === "queen") { return "Q"; }
    if (role === "rook") { return "R"; }
    if (role === "bishop") { return "B"; }
    if (role === "knight") { return "N"; }
    if (role === "king") { return "K"; }
    return "";
  }

  function chessIsPromotionMove(piece, toRank) {
    return !!(piece && String(piece.role || "") === "pawn" &&
      ((piece.side === "white" && Number(toRank) === 8) || (piece.side === "black" && Number(toRank) === 1)));
  }

  function chessPromotionNotation(piece, target, toFile, toRank, promotionRole) {
    var fileName = "abcdefgh".charAt(Math.max(0, Math.min(7, Number(toFile) - 1)));
    var fromFileName = "abcdefgh".charAt(Math.max(0, Math.min(7, Number(piece && piece.file || 1) - 1)));
    var prefix = target ? (fromFileName + "x") : "";
    return prefix + fileName + String(toRank) + "=" + chessPieceLetter(promotionRole);
  }

  function chessRoleTemplateMesh(runtime, side, role) {
    if (!runtime || !runtime.pieceTemplateMeshes) { return null; }
    return runtime.pieceTemplateMeshes[String(side || "") + ":" + String(role || "")] || null;
  }

  function chessClonePromotionMesh(runtime, side, role, objectId, center) {
    var template = chessRoleTemplateMesh(runtime, side, role);
    if (!template) {
      failFast("promotion option missing mesh template for " + String(side) + " " + String(role));
    }
    var mesh = cloneJsonValue(template);
    setEntityProp(mesh, "id", "promotion_" + String(side) + "_" + String(role) + "_" + String(objectId));
    setEntityProp(mesh, "object_id", objectId);
    setEntityProp(mesh, "center", center);
    setEntityProp(mesh, "visible", true);
    setEntityProp(mesh, "color", pieceBaseColor({ side: side }));
    setEntityProp(mesh, "specular_strength", Math.max(0.12, Number(runtime.cfg.piece_specular_strength || 0.055) || 0.055));
    setEntityProp(mesh, "casts_shadow", true);
    setEntityProp(mesh, "receives_shadow", true);
    setEntityProp(mesh, "pickable", true);
    setEntityProp(mesh, "use_vertex_color", false);
    setEntityProp(mesh, "static_vertices", false);
    setEntityProp(mesh, "static_indices", false);
    delete mesh.__vfSmoothFieldMeshSource;
    delete mesh.__vfSmoothFieldMeshIndices;
    delete mesh.__vfSmoothFieldMeshVertices;
    return mesh;
  }

  function clearChessPromotionOptions(runtime) {
    if (!runtime) { return; }
    var options = Array.isArray(runtime.promotionOptions) ? runtime.promotionOptions : [];
    if (Array.isArray(config.meshes) && options.length) {
      config.meshes = config.meshes.filter(function (mesh) {
        var oid = Number(entityProp(mesh, "object_id", 0) || 0);
        return !runtime.promotionOptionsByObjectId || !runtime.promotionOptionsByObjectId[String(oid)];
      });
    }
    runtime.promotionOptions = [];
    runtime.promotionOptionsByObjectId = Object.create(null);
    runtime.hoverPromotion = null;
    if (runtime.meshByObjectId) {
      for (var meshIdIndex = 0; meshIdIndex < options.length; meshIdIndex += 1) {
        var optionObjectId = Number(options[meshIdIndex] && options[meshIdIndex].object_id || 0) || 0;
        if (optionObjectId) { delete runtime.meshByObjectId[String(optionObjectId)]; }
      }
    }
  }

  function removeMeshFromScene(mesh) {
    if (!mesh || !Array.isArray(config.meshes)) { return; }
    config.meshes = config.meshes.filter(function (candidate) { return candidate !== mesh; });
  }

  function keepChosenPromotionMesh(runtime, chosenOption) {
    if (!runtime) { return; }
    var chosenMesh = chosenOption && chosenOption.mesh ? chosenOption.mesh : null;
    var options = Array.isArray(runtime.promotionOptions) ? runtime.promotionOptions : [];
    for (var i = 0; i < options.length; i += 1) {
      var option = options[i];
      if (!option || !option.mesh || option.mesh === chosenMesh) { continue; }
      removeMeshFromScene(option.mesh);
      if (runtime.meshByObjectId) {
        delete runtime.meshByObjectId[String(option.object_id || 0)];
      }
    }
    runtime.promotionOptions = [];
    runtime.promotionOptionsByObjectId = Object.create(null);
    runtime.hoverPromotion = null;
  }

  function refreshChessPromotionOptions(runtime) {
    if (!runtime || !Array.isArray(runtime.promotionOptions)) { return; }
    for (var i = 0; i < runtime.promotionOptions.length; i += 1) {
      var option = runtime.promotionOptions[i];
      var hovered = runtime.hoverPromotion === option;
      var baseCenter = Array.isArray(option.base_center) ? option.base_center : toVec3(entityProp(option.mesh, "center", [0.0, 0.0, 0.0]), [0.0, 0.0, 0.0]);
      applyChessPieceInteractionVisual(runtime, option.mesh, option.side, hovered, false, baseCenter);
    }
  }

  function startChessPromotion(runtime, piece, target, fromFile, fromRank, toFile, toRank) {
    clearChessPromotionOptions(runtime);
    var roles = chessPromotionRoles();
    var baseY = chessBoardY(toRank);
    var baseX = chessBoardX(toFile);
    var boardZ = Number(piece.base_z || 0.065) || 0.065;
    var promotionUnitHeight = 1.0;
    var promotionSpacing = 0.82;
    runtime.promotion = {
      piece: piece,
      target: target || null,
      fromFile: Number(fromFile),
      fromRank: Number(fromRank),
      toFile: Number(toFile),
      toRank: Number(toRank),
      baseCenter: [baseX, baseY, boardZ + promotionUnitHeight]
    };
    runtime.promotionOptions = [];
    runtime.promotionOptionsByObjectId = Object.create(null);
    for (var i = 0; i < roles.length; i += 1) {
      var role = roles[i];
      var objectId = Number(runtime.nextPromotionObjectId || 900000) + i;
      var center = [baseX + (i * promotionSpacing), baseY, boardZ + promotionUnitHeight];
      var mesh = chessClonePromotionMesh(runtime, piece.side, role, objectId, center);
      var option = { kind: "promotion", role: role, side: piece.side, object_id: objectId, mesh: mesh, base_center: center.slice() };
      runtime.promotionOptions.push(option);
      runtime.promotionOptionsByObjectId[String(objectId)] = option;
      runtime.meshByObjectId[String(objectId)] = mesh;
      config.meshes.push(mesh);
    }
    runtime.nextPromotionObjectId = Number(runtime.nextPromotionObjectId || 900000) + roles.length;
    runtime.selected = null;
    refreshChessPromotionOptions(runtime);
    markChessSceneDirty(runtime);
  }

  function replaceChessPieceRoleMesh(runtime, piece, role) {
    var template = chessRoleTemplateMesh(runtime, piece.side, role);
    if (!template) {
      failFast("promotion replacement missing mesh template for " + String(piece.side) + " " + String(role));
    }
    var center = toVec3(entityProp(piece.mesh, "center", pieceBoardCenter(piece, 0.0)), pieceBoardCenter(piece, 0.0));
    setEntityProp(piece.mesh, "vertices", cloneJsonValue(entityProp(template, "vertices", [])));
    setEntityProp(piece.mesh, "indices", cloneJsonValue(entityProp(template, "indices", [])));
    piece.mesh._modelMatrix = null;
    setEntityProp(piece.mesh, "transform", null);
    setEntityProp(piece.mesh, "rotation", cloneJsonValue(entityProp(template, "rotation", [0.0, 0.0, 0.0])));
    setEntityProp(piece.mesh, "center", center);
    piece.role = String(role || "queen");
    setEntityProp(piece.mesh, "color", pieceBaseColor(piece));
  }

  function completeChessPromotion(runtime, option) {
    if (!runtime || !runtime.promotion || !option) { return false; }
    var pending = runtime.promotion;
    var piece = pending.piece;
    var promotionRole = String(option.role || "queen");
    var oldMesh = piece.mesh;
    var chosenMesh = option.mesh;
    if (!chosenMesh) {
      failFast("promotion completion missing selected option mesh");
    }
    keepChosenPromotionMesh(runtime, option);
    removeMeshFromScene(oldMesh);
    delete runtime.meshByObjectId[String(option.object_id || 0)];
    setEntityProp(chosenMesh, "object_id", piece.object_id);
    setEntityProp(chosenMesh, "id", String(entityProp(oldMesh, "id", "piece_" + String(piece.object_id))));
    setEntityProp(chosenMesh, "visible", true);
    setEntityProp(chosenMesh, "pickable", true);
    setEntityProp(chosenMesh, "color", pieceBaseColor({ side: piece.side }));
    setEntityProp(chosenMesh, "specular_strength", Number(runtime.cfg.piece_specular_strength || 0.055) || 0.055);
    runtime.meshByObjectId[String(piece.object_id)] = chosenMesh;
    piece.mesh = chosenMesh;
    piece.role = promotionRole;
    var fromCenter = toVec3(entityProp(chosenMesh, "center", pieceBoardCenter(piece, 0.0)), pieceBoardCenter(piece, 0.0));
    var abovePawnCenter = Array.isArray(pending.baseCenter) ? pending.baseCenter.slice() : [chessBoardX(pending.toFile), chessBoardY(pending.toRank), fromCenter[2]];
    var toCenter = pieceBoardCenter(piece, 0.0);
    queueChessAnimation(runtime, piece, [fromCenter, abovePawnCenter, toCenter], null);
    var enemySide = piece.side === "white" ? "black" : "white";
    var notation = chessPromotionNotation(
      { side: piece.side, role: "pawn", file: pending.fromFile, rank: pending.fromRank },
      pending.target,
      pending.toFile,
      pending.toRank,
      promotionRole
    );
    if (chessKingInCheck(runtime, enemySide)) {
      notation += chessSideHasLegalMove(runtime, enemySide) ? "+" : "++";
    }
    commitChessMove(runtime, notation);
    runtime.turn = runtime.turn === "white" ? "black" : "white";
    updateChessDrawCountersAfterMove(runtime, { role: "pawn" }, pending.target || null);
    var promotionResult = finishChessMoveResult(runtime, piece.side);
    runtime.pendingAutoSwitchSide = String(runtime.turn || "white");
    runtime.pendingEndResult = promotionResult || "";
    runtime.pendingEndPieceObjectId = promotionResult ? (Number(piece.object_id || 0) || 0) : 0;
    recordChessHistorySnapshot(runtime);
    runtime.promotion = null;
    refreshChessPieceSelectionPose(runtime);
    resetChessHighlights(runtime);
    updateChessPanel(runtime);
    markChessSceneDirty(runtime);
    requestChessInteractionFrame(runtime);
    scheduleChessBotTurn(runtime, chessBotDelayMs(runtime));
    return true;
  }

  function refreshChessPieceSelectionPose(runtime) {
    var ids = Object.keys(runtime.piecesByObjectId);
    for (var i = 0; i < ids.length; i += 1) {
      var piece = runtime.piecesByObjectId[ids[i]];
      if (!piece || piece.captured || !piece.mesh) { continue; }
      if (piece._animating === true) { continue; }
      var selected = piece === runtime.selected;
      var hovered = piece === runtime.hoverPiece;
      applyChessPieceInteractionVisual(runtime, piece.mesh, piece.side, hovered, selected, pieceBoardCenter(piece, 0.0));
    }
    markChessSceneDirty(runtime);
  }

  function formatChessClock(ms) {
    var total = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
    var minutes = Math.floor(total / 60);
    var seconds = total % 60;
    return String(minutes) + ":" + (seconds < 10 ? "0" : "") + String(seconds);
  }

  function parseChessClockText(text, fallbackMs) {
    var raw = String(text || "").trim();
    var parts = raw.split(":");
    if (parts.length === 2) {
      var minutes = Math.max(0, Number(parts[0]) || 0);
      var seconds = Math.max(0, Math.min(59, Number(parts[1]) || 0));
      return Math.round(((minutes * 60) + seconds) * 1000);
    }
    var numericMinutes = Number(raw);
    if (Number.isFinite(numericMinutes) && numericMinutes >= 0) {
      return Math.round(numericMinutes * 60 * 1000);
    }
    return Math.max(0, Number(fallbackMs || 0) || 0);
  }

  function beginInlineClockEdit(runtime, input) {
    if (!runtime || !runtime.clock || !input) { return; }
    if (runtime.clock.running === true) {
      try { input.blur(); } catch (_) {}
      return;
    }
    var sideName = String(input.getAttribute("data-vf-chess-clock-side") || "white") === "black" ? "black" : "white";
    runtime.clock.editing_side = sideName;
    runtime.clock.editing_value = String(input.value || "");
    runtime.clock.last_tick_ms = 0.0;
    try { input.select(); } catch (_) {}
  }

  function commitInlineClockEdit(runtime, input, commit) {
    if (!runtime || !runtime.clock || !input) { return; }
    var sideName = String(input.getAttribute("data-vf-chess-clock-side") || "white") === "black" ? "black" : "white";
    var key = sideName + "_ms";
    if (commit === true) {
      runtime.clock[key] = parseChessClockText(input.value, runtime.clock[key]);
      if (runtime.clock.running !== true && runtime.moves && runtime.moves.length === 0 && Number(runtime.currentMoveIndex || 0) === 0) {
        runtime.clock["start_" + key] = runtime.clock[key];
      }
    } else if (runtime.clock.editing_value != null) {
      input.value = String(runtime.clock.editing_value || "");
    }
    runtime.clock.editing_side = "";
    runtime.clock.editing_value = "";
    runtime.clock.last_tick_ms = 0.0;
    updateChessPanel(runtime);
  }

  function attachInlineClockEditor(runtime, input) {
    if (!input || input.__vfInlineClockEditorAttached === true) { return; }
    input.__vfInlineClockEditorAttached = true;
    input.addEventListener("focus", function () {
      beginInlineClockEdit(runtime, input);
    });
    input.addEventListener("blur", function () {
      commitInlineClockEdit(runtime, input, true);
    });
    input.addEventListener("keydown", function (ev) {
      var key = String(ev && ev.key || "");
      if (key === "Enter") {
        if (ev && typeof ev.preventDefault === "function") { ev.preventDefault(); }
        input.blur();
      } else if (key === "Escape") {
        if (ev && typeof ev.preventDefault === "function") { ev.preventDefault(); }
        commitInlineClockEdit(runtime, input, false);
        input.blur();
      }
    });
  }

  function chessClockFreshGame(runtime) {
    return !!(runtime && Array.isArray(runtime.moves) && runtime.moves.length === 0 && Number(runtime.currentMoveIndex || 0) === 0 && !runtime.promotion);
  }

  function setChessClockRunning(runtime, running) {
    if (!runtime || !runtime.clock) { return; }
    runtime.clock.running = running === true;
    runtime.clock.last_tick_ms = 0.0;
    if (runtime.clock.running !== true) {
      cancelChessBotTimer(runtime);
    }
    if (runtime.clock.running === true && chessClockFreshGame(runtime)) {
      runtime.clock.start_white_ms = Number(runtime.clock.white_ms || 0) || 0;
      runtime.clock.start_black_ms = Number(runtime.clock.black_ms || 0) || 0;
    }
    updateChessPanel(runtime);
    if (runtime.clock.running === true) {
      scheduleChessBotTurn(runtime, chessBotDelayMs(runtime));
    }
  }

  function toggleChessClock(runtime) {
    if (!runtime || !runtime.clock || runtime.gameOver) { return; }
    setChessClockRunning(runtime, runtime.clock.running !== true);
  }

  function updateChessClock(runtime) {
    if (!runtime || !runtime.clock || runtime.gameOver) { return; }
    var now = global.performance && typeof global.performance.now === "function" ? global.performance.now() : Date.now();
    if (runtime.clock.running !== true) {
      runtime.clock.last_tick_ms = now;
      return;
    }
    if (runtime.clock.editing_side) {
      runtime.clock.last_tick_ms = now;
      return;
    }
    var last = Number(runtime.clock.last_tick_ms || 0.0) || now;
    runtime.clock.last_tick_ms = now;
    var dt = Math.max(0.0, Math.min(1000.0, now - last));
    var side = runtime.turn === "black" ? "black" : "white";
    var key = side + "_ms";
    runtime.clock[key] = Math.max(0.0, Number(runtime.clock[key] || 0.0) - dt);
    updateChessPanel(runtime);
  }

  function updateChessPanel(runtime) {
    if (!runtime.panel) { return; }
    var panelRoot = runtime.panelBody || runtime.panel;
    var turnEl = panelRoot.querySelector("[data-vf-chess-turn]");
    var whiteClockEl = panelRoot.querySelector('[data-vf-chess-clock-side="white"]');
    var blackClockEl = panelRoot.querySelector('[data-vf-chess-clock-side="black"]');
    var bodyEl = panelRoot.querySelector("[data-vf-chess-moves]");
    var autoSwitchEl = panelRoot.querySelector("[data-vf-chess-auto-switch]");
    var playerModeEl = panelRoot.querySelector("[data-vf-chess-player-mode]");
    var startButtonEl = panelRoot.querySelector("[data-vf-chess-start-game]");
    if (turnEl) {
      var thinking = runtime.botTimerId ? " · bot thinking" : "";
      turnEl.textContent = "Turn: " + runtime.turn + thinking;
    }
    if (whiteClockEl && runtime.clock) {
      if (runtime.clock.editing_side !== "white" && whiteClockEl !== document.activeElement) {
        whiteClockEl.value = formatChessClock(runtime.clock.white_ms);
      }
      whiteClockEl.readOnly = runtime.clock.running === true;
      whiteClockEl.setAttribute("aria-readonly", runtime.clock.running === true ? "true" : "false");
      whiteClockEl.classList.toggle("vf-chess-clock-time--active", runtime.turn === "white");
      whiteClockEl.classList.toggle("vf-chess-clock-time--locked", runtime.clock.running === true);
    }
    if (blackClockEl && runtime.clock) {
      if (runtime.clock.editing_side !== "black" && blackClockEl !== document.activeElement) {
        blackClockEl.value = formatChessClock(runtime.clock.black_ms);
      }
      blackClockEl.readOnly = runtime.clock.running === true;
      blackClockEl.setAttribute("aria-readonly", runtime.clock.running === true ? "true" : "false");
      blackClockEl.classList.toggle("vf-chess-clock-time--active", runtime.turn === "black");
      blackClockEl.classList.toggle("vf-chess-clock-time--locked", runtime.clock.running === true);
    }
    if (startButtonEl && runtime.clock) {
      startButtonEl.textContent = runtime.clock.running === true ? "Pause Game" : (chessClockFreshGame(runtime) ? "Start Game" : "Resume Game");
    }
    if (playerModeEl && playerModeEl.value !== runtime.playerMode) { playerModeEl.value = runtime.playerMode; }
    if (autoSwitchEl) { autoSwitchEl.checked = runtime.autoSwitchView === true; }
    if (bodyEl) {
      bodyEl.innerHTML = "";
      for (var i = 0; i < runtime.moves.length; i += 2) {
        var row = document.createElement("tr");
        var nr = document.createElement("td");
        var whiteMove = document.createElement("td");
        var blackMove = document.createElement("td");
        var whiteIndex = i + 1;
        var blackIndex = i + 2;
        nr.textContent = String((i / 2) + 1);
        whiteMove.textContent = runtime.moves[i] || "";
        blackMove.textContent = runtime.moves[i + 1] || "";
        nr.className = "vf-chess-move-no";
        whiteMove.className = "vf-chess-move-white";
        blackMove.className = "vf-chess-move-black";
        if (runtime.moves[i]) {
          whiteMove.classList.add("vf-chess-move-cell");
          whiteMove.setAttribute("data-vf-chess-history-index", String(whiteIndex));
          whiteMove.title = "Restore after " + whiteMove.textContent;
        }
        if (runtime.moves[i + 1]) {
          blackMove.classList.add("vf-chess-move-cell");
          blackMove.setAttribute("data-vf-chess-history-index", String(blackIndex));
          blackMove.title = "Restore after " + blackMove.textContent;
        }
        if (Number(runtime.currentMoveIndex || 0) === whiteIndex) {
          whiteMove.classList.add("vf-chess-move-cell--active");
        }
        if (Number(runtime.currentMoveIndex || 0) === blackIndex) {
          blackMove.classList.add("vf-chess-move-cell--active");
        }
        row.appendChild(nr);
        row.appendChild(whiteMove);
        row.appendChild(blackMove);
        bodyEl.appendChild(row);
      }
    }
  }

  function requestChessInteractionFrame(runtime) {
    if (!runtime) { return; }
    if (typeof runtime.requestInteractionFrame === "function") {
      runtime.requestInteractionFrame();
    }
  }

  function chessSceneFrameId() {
    return String(frameSpec.frame_id || config.frame_id || "").trim();
  }

  function chessSceneFrameElement() {
    var sceneFrameId = chessSceneFrameId();
    if (!sceneFrameId || !global.document) { return null; }
    if (global.CSS && typeof global.CSS.escape === "function") {
      return document.querySelector('.vf-frame[data-vf-frame-id="' + global.CSS.escape(sceneFrameId) + '"]');
    }
    return document.querySelector('.vf-frame[data-vf-frame-id="' + sceneFrameId.replace(/["\\]/g, "") + '"]');
  }

  function ensureChessBoardHost(sceneFrameBody) {
    if (!sceneFrameBody || typeof sceneFrameBody.querySelector !== "function") { return null; }
    var boardHost = sceneFrameBody.querySelector(".vf-chess-board-host");
    if (!boardHost) {
      boardHost = document.createElement("div");
      boardHost.className = "vf-chess-board-host";
      sceneFrameBody.insertBefore(boardHost, sceneFrameBody.firstChild || null);
    }
    return boardHost;
  }

  function attachChessPanelToSceneFrame(runtime, sceneFrame, sceneFrameBody, controlsFrameClass) {
    if (!runtime || !runtime.panelBody || !sceneFrame || !sceneFrameBody) { return false; }
    sceneFrame.setAttribute("data-vf-chess-board-frame", "1");
    sceneFrame.classList.add(controlsFrameClass);
    ensureChessBoardHost(sceneFrameBody);
    if (runtime.panelBody.parentNode !== sceneFrameBody) {
      sceneFrameBody.appendChild(runtime.panelBody);
    }
    runtime.panelBody.classList.remove("vf-chess-panel--fallback");
    runtime.panelBody.classList.add("vf-chess-panel--in-frame");
    if (runtime.panelFrame && runtime.panelFrame.root && runtime.panelFrame.root.parentNode) {
      try { runtime.panelFrame.root.parentNode.removeChild(runtime.panelFrame.root); } catch (_) {}
    }
    runtime.panelFrame = null;
    runtime.panel = runtime.panelBody;
    return true;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function chessPlayerModes(runtime) {
    var cfg = runtime && runtime.cfg ? runtime.cfg : {};
    var declared = Array.isArray(cfg.player_modes) ? cfg.player_modes : [];
    var modes = [];
    for (var i = 0; i < declared.length; i += 1) {
      var m = declared[i] || {};
      var id = String(m.id || "").trim();
      if (!id) { continue; }
      modes.push({
        id: id,
        label: String(m.label || id),
        white: String(m.white || "human"),
        black: String(m.black || "human")
      });
    }
    if (!modes.length) {
      failFast("chess interaction requires player_modes in the VKF contract");
    }
    return modes;
  }

  function chessPlayerModeById(runtime, id) {
    var modes = chessPlayerModes(runtime);
    var wanted = String(id || "");
    for (var i = 0; i < modes.length; i += 1) {
      if (modes[i].id === wanted) { return modes[i]; }
    }
    return modes[0];
  }

  function chessBotDelayMs(runtime) {
    var cfg = runtime && runtime.cfg ? runtime.cfg : {};
    return Math.max(2000, Number(cfg.bot_min_think_ms || 2000) || 2000);
  }

  function chessBotCanActNow(runtime) {
    return !!(runtime &&
      runtime.clock &&
      runtime.clock.running === true &&
      !runtime.gameOver &&
      !runtime.endSequence &&
      (!Array.isArray(runtime.animations) || runtime.animations.length === 0));
  }

  function chooseChessBotPromotionOption(runtime) {
    var options = Array.isArray(runtime && runtime.promotionOptions) ? runtime.promotionOptions : [];
    if (!options.length) { return null; }
    var wantedRole = String(runtime && runtime.botPendingPromotionRole || "");
    if (wantedRole) {
      for (var wantedIndex = 0; wantedIndex < options.length; wantedIndex += 1) {
        if (String(options[wantedIndex] && options[wantedIndex].role || "") === wantedRole) {
          runtime.botPendingPromotionRole = "";
          return options[wantedIndex];
        }
      }
    }
    var pending = runtime && runtime.promotion ? runtime.promotion : null;
    var piece = pending && pending.piece ? pending.piece : null;
    if (piece) {
      var perspective = String(piece.side || runtime.turn || "white");
      var snapshot = chessBotStateSnapshot(runtime);
      var previousTurn = runtime.turn;
      var best = null;
      for (var i = 0; i < options.length; i += 1) {
        piece.role = String(options[i] && options[i].role || "queen");
        runtime.turn = perspective === "white" ? "black" : "white";
        rebuildChessOccupancy(runtime);
        var score = chessBotMinimaxScore(runtime, 5, perspective, -Infinity, Infinity) + chessBotRandomJitter(runtime, { piece: piece, toFile: piece.file, toRank: piece.rank, promotionRole: piece.role });
        if (!best || score > best.score) { best = { score: score, option: options[i] }; }
      }
      restoreChessBotState(runtime, snapshot);
      runtime.turn = previousTurn;
      return best ? best.option : options[0];
    }
    for (var i = 0; i < options.length; i += 1) {
      if (String(options[i] && options[i].role || "") === "queen") { return options[i]; }
    }
    return options[0] || null;
  }

  function scheduleChessBotTurn(runtime, delayMs) {
    if (!runtime) { return; }
    if (!runtime.clock || runtime.clock.running !== true) { cancelChessBotTimer(runtime); return; }
    if (runtime.gameOver || runtime.endSequence) { cancelChessBotTimer(runtime); return; }
    var promotionSide = runtime.promotion ? String(runtime.promotion.side || "") : "";
    var activeSide = promotionSide || String(runtime.turn || "white");
    if (chessBotControllerForSide(runtime, activeSide) !== "bot") { cancelChessBotTimer(runtime); return; }
    if (runtime.botTimerId) { return; }
    runtime.botThinkingSide = activeSide;
    runtime.botTimerId = global.setTimeout(function () {
      runtime.botTimerId = 0;
      runtime.botThinkingSide = "";
      runChessBotTurn(runtime);
    }, Math.max(chessBotDelayMs(runtime), Number(delayMs || 0) || 0));
    updateChessPanel(runtime);
  }

  function runChessBotTurn(runtime) {
    if (!runtime) { return; }
    if (!chessBotCanActNow(runtime) && !runtime.promotion) {
      scheduleChessBotTurn(runtime, 100);
      return;
    }
    if (runtime.promotion) {
      var option = chooseChessBotPromotionOption(runtime);
      if (option) {
        completeChessPromotion(runtime, option);
      }
      return;
    }
    if (!chessBotActiveForTurn(runtime)) { updateChessPanel(runtime); return; }
    var move = chessBotBestMove(runtime);
    if (!move) {
      updateChessPanel(runtime);
      return;
    }
    runtime.botPendingPromotionRole = String(move.promotionRole || "");
    moveChessPiece(runtime, move.piece, move.toFile, move.toRank);
  }

  function renderChessPlayerModeOptions(runtime) {
    var modes = chessPlayerModes(runtime);
    var out = "";
    for (var i = 0; i < modes.length; i += 1) {
      var m = modes[i];
      var selected = m.id === runtime.playerMode ? " selected" : "";
      out += '<option value="' + escapeHtml(m.id) + '"' + selected + '>' + escapeHtml(m.label) + '</option>';
    }
    return out;
  }

  function ensureChessPanel(runtime) {
    if (!global.document) { return; }
    var controlsFrameClass = String(runtime.cfg.controls_frame_class || "vf-chess-frame");
    var controlsPanelClass = String(runtime.cfg.controls_panel_class || "vf-chess-panel");
    var sceneFrame = chessSceneFrameElement();
    if (!sceneFrame && sceneFrameVisible()) {
      sceneFrame = ensureVisibleSceneFrameShell();
    }
    var sceneFrameBody = sceneFrame && sceneFrame.querySelector ? sceneFrame.querySelector(".vf-frame__body") : null;
    if (!sceneFrame || !sceneFrameBody) {
      failFast("chess controls require the scene frame shell before panel mount");
    }
    if (runtime.panel) {
      attachChessPanelToSceneFrame(runtime, sceneFrame, sceneFrameBody, controlsFrameClass);
      return;
    }
    sceneFrame.setAttribute("data-vf-chess-board-frame", "1");
    sceneFrame.classList.add(controlsFrameClass);
    ensureChessBoardHost(sceneFrameBody);
    var panel = document.createElement("aside");
    panel.classList.add(controlsPanelClass);
    panel.innerHTML = '<h2 class="vf-chess-title">VKF Chess</h2><div class="vf-chess-turn" data-vf-chess-turn>Turn: white</div><label class="vf-chess-mode"><span>Mode</span><select data-vf-chess-player-mode>' + renderChessPlayerModeOptions(runtime) + '</select></label><div class="vf-chess-clock"><input class="vf-chess-clock-time" data-vf-chess-clock-side="white" inputmode="numeric" value="10:00" aria-label="White clock"><input class="vf-chess-clock-time" data-vf-chess-clock-side="black" inputmode="numeric" value="10:00" aria-label="Black clock"></div><div class="vf-chess-actions"><button class="vf-chess-start-game" data-vf-chess-start-game>Start Game</button><button class="vf-chess-new-game" data-vf-chess-new-game>New Game</button></div><label class="vf-chess-toggle"><input type="checkbox" data-vf-chess-auto-switch> Auto switch view</label><h3 class="vf-chess-section-title">Moves</h3><table class="vf-chess-moves"><thead><tr><th>#</th><th>White</th><th>Black</th></tr></thead><tbody data-vf-chess-moves></tbody></table>';
    panel.addEventListener("contextmenu", function (ev) {
      if (ev && typeof ev.preventDefault === "function") { ev.preventDefault(); }
      if (ev && typeof ev.stopPropagation === "function") { ev.stopPropagation(); }
    }, { passive: false, capture: true });
    panel.setAttribute("data-vf-chess-panel", "1");
    panel.classList.add("vf-chess-panel--in-frame");
    sceneFrameBody.appendChild(panel);
    runtime.panelFrame = null;
    runtime.panel = panel;
    runtime.panelBody = panel;
    var startButton = panel.querySelector("[data-vf-chess-start-game]");
    if (startButton) {
      startButton.addEventListener("click", function () {
        toggleChessClock(runtime);
      });
    }
    var newGameButton = panel.querySelector("[data-vf-chess-new-game]");
    if (newGameButton) {
      newGameButton.addEventListener("click", function () {
        resetChessRuntime(runtime);
      });
    }
    var autoSwitch = panel.querySelector("[data-vf-chess-auto-switch]");
    if (autoSwitch) {
      autoSwitch.checked = runtime.autoSwitchView === true;
      autoSwitch.addEventListener("change", function () {
        runtime.autoSwitchView = autoSwitch.checked === true;
      });
    }
    var playerMode = panel.querySelector("[data-vf-chess-player-mode]");
    if (playerMode) {
      playerMode.value = runtime.playerMode;
      playerMode.addEventListener("change", function () {
        cancelChessBotTimer(runtime);
        runtime.playerMode = chessPlayerModeById(runtime, playerMode.value).id;
        runtime.playerModeSpec = chessPlayerModeById(runtime, runtime.playerMode);
        updateChessPanel(runtime);
        scheduleChessBotTurn(runtime, chessBotDelayMs(runtime));
      });
    }
    var clockInputs = panel.querySelectorAll("[data-vf-chess-clock-side]");
    for (var clockInputIndex = 0; clockInputIndex < clockInputs.length; clockInputIndex += 1) {
      attachInlineClockEditor(runtime, clockInputs[clockInputIndex]);
    }
    panel.addEventListener("click", function (ev) {
      var target = ev && ev.target && typeof ev.target.closest === "function"
        ? ev.target.closest("[data-vf-chess-history-index]")
        : null;
      if (!target) { return; }
      var index = Number(target.getAttribute("data-vf-chess-history-index") || 0) || 0;
      restoreChessHistory(runtime, index);
    });
  }

  function rebuildChessOccupancy(runtime) {
    runtime.occupied = Object.create(null);
    var ids = Object.keys(runtime.piecesByObjectId);
    for (var i = 0; i < ids.length; i += 1) {
      var p = runtime.piecesByObjectId[ids[i]];
      if (!p.captured) { runtime.occupied[chessSquareKey(p.file, p.rank)] = p; }
    }
  }

  function resetChessRuntime(runtime) {
    cancelChessBotTimer(runtime);
    runtime.turn = "white";
    runtime.gameOver = null;
    runtime.endSequence = null;
    runtime.clock.running = false;
    runtime.clock.white_ms = Number(runtime.clock.start_white_ms || runtime.clock.default_ms || 600000);
    runtime.clock.black_ms = Number(runtime.clock.start_black_ms || runtime.clock.default_ms || 600000);
    runtime.clock.last_tick_ms = 0.0;
    runtime.clock.editing_side = "";
    runtime.clock.editing_value = "";
    runtime.selected = null;
    runtime.hoverSquare = null;
    runtime.hoverPiece = null;
    runtime.hoverPromotion = null;
    runtime.promotion = null;
    runtime.botPendingPromotionRole = "";
    runtime.lastDoublePawn = null;
    runtime.halfmoveClock = 0;
    runtime.positionCounts = Object.create(null);
    clearChessPromotionOptions(runtime);
    runtime.moves = [];
    runtime.currentMoveIndex = 0;
    runtime.historySnapshots = [];
    runtime.animations = [];
    runtime.nextCaptureOrder = 0;
    var ids = Object.keys(runtime.piecesByObjectId);
    for (var i = 0; i < ids.length; i += 1) {
      var p = runtime.piecesByObjectId[ids[i]];
      if (p.start_mesh && p.mesh !== p.start_mesh) {
        removeMeshFromScene(p.mesh);
        if (Array.isArray(config.meshes) && config.meshes.indexOf(p.start_mesh) < 0) {
          config.meshes.push(p.start_mesh);
        }
        p.mesh = p.start_mesh;
        runtime.meshByObjectId[String(p.object_id)] = p.mesh;
      }
      p.role = String(p.start_role || p.role || "pawn");
      p.file = p.start_file;
      p.rank = p.start_rank;
      p.captured = false;
      p.captured_by = "";
      p.in_capture_tray = false;
      p.capture_order = 0;
      p.capture_tray_index = -1;
      p.capture_tray_center = null;
      p.has_moved = false;
      p._animating = false;
      p.mesh._modelMatrix = null;
      setEntityProp(p.mesh, "transform", null);
      setEntityProp(p.mesh, "center", pieceBoardCenter(p, 0.0));
      setEntityProp(p.mesh, "rotation", cloneJsonValue(p.start_rotation || entityProp(p.start_mesh || p.mesh, "rotation", [0.0, 0.0, 0.0])));
      setEntityProp(p.mesh, "visible", true);
      setEntityProp(p.mesh, "color", pieceBaseColor(p));
      setEntityProp(p.mesh, "specular_strength", Number(runtime.cfg.piece_specular_strength || 0.055) || 0.055);
      setEntityProp(p.mesh, "receives_shadow", true);
    }
    rebuildChessOccupancy(runtime);
    recordChessHistorySnapshot(runtime);
    rebuildChessPositionCounts(runtime);
    resetChessHighlights(runtime);
    updateChessPanel(runtime);
    markChessSceneDirty(runtime);
    requestChessInteractionFrame(runtime);
  }

  function initChessRuntime() {
    var cfg = chessInteractionConfig();
    if (!cfg || !Array.isArray(config.meshes)) { return null; }
    if (global.__vfNativeChessRuntime && global.__vfNativeChessRuntime.frameId === String(frameSpec.frame_id || config.frame_id || "")) {
      return global.__vfNativeChessRuntime;
    }
    var runtime = {
      cfg: cfg,
      frameId: String(frameSpec.frame_id || config.frame_id || ""),
      meshByObjectId: Object.create(null),
      piecesByObjectId: Object.create(null),
      pieceTemplateMeshes: Object.create(null),
      promotionOptions: [],
      promotionOptionsByObjectId: Object.create(null),
      promotion: null,
      hoverPromotion: null,
      nextPromotionObjectId: 900000,
      squareRegionObjectId: chessSquareRegionObjectId(cfg),
      squareStates: Object.create(null),
      occupied: Object.create(null),
      turn: "white",
      selected: null,
      hoverSquare: null,
      hoverPiece: null,
      moves: [],
      currentMoveIndex: 0,
      historySnapshots: [],
      playerMode: String(cfg.default_player_mode || "human_human"),
      playerModeSpec: null,
      botTimerId: 0,
      botThinkingSide: "",
      botPendingPromotionRole: "",
      autoSwitchView: false,
      pendingAutoSwitchAfterAnimations: false,
      pendingAutoSwitchSide: "",
      pendingEndResult: "",
      pendingEndPieceObjectId: 0,
      lastDoublePawn: null,
      halfmoveClock: 0,
      positionCounts: Object.create(null),
      endSequence: null,
      animations: [],
      nextCaptureOrder: 0,
      gameOver: null,
      clock: {
        default_ms: 600000,
        start_white_ms: 600000,
        start_black_ms: 600000,
        white_ms: 600000,
        black_ms: 600000,
        last_tick_ms: 0.0,
        interval_id: 0,
        running: false,
        editing_side: "",
        editing_value: ""
      },
      panel: null,
      sceneDirtyVersion: 1
    };
    runtime.playerModeSpec = chessPlayerModeById(runtime, runtime.playerMode);
    runtime.playerMode = runtime.playerModeSpec.id;
    for (var m = 0; m < config.meshes.length; m += 1) {
      var mesh = config.meshes[m];
      var oid = Number(entityProp(mesh, "object_id", 0) || 0);
      if (oid > 0) {
        runtime.meshByObjectId[String(oid)] = mesh;
        if (isChessSquareSourceMesh(mesh, cfg)) {
          suppressChessSquareVisualMesh(mesh);
        }
      }
    }
    var pieces = Array.isArray(cfg.pieces) ? cfg.pieces : [];
    for (var i = 0; i < pieces.length; i += 1) {
      var raw = pieces[i] || {};
      var objectId = Number(raw.object_id || 0) || 0;
      var piece = {
        object_id: objectId,
        mesh: runtimeMeshByObjectId(runtime, objectId),
        side: String(raw.side || ""),
        role: String(raw.role || "pawn"),
        start_role: String(raw.role || "pawn"),
        file: Number(raw.file || 0) || 0,
        rank: Number(raw.rank || 0) || 0,
        start_file: Number(raw.file || 0) || 0,
        start_rank: Number(raw.rank || 0) || 0,
        base_z: Number(raw.base_z != null ? raw.base_z : cfg.piece_base_z != null ? cfg.piece_base_z : 0.065) || 0.065,
        start_rotation: null,
        captured: false,
        captured_by: "",
        in_capture_tray: false,
        capture_order: 0,
        capture_tray_index: -1,
        capture_tray_center: null,
        has_moved: false
      };
      if (piece.mesh && piece.side && piece.file && piece.rank) {
        piece.start_mesh = piece.mesh;
        piece.start_rotation = cloneJsonValue(entityProp(piece.mesh, "rotation", [0.0, 0.0, 0.0]));
        setEntityProp(piece.mesh, "color", pieceBaseColor(piece));
        setEntityProp(piece.mesh, "specular_strength", Number(cfg.piece_specular_strength || 0.055) || 0.055);
        setEntityProp(piece.mesh, "receives_shadow", true);
        runtime.piecesByObjectId[String(objectId)] = piece;
        var templateKey = piece.side + ":" + piece.role;
        if (!runtime.pieceTemplateMeshes[templateKey]) {
          runtime.pieceTemplateMeshes[templateKey] = cloneJsonValue(piece.mesh);
        }
      }
    }
    rebuildChessOccupancy(runtime);
    recordChessHistorySnapshot(runtime);
    rebuildChessPositionCounts(runtime);
    if (!global.__vfLocalOnlyFrameEvents) { global.__vfLocalOnlyFrameEvents = Object.create(null); }
    global.__vfLocalOnlyFrameEvents[runtime.frameId] = true;
    ensureChessPanel(runtime);
    updateChessPanel(runtime);
    runtime.clock.interval_id = global.setInterval(function () {
      updateChessClock(runtime);
    }, 250);
    global.__vfNativeChessRuntime = runtime;
    return runtime;
  }

  function chessEventTarget(runtime, objectId, simplexId) {
    var promotionOption = runtime && runtime.promotionOptionsByObjectId
      ? runtime.promotionOptionsByObjectId[String(Number(objectId || 0) || 0)] || null
      : null;
    if (promotionOption) {
      return { kind: "promotion", promotion: promotionOption };
    }
    var square = Number(objectId || 0) === Number(runtime.squareRegionObjectId || 0)
      ? chessSquareFromSimplexId(runtime, simplexId)
      : chessSquareFromObjectId(runtime, objectId);
    if (square) { return { kind: "square", square: square, piece: chessPieceAt(runtime, square.file, square.rank) }; }
    var piece = chessPieceFromObjectId(runtime, objectId);
    if (piece) { return { kind: "piece", piece: piece, square: { file: piece.file, rank: piece.rank, object_id: 0 } }; }
    return { kind: "empty" };
  }

  function selectChessPiece(runtime, piece) {
    runtime.selected = targetPieceIsSelectable(runtime, piece) ? piece : null;
    refreshChessPieceSelectionPose(runtime);
    resetChessHighlights(runtime, { skipPieceRefresh: true });
    requestChessInteractionFrame(runtime);
  }

  function cancelChessSelection(runtime) {
    if (!runtime) { return; }
    runtime.selected = null;
    refreshChessPieceSelectionPose(runtime);
    resetChessHighlights(runtime);
    requestChessInteractionFrame(runtime);
  }

  function moveChessPiece(runtime, piece, toFile, toRank) {
    var target = chessPieceAt(runtime, toFile, toRank);
    var enPassantCaptured = chessEnPassantCapturedPiece(runtime, piece, toFile, toRank);
    if (!chessLegalMove(runtime, piece, toFile, toRank)) { return false; }
    truncateChessFuture(runtime);
    var castle = chessCastleInfo(runtime, piece, toFile, toRank);
    var fromFile = Number(piece.file);
    var fromRank = Number(piece.rank);
    delete runtime.occupied[chessSquareKey(piece.file, piece.rank)];
    var fromCenter = toVec3(entityProp(piece.mesh, "center", pieceBoardCenter(piece, 0.0)), pieceBoardCenter(piece, 0.0));
    var toCenter = [chessBoardX(toFile), chessBoardY(toRank), Number(piece.base_z || 0.065) || 0.065];
    if (target) {
      delete runtime.occupied[chessSquareKey(target.file, target.rank)];
    }
    if (enPassantCaptured) {
      delete runtime.occupied[chessSquareKey(enPassantCaptured.file, enPassantCaptured.rank)];
    }
    piece.file = toFile;
    piece.rank = toRank;
    piece.has_moved = true;
    runtime.occupied[chessSquareKey(toFile, toRank)] = piece;
    queueChessAnimation(runtime, piece, [fromCenter, toCenter], null);
    if (target) {
      queueCapturedPieceAnimation(runtime, target, piece.side);
    }
    if (enPassantCaptured) {
      queueCapturedPieceAnimation(runtime, enPassantCaptured, piece.side);
    }
    if (castle && castle.rook) {
      var rook = castle.rook;
      delete runtime.occupied[chessSquareKey(castle.rookFromFile, toRank)];
      var rookFromCenter = toVec3(entityProp(rook.mesh, "center", pieceBoardCenter(rook, 0.0)), pieceBoardCenter(rook, 0.0));
      var rookToCenter = [chessBoardX(castle.rookToFile), chessBoardY(toRank), Number(rook.base_z || 0.065) || 0.065];
      rook.file = castle.rookToFile;
      rook.rank = toRank;
      rook.has_moved = true;
      runtime.occupied[chessSquareKey(rook.file, rook.rank)] = rook;
      queueChessAnimation(runtime, rook, [rookFromCenter, rookToCenter], null);
    }
    if (chessIsPromotionMove(piece, toRank)) {
      recordChessLastDoublePawn(runtime, piece, fromRank, toFile, toRank);
      startChessPromotion(runtime, piece, target, fromFile, fromRank, toFile, toRank);
      refreshChessPieceSelectionPose(runtime);
      resetChessHighlights(runtime);
      requestChessInteractionFrame(runtime);
      return true;
    }
    recordChessLastDoublePawn(runtime, piece, fromRank, toFile, toRank);
    commitChessMove(runtime, chessMoveNotation(runtime, piece, target, toFile, toRank, castle, enPassantCaptured, fromFile));
    runtime.turn = runtime.turn === "white" ? "black" : "white";
    updateChessDrawCountersAfterMove(runtime, piece, target || enPassantCaptured || null);
    var moveResult = finishChessMoveResult(runtime, piece.side);
    runtime.pendingAutoSwitchSide = String(runtime.turn || "white");
    runtime.pendingEndResult = moveResult || "";
    runtime.pendingEndPieceObjectId = moveResult ? (Number(piece.object_id || 0) || 0) : 0;
    recordChessHistorySnapshot(runtime);
    runtime.selected = null;
    refreshChessPieceSelectionPose(runtime);
    resetChessHighlights(runtime);
    updateChessPanel(runtime);
    markChessSceneDirty(runtime);
    requestChessInteractionFrame(runtime);
    return true;
  }

  function handleChessEvent(runtime, evt) {
    if (!evt || String(evt.frame_id || "") !== runtime.frameId) { return; }
    var eventName = String(evt.event || "").toLowerCase();
    var button = Number(evt.button || 0) || 0;
    if ((eventName === "down" || eventName === "up" || eventName === "click") && button === 2) {
      cancelChessSelection(runtime);
      return;
    }
    var objectId = Number(evt.object_id || 0) || 0;
    var target = chessEventTarget(runtime, objectId, Number(evt.simplex_id || 0) || 0);
    if (runtime.gameOver) { return; }
    if (eventName === "leave") {
      runtime.hoverSquare = null;
      runtime.hoverPiece = null;
      runtime.hoverPromotion = null;
      refreshChessPromotionOptions(runtime);
      resetChessHighlights(runtime);
      return;
    }
    if (eventName === "hover" || eventName === "move") {
      var previousHoverPiece = runtime.hoverPiece || null;
      var previousHoverPromotion = runtime.hoverPromotion || null;
      var previousHoverSquareKey = runtime.hoverSquare
        ? chessSquareKey(runtime.hoverSquare.file, runtime.hoverSquare.rank)
        : "";
      runtime.hoverPromotion = target.kind === "promotion" ? target.promotion : null;
      var hoveredPieceCandidate = target.kind === "piece" ? target.piece : (target.kind === "square" ? target.piece : null);
      runtime.hoverPiece = targetPieceIsSelectable(runtime, hoveredPieceCandidate) ? hoveredPieceCandidate : null;
      runtime.hoverSquare = runtime.promotion ? null : (target.kind === "square" ? target.square : (target.kind === "piece" ? target.square : null));
      var nextHoverSquareKey = runtime.hoverSquare
        ? chessSquareKey(runtime.hoverSquare.file, runtime.hoverSquare.rank)
        : "";
      runtime.lastHoverTarget = {
        kind: String(target.kind || "none"),
        object_id: objectId,
        simplex_id: Number(evt.simplex_id || 0) || 0,
        square: runtime.hoverSquare ? { file: runtime.hoverSquare.file, rank: runtime.hoverSquare.rank } : null,
        selected: runtime.selected ? { file: runtime.selected.file, rank: runtime.selected.rank, object_id: runtime.selected.object_id } : null
      };
      var hoverVisualChanged = false;
      if (!runtime.selected && previousHoverPiece !== runtime.hoverPiece) {
        refreshChessPieceSelectionPose(runtime);
        hoverVisualChanged = true;
      }
      if (previousHoverPromotion !== runtime.hoverPromotion) {
        refreshChessPromotionOptions(runtime);
        markChessSceneDirty(runtime);
        hoverVisualChanged = true;
      }
      resetChessHighlights(runtime, { skipPieceRefresh: true });
      if (hoverVisualChanged) {
        requestChessInteractionFrame(runtime);
      }
      return;
    }
    if (eventName !== "down" && eventName !== "up" && eventName !== "click") { return; }
    var activeInputSide = runtime.promotion ? String(runtime.promotion.side || "") : String(runtime.turn || "white");
    if (chessBotControllerForSide(runtime, activeInputSide) === "bot") {
      scheduleChessBotTurn(runtime, chessBotDelayMs(runtime));
      return;
    }
    if (runtime.promotion) {
      if (target.kind === "promotion" && completeChessPromotion(runtime, target.promotion)) {
        return;
      }
      refreshChessPromotionOptions(runtime);
      requestChessInteractionFrame(runtime);
      return;
    }
    var selectablePiece = target.kind === "piece"
      ? target.piece
      : (target.kind === "square" ? target.piece : null);
    if (targetPieceIsSelectable(runtime, selectablePiece)) {
      selectChessPiece(runtime, selectablePiece);
      return;
    }
    if (runtime.selected && (target.kind === "square" || target.kind === "piece")) {
      var sq = target.kind === "square" ? target.square : { file: target.piece.file, rank: target.piece.rank };
      if (!moveChessPiece(runtime, runtime.selected, sq.file, sq.rank)) {
        resetChessHighlights(runtime);
      }
    }
  }

  function applyChessInteractionFrame(seconds) {
    var runtime = initChessRuntime();
    if (!runtime) { return false; }
    var now = global.performance && typeof global.performance.now === "function" ? global.performance.now() : (Number(seconds || 0) * 1000.0);
    if (!runtime.gameOver && runtime.pendingEndResult && !chessPendingEndPieceAnimating(runtime)) {
      var immediateEndResult = String(runtime.pendingEndResult || "");
      runtime.pendingEndResult = "";
      runtime.pendingEndPieceObjectId = 0;
      startChessEndAnimation(runtime, immediateEndResult);
      return true;
    }
    if ((!Array.isArray(runtime.animations) || runtime.animations.length === 0) && advanceChessEndSequence(runtime, now)) {
      return true;
    }
    var remaining = [];
    var changed = false;
    var hadAnimations = runtime.animations.length > 0;
    var finishedKingFall = false;
    for (var i = 0; i < runtime.animations.length; i += 1) {
      var anim = runtime.animations[i];
      var durationMs = Math.max(16.0, Number(anim.duration_ms || 0.0) || chessMotionDurationMs(runtime, anim.path));
      var lastTick = Number(anim.last_tick_ms || 0.0) || now;
      var dtMs = Math.max(0.0, Math.min(34.0, now - lastTick));
      anim.last_tick_ms = now;
      anim.elapsed_ms = Math.max(0.0, Number(anim.elapsed_ms || 0.0) || 0.0) + dtMs;
      var t = Math.max(0.0, Math.min(1.0, anim.elapsed_ms / durationMs));
      anim.progress = t;
      var easedT = chessAnimationEase(anim, t);
      var path = Array.isArray(anim.path) && anim.path.length >= 2 ? anim.path : [anim.from, anim.to];
      var totalLength = Math.max(0.0001, Number(anim.path_length || chessPathLength(path)) || chessPathLength(path) || 0.0001);
      var remainingDistance = easedT * totalLength;
      var from = path[0];
      var to = path[1];
      var localT = 0.0;
      for (var pathIndex = 1; pathIndex < path.length; pathIndex += 1) {
        from = path[pathIndex - 1];
        to = path[pathIndex];
        var dx = Number(to[0] || 0.0) - Number(from[0] || 0.0);
        var dy = Number(to[1] || 0.0) - Number(from[1] || 0.0);
        var dz = Number(to[2] || 0.0) - Number(from[2] || 0.0);
        var segmentLength = Math.max(0.0001, Math.sqrt((dx * dx) + (dy * dy) + (dz * dz)));
        if (remainingDistance <= segmentLength || pathIndex === path.length - 1) {
          localT = Math.max(0.0, Math.min(1.0, remainingDistance / segmentLength));
          break;
        }
        remainingDistance -= segmentLength;
      }
      var center = [
        from[0] + ((to[0] - from[0]) * localT),
        from[1] + ((to[1] - from[1]) * localT),
        from[2] + ((to[2] - from[2]) * localT)
      ];
      if (anim.fall_pose && typeof anim.fall_pose === "object") {
        var pose = anim.fall_pose;
        var fallAngle = Math.max(0.0, Number(pose.angle_rad || (Math.PI * 0.5)) || (Math.PI * 0.5)) * easedT;
        var fallModel = mat4RotateAroundPoint(pose.axis || [0.0, 1.0, 0.0], fallAngle, pose.pivot || center, pose.base_model || null);
        anim.piece.mesh._modelMatrix = null;
        setEntityProp(anim.piece.mesh, "transform", finiteMat4(fallModel));
        setEntityProp(anim.piece.mesh, "center", [0.0, 0.0, 0.0]);
        setEntityProp(anim.piece.mesh, "rotation", [0.0, 0.0, 0.0]);
      } else {
        anim.piece.mesh._modelMatrix = null;
        setEntityProp(anim.piece.mesh, "transform", null);
        setEntityProp(anim.piece.mesh, "center", center);
      }
      if (!anim.fall_pose && Array.isArray(anim.from_rotation) && Array.isArray(anim.to_rotation)) {
        setEntityProp(anim.piece.mesh, "rotation", [
          Number(anim.from_rotation[0] || 0.0) + ((Number(anim.to_rotation[0] || 0.0) - Number(anim.from_rotation[0] || 0.0)) * easedT),
          Number(anim.from_rotation[1] || 0.0) + ((Number(anim.to_rotation[1] || 0.0) - Number(anim.from_rotation[1] || 0.0)) * easedT),
          Number(anim.from_rotation[2] || 0.0) + ((Number(anim.to_rotation[2] || 0.0) - Number(anim.from_rotation[2] || 0.0)) * easedT)
        ]);
      }
      changed = true;
      if (t < 1.0) {
        remaining.push(anim);
      } else {
        anim.piece._animating = false;
        setEntityProp(anim.piece.mesh, "center", anim.to);
        if (anim.fall_pose && typeof anim.fall_pose === "object") {
          var finalPose = anim.fall_pose;
          var finalAngle = Math.max(0.0, Number(finalPose.angle_rad || (Math.PI * 0.5)) || (Math.PI * 0.5));
          var finalModel = mat4RotateAroundPoint(finalPose.axis || [0.0, 1.0, 0.0], finalAngle, finalPose.pivot || anim.to, finalPose.base_model || null);
          anim.piece.mesh._modelMatrix = null;
          setEntityProp(anim.piece.mesh, "transform", finiteMat4(finalModel));
          setEntityProp(anim.piece.mesh, "center", [0.0, 0.0, 0.0]);
          setEntityProp(anim.piece.mesh, "rotation", [0.0, 0.0, 0.0]);
          finishedKingFall = true;
        } else {
          anim.piece.mesh._modelMatrix = null;
          setEntityProp(anim.piece.mesh, "transform", null);
        }
        if (!anim.fall_pose && Array.isArray(anim.to_rotation)) {
          setEntityProp(anim.piece.mesh, "rotation", anim.to_rotation);
        }
      }
    }
    runtime.animations = remaining;
    if (!runtime.gameOver && runtime.pendingEndResult && !chessPendingEndPieceAnimating(runtime)) {
      var pendingEndResult = String(runtime.pendingEndResult || "");
      runtime.pendingEndResult = "";
      runtime.pendingEndPieceObjectId = 0;
      startChessEndAnimation(runtime, pendingEndResult);
      return true;
    }
    if (finishedKingFall && runtime.endSequence && runtime.endSequence.stage === "falling") {
      runtime.endSequence.stage = "wait_before_center";
      runtime.endSequence.due_ms = now + 1000.0;
      markChessSceneDirty(runtime);
      return true;
    }
    if (hadAnimations && !remaining.length) {
      if (runtime.endSequence && runtime.endSequence.stage === "falling") {
        runtime.endSequence.stage = "wait_before_center";
        runtime.endSequence.due_ms = now + 1000.0;
        markChessSceneDirty(runtime);
        return true;
      }
      if (runtime.endSequence && runtime.endSequence.stage === "centering") {
        runtime.endSequence = null;
      }
      if (!runtime.gameOver && runtime.pendingEndResult) {
        var endResult = String(runtime.pendingEndResult || "");
        runtime.pendingEndResult = "";
        startChessEndAnimation(runtime, endResult);
        return true;
      }
      if (!runtime.gameOver) {
        refreshChessPieceSelectionPose(runtime);
      }
      if (runtime.pendingAutoSwitchAfterAnimations === true) {
        runtime.pendingAutoSwitchAfterAnimations = false;
        if (runtime.autoSwitchView === true && typeof runtime.afterChessAnimationsComplete === "function") {
          runtime.afterChessAnimationsComplete(runtime.pendingAutoSwitchSide || runtime.turn || "white");
        }
      }
      scheduleChessBotTurn(runtime, chessBotDelayMs(runtime));
    }
    if (changed) { markChessSceneDirty(runtime); }
    return remaining.length > 0;
  }

  function resolveMeshSpecById(meshSpecs, meshId, purpose) {
    var targetId = String(meshId || "").trim();
    for (var i = 0; i < meshSpecs.length; i += 1) {
      if (String(meshSpecs[i] && meshSpecs[i].id || "") === targetId) {
        return meshSpecs[i];
      }
    }
    failFast(String(purpose || "camera setup") + ': mesh id "' + targetId + '" was not found');
  }

  function resolveRawMeshById(rawMeshes, meshId, purpose) {
    var targetId = String(meshId || "").trim();
    for (var i = 0; i < rawMeshes.length; i += 1) {
      var rawMesh = rawMeshes[i];
      if (String(rawMesh && rawMesh.id || entityProp(rawMesh, "id", "")) === targetId) {
        return rawMesh;
      }
    }
    failFast(String(purpose || "camera setup") + ': mesh id "' + targetId + '" was not found');
  }

  function requirePlanarMirrorAdapterMethod(methodName, purpose) {
    var adapterApi = global.VfGeomWgpuUtil;
    if (!adapterApi || typeof adapterApi.createPlanarMirrorAdapter !== "function") {
      failFast(String(purpose || "camera setup") + ": planar mirror adapter factory is unavailable");
    }
    var adapter = adapterApi.createPlanarMirrorAdapter();
    if (!adapter || typeof adapter[methodName] !== "function") {
      failFast(String(purpose || "camera setup") + ': planar mirror adapter method "' + String(methodName) + '" is unavailable');
    }
    return adapter;
  }

  function fmtMirrorDebugVec3(value) {
    var v = Array.isArray(value) ? value : [];
    return "[" +
      (Number(v[0] || 0.0)).toFixed(4) + "," +
      (Number(v[1] || 0.0)).toFixed(4) + "," +
      (Number(v[2] || 0.0)).toFixed(4) + "]";
  }

  function debugMirrorCamera(label, camera, extra) {
    try {
      var debug = camera && camera._mirrorDebug && typeof camera._mirrorDebug === "object"
        ? camera._mirrorDebug
        : {};
      global.console.warn(
        "[DEBUG-MIRROR-CAMERA] label=" + String(label || "") +
        " frame=" + String(frameSpec && frameSpec.frame_id || config.frame_id || "") +
        " pos=" + fmtMirrorDebugVec3(camera && camera.pos) +
        " target=" + fmtMirrorDebugVec3(camera && camera.target) +
        " hasView=" + String(Array.isArray(camera && camera.view_matrix) && camera.view_matrix.length === 16) +
        " hasProj=" + String(Array.isArray(camera && camera.projection_matrix) && camera.projection_matrix.length === 16) +
        " planePoint=" + fmtMirrorDebugVec3(debug.planePoint) +
        " planeNormal=" + fmtMirrorDebugVec3(debug.planeNormal) +
        " clipApplied=" + String(debug.clipApplied === true) +
        (extra ? " " + String(extra) : "")
      );
    } catch (err) {
      void err;
    }
  }

  function resolveLinkedMirrorCamera(baseCamera, seconds) {
    var cameraCfg = config.camera || {};
    var props = cameraCfg && cameraCfg.properties && typeof cameraCfg.properties === "object"
      ? cameraCfg.properties
      : {};
    var sourceFrameId = String(props.reflect_of_frame_id || "").trim();
    var mirrorMeshId = String(props.reflect_mirror_mesh_id || "").trim();
    if (!sourceFrameId || !mirrorMeshId) {
      if (sourceFrameId || mirrorMeshId) {
        failFast("linked reflected camera requires both reflect_of_frame_id and reflect_mirror_mesh_id");
      }
      return baseCamera;
    }
    var sourceCamera = global.__vfNativeSceneLiveCameras[sourceFrameId];
    if (!sourceCamera || !Array.isArray(sourceCamera.pos) || !Array.isArray(sourceCamera.target)) {
      failFast('linked reflected camera source frame "' + sourceFrameId + '" is not registered');
    }
    var rawMeshes = Array.isArray(config.meshes) ? config.meshes : [];
    var mirrorMesh = normalizeMeshSpec(resolveRawMeshById(rawMeshes, mirrorMeshId, "linked reflected camera"), seconds, sourceCamera);
    try {
      var adapter = requirePlanarMirrorAdapterMethod("buildRenderCamera", "linked reflected camera");
      var mirrorPart = renderedMirrorPartForCamera(mirrorMesh, sourceCamera, "linked reflected camera");
      var frameRect = frameSpec && Array.isArray(frameSpec.rect) ? frameSpec.rect : [0, 0, 1, 1];
      var targetAspect = Math.max(1e-4, Number(frameRect[2] || 1.0) / Math.max(1e-4, Number(frameRect[3] || 1.0)));
      if (props.reflect_eye_only === true || props.lock_aperture_camera === true) {
        var planeSeed = buildMirrorEyeLockedCamera(sourceCamera, mirrorPart.mesh, baseCamera);
        var eyeLockedCamera = adapter.buildRenderCamera({
          part: mirrorPart,
          surfaceCamera: {
            pos: toVec3(sourceCamera.pos, [0.0, 0.0, 0.0]),
            target: toVec3(planeSeed.target, [0.0, 0.0, 0.0]),
            up: [0.0, 0.0, 1.0],
            fov: Number(sourceCamera.fov || 34.0) || 34.0,
            flip_x: planeSeed.flip_x === true
          },
          timeMs: seconds * 1000.0,
          targetAspect: targetAspect,
          math: global.VfGeomMath
        });
        debugMirrorCamera("linked-reflected-eye-locked", eyeLockedCamera, "source=" + sourceFrameId + " mirror=" + mirrorMeshId);
        return eyeLockedCamera;
      }
      var reflectedCamera = adapter.buildRenderCamera({
        part: mirrorPart,
        surfaceCamera: sourceCamera,
        timeMs: seconds * 1000.0,
        targetAspect: targetAspect,
        math: global.VfGeomMath
      });
      debugMirrorCamera("linked-reflected", reflectedCamera, "source=" + sourceFrameId + " mirror=" + mirrorMeshId);
      if (props.reflect_keep_world_up === true) {
        return {
          pos: toVec3(reflectedCamera.pos, toVec3(sourceCamera.pos, [0.0, 0.0, 0.0])),
          target: reflectedCamera && reflectedCamera._mirrorDebug && Array.isArray(reflectedCamera._mirrorDebug.reflectedTarget)
            ? toVec3(reflectedCamera._mirrorDebug.reflectedTarget, toVec3(reflectedCamera.target, [0.0, 0.0, 0.0]))
            : toVec3(reflectedCamera.target, [0.0, 0.0, 0.0]),
          up: toVec3(sourceCamera.up, [0.0, 0.0, 1.0]),
          fov: Number(reflectedCamera.fov || sourceCamera.fov || 34.0) || 34.0
        };
      }
      return reflectedCamera;
    } catch (err) {
      var message = err && err.message ? String(err.message) : String(err);
      failFast("linked reflected camera setup failed: " + message);
    }
  }

  function resolveMirrorApertureCamera(baseCamera, seconds, targetAspect) {
    var cameraCfg = config.camera || {};
    var props = cameraCfg && cameraCfg.properties && typeof cameraCfg.properties === "object"
      ? cameraCfg.properties
      : {};
    var mirrorMeshId = String(props.aperture_mirror_mesh_id || "").trim();
    if (!mirrorMeshId) {
      return baseCamera;
    }
    var forceAperture = props.lock_aperture_camera === true;
    if (Array.isArray(baseCamera && baseCamera.view_matrix) && baseCamera.view_matrix.length === 16 &&
        Array.isArray(baseCamera && baseCamera.projection_matrix) && baseCamera.projection_matrix.length === 16) {
      if (!forceAperture) {
        debugMirrorCamera("aperture-skip-existing-matrices", baseCamera, "mirror=" + mirrorMeshId);
        return baseCamera;
      }
      debugMirrorCamera("aperture-force-existing-matrices", baseCamera, "mirror=" + mirrorMeshId);
    }
    var rawMeshes = Array.isArray(config.meshes) ? config.meshes : [];
    var mirrorMesh = normalizeMeshSpec(resolveRawMeshById(rawMeshes, mirrorMeshId, "aperture camera"), seconds, baseCamera);
    try {
      var adapter = requirePlanarMirrorAdapterMethod("buildApertureCamera", "aperture camera");
      var mirrorPart = renderedMirrorPartForCamera(mirrorMesh, baseCamera, "aperture camera");
      var apertureCamera = adapter.buildApertureCamera({
        part: mirrorPart,
        surfaceCamera: baseCamera,
        timeMs: seconds * 1000.0,
        targetAspect: targetAspect,
        math: global.VfGeomMath
      });
      debugMirrorCamera("aperture-built", apertureCamera, "mirror=" + mirrorMeshId);
      return apertureCamera;
    } catch (err) {
      failFast("aperture camera setup failed: " + (err && err.message ? err.message : String(err)));
    }
  }

  function cameraBehaviorProps() {
    var cameraCfg = config.camera || {};
    var props = cameraCfg && cameraCfg.properties && typeof cameraCfg.properties === "object"
      ? cameraCfg.properties
      : {};
    if (cameraCfg && typeof cameraCfg === "object") {
      if (cameraCfg.controls_enabled !== undefined && props.controls_enabled === undefined) {
        props.controls_enabled = cameraCfg.controls_enabled;
      }
      if (cameraCfg.look_only_controls !== undefined && props.look_only_controls === undefined) {
        props.look_only_controls = cameraCfg.look_only_controls;
      }
      if (cameraCfg.controls_mode !== undefined && props.controls_mode === undefined) {
        props.controls_mode = cameraCfg.controls_mode;
      }
      if (props.controls_mode === "look_only" && props.look_only_controls === undefined) {
        props.look_only_controls = true;
      }
      if (cameraCfg.lock_aperture_camera !== undefined && props.lock_aperture_camera === undefined) {
        props.lock_aperture_camera = cameraCfg.lock_aperture_camera;
      }
    }
    return props;
  }

  function linkedSourceEyeKey() {
    var props = cameraBehaviorProps();
    var sourceFrameId = String(props.reflect_of_frame_id || "").trim();
    if (!sourceFrameId) { return ""; }
    var sourceCamera = global.__vfNativeSceneLiveCameras[sourceFrameId];
    if (!sourceCamera || !Array.isArray(sourceCamera.pos)) { return ""; }
    var pos = toVec3(sourceCamera.pos, [0.0, 0.0, 0.0]);
    return [
      Number(pos[0]).toFixed(6),
      Number(pos[1]).toFixed(6),
      Number(pos[2]).toFixed(6)
    ].join(",");
  }

  function registerFrameDependent(sourceFrameId, dependentFrameId, callback) {
    var key = String(sourceFrameId || "").trim();
    var depKey = String(dependentFrameId || "").trim();
    if (!key || !depKey || typeof callback !== "function") { return; }
    var registry = global.__vfNativeSceneFrameDependents;
    if (!registry[key]) {
      registry[key] = Object.create(null);
    }
    registry[key][depKey] = callback;
  }

  function triggerFrameDependents(sourceFrameId, options) {
    var key = String(sourceFrameId || "").trim();
    if (!key) { return; }
    options = options && typeof options === "object" ? options : {};
    var registry = global.__vfNativeSceneFrameDependents;
    var deps = registry && registry[key];
    if (!deps || typeof deps !== "object") { return; }
    var keys = Object.keys(deps);
    for (var i = 0; i < keys.length; i += 1) {
      var fn = deps[keys[i]];
      if (typeof fn !== "function") { continue; }
      try {
        fn(options);
      } catch (err) {
        failFast("dependent frame render failed for " + keys[i] + ": " + (err && err.message ? err.message : String(err)));
      }
    }
  }

  function fittedViewAspect(frameEl, bodyEl) {
    try {
      if (global.VfDisplay && typeof global.VfDisplay.geomFrameViewAspect === "function") {
        var frameId = String(frameSpec.frame_id || config.frame_id || "").trim();
        var exact = Number(global.VfDisplay.geomFrameViewAspect(frameId) || 0.0);
        if (exact > 1e-6) { return exact; }
      }
    } catch (err) {
      failFast("frame aspect lookup failed: " + (err && err.message ? err.message : String(err)));
    }
    var viewportEl = chessViewportElement(bodyEl) || bodyEl;
    var rect = viewportEl && typeof viewportEl.getBoundingClientRect === "function"
      ? viewportEl.getBoundingClientRect()
      : { width: 1, height: 1 };
    var width = Math.max(1, Number(rect.width || 1));
    var height = Math.max(1, Number(rect.height || 1));
    return Math.max(1e-4, width / Math.max(1, height));
  }

  function chessViewportElement(bodyEl) {
    if (!chessInteractionConfig() || !bodyEl || typeof bodyEl.querySelector !== "function") { return null; }
    return bodyEl.querySelector(".vf-chess-board-host") || null;
  }

  function resizeChessViewportToFit(bodyEl) {
    var host = chessViewportElement(bodyEl);
    if (!host) { return null; }
    host.style.width = "100%";
    host.style.height = "100%";
    host.style.maxWidth = "none";
    host.style.maxHeight = "none";
    return host;
  }

  function visibleViewportRect(bodyEl) {
    var viewportEl = resizeChessViewportToFit(bodyEl) || chessViewportElement(bodyEl) || bodyEl;
    return viewportEl && typeof viewportEl.getBoundingClientRect === "function"
      ? viewportEl.getBoundingClientRect()
      : { width: 1, height: 1 };
  }

  function legacyVisibleFrameRect(bodyEl) {
    return bodyEl && typeof bodyEl.getBoundingClientRect === "function"
      ? bodyEl.getBoundingClientRect()
      : { width: 1, height: 1 };
  }

  function sceneFrameVisible() {
    return !((frameSpec && frameSpec.visible === false) || (config && config.visible === false));
  }

  function offscreenFramePixels() {
    var rect = frameSpec && Array.isArray(frameSpec.rect) ? frameSpec.rect : [0, 0, 1, 1];
    var viewportW = Math.max(1, Number(global.innerWidth || 1280) || 1280);
    var viewportH = Math.max(1, Number(global.innerHeight || 720) || 720);
    var width = Math.max(1, Math.round(viewportW * Math.max(0.01, Number(rect[2] || 1.0))));
    var height = Math.max(1, Math.round(viewportH * Math.max(0.01, Number(rect[3] || 1.0))));
    if (String(frameSpec && frameSpec.aspect || "").toLowerCase() === "equal" && !chessInteractionConfig()) {
      var fit = Math.max(1, Math.min(width, height));
      width = fit;
      height = fit;
    }
    var explicitScale = renderOptions.offscreen_scale != null || renderOptions.mirror_source_scale != null;
    var explicitMaxPx = renderOptions.offscreen_max_px != null || renderOptions.mirror_source_max_px != null;
    var offscreenScale = explicitScale
      ? Math.max(0.1, Math.min(1.0, Number(renderOptions.offscreen_scale || renderOptions.mirror_source_scale || 1.0) || 1.0))
      : 1.0;
    var offscreenMaxPx = explicitMaxPx
      ? Math.max(128, Math.round(Number(renderOptions.offscreen_max_px || renderOptions.mirror_source_max_px || 4096) || 4096))
      : 4096;
    var scaledW = Math.max(1, Math.round(width * offscreenScale));
    var scaledH = Math.max(1, Math.round(height * offscreenScale));
    var longest = Math.max(scaledW, scaledH);
    if (longest > offscreenMaxPx) {
      var maxScale = offscreenMaxPx / Math.max(1, longest);
      scaledW = Math.max(1, Math.round(scaledW * maxScale));
      scaledH = Math.max(1, Math.round(scaledH * maxScale));
    }
    width = scaledW;
    height = scaledH;
    return { width: width, height: height };
  }

  function visibleFramePixels(frameEl, bodyEl) {
    var rect = chessInteractionConfig() ? visibleViewportRect(bodyEl) : legacyVisibleFrameRect(bodyEl);
    var width = Math.max(1, Number(rect.width || 1) || 1);
    var height = Math.max(1, Number(rect.height || 1) || 1);
    if (String(frameSpec && frameSpec.aspect || "").toLowerCase() === "equal" && !chessInteractionConfig()) {
      var fit = Math.max(1, Math.min(width, height));
      width = fit;
      height = fit;
    }
    return { width: width, height: height };
  }

  function normalizeFrameRectSpec() {
    var rect = frameSpec && Array.isArray(frameSpec.rect) ? frameSpec.rect : [0, 0, 1, 1];
    function clamp01(v, fallback) {
      var n = Number(v);
      if (!isFinite(n)) { n = fallback; }
      return Math.max(0, Math.min(1, n));
    }
    return {
      x: clamp01(rect[0], 0),
      y: clamp01(rect[1], 0),
      w: Math.max(0.01, clamp01(rect[2], 1)),
      h: Math.max(0.01, clamp01(rect[3], 1))
    };
  }

  function applyVisibleFrameRect(panel) {
    if (!panel || !panel.root) { return; }
    var parent = panel.root.offsetParent || panel.root.parentElement || document.body;
    var parentW = Math.max(1, Number(parent && parent.clientWidth || global.innerWidth || 1280) || 1280);
    var parentH = Math.max(1, Number(parent && parent.clientHeight || global.innerHeight || 720) || 720);
    var rect = normalizeFrameRectSpec();
    var width = Math.max(1, Math.round(rect.w * parentW));
    var height = Math.max(1, Math.round(rect.h * parentH));
    if (String(frameSpec && frameSpec.aspect || "").toLowerCase() === "equal" && !chessInteractionConfig()) {
      var header = panel.root.querySelector ? panel.root.querySelector(".vf-frame__header") : null;
      var headerH = header && typeof header.getBoundingClientRect === "function"
        ? Math.max(0, Math.round(header.getBoundingClientRect().height || 0))
        : 34;
      var fit = Math.max(1, Math.min(width, Math.max(1, height - headerH)));
      width = fit;
      height = fit + headerH;
    }
    panel.root.style.left = Math.round(rect.x * parentW) + "px";
    panel.root.style.top = Math.round(rect.y * parentH) + "px";
    panel.root.style.width = width + "px";
    panel.root.style.height = height + "px";
    panel.root.style.right = "auto";
    panel.root.style.bottom = "auto";
    panel.root.style.opacity = "1";
  }

  function ensureVisibleSceneFrameShell() {
    if (!sceneFrameVisible()) { return null; }
    var frameId = String(frameSpec.frame_id || config.frame_id || "").trim();
    if (!frameId) { return null; }
    var existing = document.querySelector('.vf-frame[data-vf-frame-id="' + frameId + '"]');
    if (existing) { return existing; }
    if (!global.VfFrame || typeof global.VfFrame.mount !== "function") {
      return null;
    }
    var layer = document.body || document.documentElement;
    if (!layer) { return null; }
    var shellAspect = chessInteractionConfig() ? null : (frameSpec.aspect != null ? String(frameSpec.aspect) : null);
    var panel = global.VfFrame.mount(layer, {
      id: frameId,
      title: String(frameSpec.title || config.title || ""),
      titleAlign: String(frameSpec.title_align || "left"),
      aspect: shellAspect,
      inLayerDrag: true,
      draggable: true,
      dockable: true,
      resizable: true,
      closable: true,
      exitWhenLastFrameClosed: true,
      alpha: 1,
      bodyTransparent: false,
      frameless: frameSpec.frameless === true,
      dockLocation: "bl",
      zIndexBase: 1000,
      onFrameRemoved: function () {
        var chessRuntime = global.__vfNativeChessRuntime || null;
        if (chessRuntime && chessRuntime.panelFrame && typeof chessRuntime.panelFrame.destroy === "function") {
          try { chessRuntime.panelFrame.destroy(); } catch (_) {}
          chessRuntime.panelFrame = null;
          chessRuntime.panel = null;
          chessRuntime.panelBody = null;
        } else if (chessRuntime && chessRuntime.panel && chessRuntime.panel.parentNode) {
          try { chessRuntime.panel.parentNode.removeChild(chessRuntime.panel); } catch (_) {}
          chessRuntime.panel = null;
          chessRuntime.panelBody = null;
        }
      }
    });
    if (chessInteractionConfig() && panel && panel.root && panel.body) {
      panel.root.setAttribute("data-vf-chess-board-frame", "1");
      panel.root.classList.add(String((chessInteractionConfig() || {}).controls_frame_class || "vf-chess-frame"));
      var boardHost = panel.body.querySelector(".vf-chess-board-host");
      if (!boardHost) {
        boardHost = document.createElement("div");
        boardHost.className = "vf-chess-board-host";
        panel.body.insertBefore(boardHost, panel.body.firstChild || null);
      }
    }
    applyVisibleFrameRect(panel);
    global.setTimeout(function () { applyVisibleFrameRect(panel); }, 0);
    return panel && panel.root ? panel.root : null;
  }

  function frameCameraConfigSignature() {
    try {
      return JSON.stringify({
        frame_id: frameSpec && frameSpec.frame_id || config.frame_id || "",
        visible: frameSpec && frameSpec.visible,
        camera: config.camera || null,
        meshes: (Array.isArray(config.meshes) ? config.meshes : []).map(function (mesh) {
          return {
            id: mesh && mesh.id,
            kind: mesh && mesh.kind,
            properties: mesh && mesh.properties,
            center: mesh && mesh.center,
            size: mesh && mesh.size,
            rotation: mesh && mesh.rotation,
            transform: mesh && mesh.transform,
            surface_system: mesh && mesh.surface_system,
            reverse_facing: mesh && mesh.reverse_facing
          };
        })
      });
    } catch (err) {
      failFast("frame camera config signature failed: " + (err && err.message ? err.message : String(err)));
    }
  }

  function boot() {
    requireRuntime();
    var frame = document.querySelector('.vf-frame[data-vf-frame-id="' + String(frameSpec.frame_id || config.frame_id) + '"]');
    if (!frame && sceneFrameVisible()) {
      frame = ensureVisibleSceneFrameShell();
    }
    var body = frame ? frame.querySelector(".vf-frame__body") : null;
    var cameraFallback = { pos: [3.9, -5.6, 3.2], target: [0, 0, 0.9], fov: 34, up: [0, 0, 1], min_distance: 0.0 };
    var watchedFrameId = String(frameSpec.frame_id || config.frame_id);
    if (!global.__vfNativeSceneCameraControls) {
      global.__vfNativeSceneCameraControls = {
        activeFrameId: "",
        states: Object.create(null)
      };
    }
    var controlRegistry = global.__vfNativeSceneCameraControls;
    if (!controlRegistry.states[watchedFrameId]) {
        controlRegistry.states[watchedFrameId] = {
          zoomFactor: 1.0,
          orbitPhi: 0.0,
          orbitTheta: 0.0,
          orbitStep: cameraOrbitStepRadians(config.camera || {}),
          orbitSpeedRadPerSec: Math.max(cameraOrbitStepRadians(config.camera || {}) * 18.0, Math.PI * 0.45),
          controlsEnabled: cameraBehaviorProps().controls_enabled !== false,
          lookOnlyControls: cameraBehaviorProps().look_only_controls === true,
          lockApertureCamera: cameraBehaviorProps().lock_aperture_camera === true,
          apertureInitDone: false,
          userInteracted: false,
          linkedEyeKey: "",
          baseCamera: null,
          exactInitCamera: null,
          playerSideCameraStates: Object.create(null),
          activePlayerSide: "white",
          rendering: false,
          lastRenderTsMs: 0.0,
          cameraFramePending: false,
          continuationFramePending: false,
          cameraSwitch: null,
          pendingAutoSwitchCamera: false,
          pendingAutoSwitchSide: "white",
          keyLeft: false,
          keyRight: false,
          keyUp: false,
          keyDown: false,
          cameraKeyLastTsMs: 0.0,
          cameraKeyStepPending: false,
          dependencyWaitStartMs: 0.0
        };
      }
    var controlState = controlRegistry.states[watchedFrameId];
    if (!global.__vfNativeScenePerf) {
      global.__vfNativeScenePerf = Object.create(null);
    }
    if (!global.__vfNativeScenePerf[watchedFrameId]) {
      global.__vfNativeScenePerf[watchedFrameId] = {
        fullSceneUpdates: 0,
        cameraOnlyUpdates: 0
      };
    }
    var scenePerf = global.__vfNativeScenePerf[watchedFrameId];
    var configSignature = frameCameraConfigSignature();
    controlState.zoomFactor = 1.0;
    controlState.orbitPhi = 0.0;
    controlState.orbitTheta = 0.0;
    controlState.keyLeft = false;
    controlState.keyRight = false;
    controlState.keyUp = false;
    controlState.keyDown = false;
    controlState.cameraKeyLastTsMs = 0.0;
    controlState.cameraKeyStepPending = false;
    controlState.cameraFramePending = false;
    controlState.continuationFramePending = false;
    controlState.cameraSwitch = null;
    controlState.pendingAutoSwitchCamera = false;
    controlState.pendingAutoSwitchSide = "white";
    controlState.apertureInitDone = false;
    controlState.userInteracted = false;
    controlState.linkedEyeKey = "";
    controlState.baseCamera = null;
    controlState.exactInitCamera = null;
    controlState.dependencyWaitStartMs = 0.0;
    controlState.configSignature = configSignature;
    controlState.debugCameraRequestCount = 0;
    controlState.debugCameraRequestCoalescedCount = 0;
    controlState.debugRenderFrameCount = 0;
    controlState.debugRenderFrameSkippedCount = 0;
    var useVisibleFrame = sceneFrameVisible();
    var dependencySourceFrameId = String(cameraBehaviorProps().reflect_of_frame_id || "").trim();
    var cameraOnlyFastPathEnabled = !!chessInteractionConfig();
    var offscreenSpec = null;
    var offscreenMounted = false;
    var visibleSpec = null;
    var visibleMounted = false;
    var visibleLastDirtyVersion = -1;
    var visibleLastMeshStructureSignature = "";
    var offscreenLastDirtyVersion = -1;
    var offscreenLastMeshStructureSignature = "";
    var offscreenPixels = null;
    if (!useVisibleFrame) {
      if (!global.VfDisplay || typeof global.VfDisplay.mountOffscreenGeomFrame !== "function") {
        failFast("offscreen scene frame support is unavailable");
      }
      offscreenPixels = offscreenFramePixels();
      if (dependencySourceFrameId) {
        registerFrameDependent(dependencySourceFrameId, watchedFrameId, function (dependencyOptions) {
          dependencyOptions = dependencyOptions && typeof dependencyOptions === "object" ? dependencyOptions : {};
          if (dependencyOptions.immediate !== true) {
            failFast('dependent reflected frame "' + watchedFrameId + '" requires immediate source-synchronous rendering');
          }
          if (controlState.rendering === true) {
            failFast('dependent reflected frame "' + watchedFrameId + '" cannot render synchronously while already rendering');
          }
          renderFrame();
        });
      }
    }
    function ensureVisibleGeomMount() {
      if (!useVisibleFrame || visibleMounted) { return; }
      if (!global.VfDisplay || typeof global.VfDisplay.mountDynamicGeomFrame !== "function") {
        failFast("visible scene frame support is unavailable");
      }
      global.VfDisplay.mountDynamicGeomFrame(watchedFrameId, function () {
        return visibleSpec;
      });
      visibleMounted = true;
    }
    function pushVisibleRender(rendered, options) {
      options = options && typeof options === "object" ? options : {};
      var payload = rendered && rendered.payload && typeof rendered.payload === "object"
        ? rendered.payload
        : { screen: [], frames: {}, geom: {} };
      var geomPayload = payload.geom && typeof payload.geom === "object"
        ? payload.geom[watchedFrameId] || null
        : null;
      var has2dPayload = !!(
        (Array.isArray(payload.screen) && payload.screen.length > 0) ||
        (payload.frames && typeof payload.frames === "object" && Object.keys(payload.frames).length > 0)
      );
      if (geomPayload && !has2dPayload) {
        var nextVisibleSpec = Object.assign({}, geomPayload);
        if (nextVisibleSpec && nextVisibleSpec.camera && frame && body) {
          nextVisibleSpec.camera = visibleCameraWithViewport(nextVisibleSpec.camera);
        }
        visibleSpec = nextVisibleSpec;
        ensureVisibleGeomMount();
        scenePerf.fullSceneUpdates += 1;
        global.VfDisplay.requestDynamicGeomFrameUpdate(watchedFrameId, { immediate: options.immediate === true });
        return;
      }
      global.VfDisplay.renderFromJson(payload);
    }
    function visibleCameraWithViewport(camera) {
      var nextCamera = cloneJsonValue(camera || {});
      if (nextCamera && frame && body) {
        var fitRect = visibleFramePixels(frame, body);
        nextCamera.viewport_width_px = Math.max(1, Math.round(fitRect.width || 1));
        nextCamera.viewport_height_px = Math.max(1, Math.round(fitRect.height || 1));
        if (chessInteractionConfig() && Array.isArray(nextCamera.projection_matrix)) {
          delete nextCamera.projection_matrix;
        }
      }
      return nextCamera;
    }
    function updateVisibleCameraOnly(camera, options) {
      options = options && typeof options === "object" ? options : {};
      if (!useVisibleFrame || !visibleSpec || !global.VfDisplay || typeof global.VfDisplay.updateDynamicGeomFrameCamera !== "function") {
        return false;
      }
      var nextCamera = visibleCameraWithViewport(camera);
      visibleSpec.camera = nextCamera;
      return global.VfDisplay.updateDynamicGeomFrameCamera(
        watchedFrameId,
        nextCamera,
        visibleSpec.lights || [],
        visibleSpec.light_flares || null,
        { immediate: options.immediate === true }
      ) === true;
    }
    function updateOffscreenCameraOnly(camera, options) {
      options = options && typeof options === "object" ? options : {};
      if (useVisibleFrame || !offscreenSpec || !global.VfDisplay || typeof global.VfDisplay.updateDynamicGeomFrameCamera !== "function") {
        return false;
      }
      offscreenSpec.camera = camera;
      return global.VfDisplay.updateDynamicGeomFrameCamera(
        watchedFrameId,
        camera,
        offscreenSpec.lights || [],
        offscreenSpec.light_flares || null,
        { immediate: options.immediate === true }
      ) === true;
    }
    function cameraKeysActive() {
      return controlState.keyLeft === true ||
        controlState.keyRight === true ||
        controlState.keyUp === true ||
        controlState.keyDown === true;
    }
    if (useVisibleFrame && chessInteractionConfig() && global.addEventListener) {
      global.addEventListener("vf-frame-live-resize", function (ev) {
        var detail = ev && ev.detail ? ev.detail : {};
        var liveFrameId = String(detail.frameId || detail.id || "");
        if (liveFrameId !== String(watchedFrameId || "")) { return; }
        resizeChessViewportToFit(body);
      }, true);
    }
    function cameraSwitchActive() {
      return !!(controlState.cameraSwitch && controlState.cameraSwitch.active === true);
    }
    function lerpNumber(a, b, t) {
      return Number(a || 0.0) + ((Number(b || 0.0) - Number(a || 0.0)) * t);
    }
    function lerpVec3(a, b, t) {
      a = toVec3(a, [0.0, 0.0, 0.0]);
      b = toVec3(b, [0.0, 0.0, 0.0]);
      return [lerpNumber(a[0], b[0], t), lerpNumber(a[1], b[1], t), lerpNumber(a[2], b[2], t)];
    }
    function smoothStep(t) {
      t = Math.max(0.0, Math.min(1.0, Number(t || 0.0)));
      return t * t * (3.0 - (2.0 * t));
    }
    function playerSideCamera(camera, side) {
      var source = cloneCameraState(camera, cameraFallback);
      var target = [0.0, 0.0, Number(toVec3(source.target, [0.0, 0.0, 0.9])[2] || 0.9)];
      var pos = toVec3(source.pos, [3.9, -5.6, 3.2]);
      var sideName = String(side || "white").toLowerCase();
      var sideY = Math.max(0.1, Math.abs(Number(pos[1] || 0.0) || 5.6));
      return {
        pos: [pos[0], sideName === "black" ? sideY : -sideY, pos[2]],
        target: target,
        fov: Number(source.fov || 34.0) || 34.0,
        up: toVec3(source.up, [0.0, 0.0, 1.0]),
        min_distance: Number(source.min_distance || 0.0) || 0.0,
        flip_x: source.flip_x === true
      };
    }
    function normalizePlayerSide(side) {
      return String(side || "white").toLowerCase() === "black" ? "black" : "white";
    }
    function cameraFromPlayerSideState(state, seedCamera) {
      var base = cloneCameraState(state && state.baseCamera || seedCamera, cameraFallback);
      var camera = cloneCameraState(base, cameraFallback);
      if (cameraBehaviorProps().look_only_controls === true) {
        camera = zoomCamera(camera, Math.max(0.35, Math.min(2.5, Number(state && state.zoomFactor || 1.0) || 1.0)));
        camera = orbitCameraAroundTarget(camera, Number(state && state.orbitPhi || 0.0) || 0.0, Number(state && state.orbitTheta || 0.0) || 0.0);
      }
      return camera;
    }
    function ensurePlayerSideCameraState(side, seedCamera) {
      var sideName = normalizePlayerSide(side);
      if (!controlState.playerSideCameraStates) {
        controlState.playerSideCameraStates = Object.create(null);
      }
      if (!controlState.playerSideCameraStates[sideName]) {
        controlState.playerSideCameraStates[sideName] = {
          baseCamera: playerSideCamera(seedCamera, sideName),
          zoomFactor: 1.0,
          orbitPhi: 0.0,
          orbitTheta: 0.0
        };
      }
      return controlState.playerSideCameraStates[sideName];
    }
    function storeActivePlayerSideCamera(camera) {
      var sideName = normalizePlayerSide(controlState.activePlayerSide || "white");
      if (!controlState.playerSideCameraStates) {
        controlState.playerSideCameraStates = Object.create(null);
      }
      controlState.playerSideCameraStates[sideName] = {
        baseCamera: cloneCameraState(controlState.baseCamera || camera, cameraFallback),
        zoomFactor: Math.max(0.35, Math.min(2.5, Number(controlState.zoomFactor || 1.0) || 1.0)),
        orbitPhi: Number(controlState.orbitPhi || 0.0) || 0.0,
        orbitTheta: Number(controlState.orbitTheta || 0.0) || 0.0
      };
    }
    function activatePlayerSideCameraState(side, seedCamera) {
      var sideName = normalizePlayerSide(side);
      var state = ensurePlayerSideCameraState(sideName, seedCamera);
      controlState.activePlayerSide = sideName;
      controlState.baseCamera = cloneCameraState(state.baseCamera, cameraFallback);
      controlState.zoomFactor = Math.max(0.35, Math.min(2.5, Number(state.zoomFactor || 1.0) || 1.0));
      controlState.orbitPhi = Number(state.orbitPhi || 0.0) || 0.0;
      controlState.orbitTheta = Number(state.orbitTheta || 0.0) || 0.0;
      controlState.exactInitCamera = null;
      return cameraFromPlayerSideState(state, seedCamera);
    }
    function startAutoSwitchCamera(camera, side) {
      var from = cloneCameraState(camera, cameraFallback);
      storeActivePlayerSideCamera(from);
      var sideName = normalizePlayerSide(side);
      var toState = ensurePlayerSideCameraState(sideName, from);
      var to = cameraFromPlayerSideState(toState, from);
      controlState.cameraSwitch = {
        active: true,
        from: from,
        to: to,
        toSide: sideName,
        toState: toState,
        start_ms: global.performance && typeof global.performance.now === "function" ? global.performance.now() : Date.now(),
        duration_ms: 650.0
      };
      controlState.userInteracted = true;
    }
    function applyCameraSwitch(camera) {
      var sw = controlState.cameraSwitch;
      if (!sw || sw.active !== true) { return camera; }
      var now = global.performance && typeof global.performance.now === "function" ? global.performance.now() : Date.now();
      var t = Math.max(0.0, Math.min(1.0, (now - Number(sw.start_ms || now)) / Math.max(1.0, Number(sw.duration_ms || 650.0))));
      var eased = smoothStep(t);
      var out = {
        pos: lerpVec3(sw.from.pos, sw.to.pos, eased),
        target: lerpVec3(sw.from.target, sw.to.target, eased),
        up: lerpVec3(sw.from.up, sw.to.up, eased),
        fov: lerpNumber(sw.from.fov, sw.to.fov, eased),
        min_distance: lerpNumber(sw.from.min_distance, sw.to.min_distance, eased),
        flip_x: sw.to.flip_x === true
      };
      if (t >= 1.0) {
        sw.active = false;
        controlState.cameraSwitch = null;
        activatePlayerSideCameraState(sw.toSide || "white", sw.to);
      }
      return out;
    }
    function visibleRenderBackpressureActive() {
      return useVisibleFrame &&
        global.VfDisplay &&
        typeof global.VfDisplay.dynamicGeomFrameHasRenderBackpressure === "function" &&
        global.VfDisplay.dynamicGeomFrameHasRenderBackpressure(watchedFrameId) === true;
    }
    function scheduleNextFrameIfNeeded(animationActive) {
      if (!useVisibleFrame && dependencySourceFrameId) { return; }
      if (controlState.continuationFramePending === true) { return; }
      if (cameraKeysActive()) {
        ensureCameraHoldLoop(controlState);
        return;
      }
      if (animationActive === true || cameraSwitchActive()) {
        controlState.continuationFramePending = true;
        global.requestAnimationFrame(function () {
          controlState.continuationFramePending = false;
          renderFrame();
        });
      }
    }
    function finishRenderFrame(animationActive, triggerDependentsAfter) {
      controlState.rendering = false;
      if (triggerDependentsAfter === true) {
        triggerFrameDependents(String(frameSpec.frame_id || config.frame_id), { immediate: true });
      }
      scheduleNextFrameIfNeeded(animationActive);
    }
    function renderFrameDependentsBeforePresent() {
      triggerFrameDependents(String(frameSpec.frame_id || config.frame_id), { immediate: true });
    }
    function publishLiveCamera(renderCamera, markerReferenceHeightPx, markerSizeCamera) {
      var liveCamera = {
        pos: toVec3(renderCamera.pos, [0, 0, 0]),
        target: toVec3(renderCamera.target, [0, 0, 0]),
        up: toVec3(renderCamera.up, [0, 0, 1]),
        fov: Number(renderCamera.fov || 34.0) || 34.0,
        viewport_height_px: markerReferenceHeightPx,
        viewport_marker_reference_height_px: markerReferenceHeightPx,
        flip_x: renderCamera.flip_x === true
      };
      renderCamera.viewport_marker_reference_height_px = markerReferenceHeightPx;
      renderCamera.viewport_height_px = markerReferenceHeightPx;
      if (markerSizeCamera) {
        renderCamera._marker_size_camera = markerSizeCamera;
      }
      if (Array.isArray(renderCamera.view_matrix) && renderCamera.view_matrix.length === 16) {
        liveCamera.view_matrix = renderCamera.view_matrix.slice();
      }
      if (Array.isArray(renderCamera.projection_matrix) && renderCamera.projection_matrix.length === 16) {
        liveCamera.projection_matrix = renderCamera.projection_matrix.slice();
      }
      global.__vfNativeSceneLiveCameras[String(frameSpec.frame_id || config.frame_id)] = liveCamera;
    }
    function ensureCameraHoldLoop(state) {
      if (!state || state.cameraHoldLoopPending === true) { return; }
      if (!(state.keyLeft === true || state.keyRight === true || state.keyUp === true || state.keyDown === true)) { return; }
      state.cameraHoldLoopPending = true;
      global.setTimeout(function () {
        state.cameraHoldLoopPending = false;
        if (!(state.keyLeft === true || state.keyRight === true || state.keyUp === true || state.keyDown === true)) { return; }
        if (typeof state.requestCameraHoldFrame === "function") {
          state.requestCameraHoldFrame();
        } else if (typeof state.requestCameraFrame === "function") {
          state.requestCameraFrame();
        }
        ensureCameraHoldLoop(state);
      });
    }
    controlState.requestCameraFrame = function () {
      controlState.debugCameraRequestCount = Number(controlState.debugCameraRequestCount || 0) + 1;
      if (controlState.controlsEnabled === false || controlState.cameraFramePending === true) {
        controlState.debugCameraRequestCoalescedCount = Number(controlState.debugCameraRequestCoalescedCount || 0) + 1;
        controlState.cameraFrameDirty = true;
        ensureCameraHoldLoop(controlState);
        if (controlState.debugCameraRequestCoalescedCount <= 3 || controlState.debugCameraRequestCoalescedCount % 20 === 0) {
          chessLagDebug(
            "camera_request_coalesced requests=" + Number(controlState.debugCameraRequestCount || 0) +
              " coalesced=" + Number(controlState.debugCameraRequestCoalescedCount || 0) +
              " rendering=" + (controlState.rendering === true ? "1" : "0")
          );
        }
        return;
      }
      controlState.cameraFramePending = true;
      function flushCameraFrame(attempt) {
        if (controlState.rendering === true && attempt < 30) {
          controlState.cameraFrameDirty = true;
          global.requestAnimationFrame(function () { flushCameraFrame(attempt + 1); });
          return;
        }
        controlState.cameraFramePending = false;
        controlState.cameraFrameDirty = false;
        renderFrame();
      }
      global.requestAnimationFrame(function () { flushCameraFrame(0); });
    };
    controlState.requestCameraHoldFrame = function () {
      controlState.debugCameraRequestCount = Number(controlState.debugCameraRequestCount || 0) + 1;
      if (controlState.controlsEnabled === false) { return; }
      if (controlState.rendering === true) {
        controlState.cameraFrameDirty = true;
        ensureCameraHoldLoop(controlState);
        return;
      }
      controlState.cameraFramePending = false;
      renderFrame();
    };
    function markActiveFrame() {
      controlRegistry.activeFrameId = watchedFrameId;
    }
    function applyWheelZoom(state, ev) {
      if (!state) { return; }
      if (state.controlsEnabled === false) { return; }
      if (ev && typeof ev.preventDefault === "function") {
        ev.preventDefault();
      }
      var rawDelta = Number(ev && ev.deltaY);
      var direction = rawDelta > 0 ? 1 : -1;
      var magnitude = Math.max(1.0, Math.min(4.0, Math.abs(rawDelta) / 100.0 || 1.0));
      var step = 0.25 * magnitude;
      var factor = direction > 0 ? (1.0 + step) : (1.0 / (1.0 + step));
      state.zoomFactor = Math.max(1e-6, Number(state.zoomFactor || 1.0) * factor);
      state.userInteracted = true;
      if (typeof state.requestCameraFrame === "function") {
        state.requestCameraFrame();
      }
    }
    function handleWheelZoom(ev) {
      markActiveFrame();
      applyWheelZoom(controlState, ev);
    }
    function attachFrameZoomTarget(target) {
      if (!target || target.__vfWheelZoomAttached) { return; }
      target.__vfWheelZoomAttached = true;
      target.addEventListener("pointerenter", markActiveFrame, { passive: true });
      target.addEventListener("pointermove", markActiveFrame, { passive: true });
      target.addEventListener("pointerdown", markActiveFrame, { passive: true });
    }
    function eventFrameId(ev) {
      var target = ev && ev.target;
      var frameEl = target && typeof target.closest === "function" ? target.closest(".vf-frame") : null;
      if (!frameEl && ev && typeof ev.composedPath === "function") {
        var path = ev.composedPath();
        for (var i = 0; i < path.length; i++) {
          var node = path[i];
          if (node && typeof node.getAttribute === "function" && node.classList && node.classList.contains("vf-frame")) {
            frameEl = node;
            break;
          }
        }
      }
      return frameEl ? String(frameEl.getAttribute("data-vf-frame-id") || "").trim() : "";
    }
    function keyEventTargetsTextInput(ev) {
      var target = ev && ev.target;
      if (!target) { return false; }
      var tagName = String(target.tagName || "").toLowerCase();
      if (tagName === "input" || tagName === "textarea" || tagName === "select") { return true; }
      return target.isContentEditable === true;
    }
    function keyEventAllowedForActiveFrame(ev, activeFrameId) {
      if (keyEventTargetsTextInput(ev)) { return false; }
      var fid = eventFrameId(ev);
      return !fid || fid === activeFrameId;
    }
    if (useVisibleFrame) {
      attachFrameZoomTarget(frame);
      attachFrameZoomTarget(body);
      markActiveFrame();
    }
    if (!global.__vfNativeSceneGlobalWheelAttached) {
      global.__vfNativeSceneGlobalWheelAttached = true;
      global.addEventListener("wheel", function (ev) {
        var registry = global.__vfNativeSceneCameraControls;
        var activeFrameId = String(registry && registry.activeFrameId || "").trim();
        if (!activeFrameId) { return; }
        var activeState = registry && registry.states ? registry.states[activeFrameId] : null;
        if (!activeState) { return; }
        var fid = eventFrameId(ev);
        if (!fid || fid !== activeFrameId) { return; }
        applyWheelZoom(activeState, ev);
      }, { passive: false, capture: true });
    }
    if (!global.__vfNativeSceneArrowOrbitAttached) {
      global.__vfNativeSceneArrowOrbitAttached = true;
      global.addEventListener("keydown", function (ev) {
        var key = String(ev && ev.key || "");
        if (key !== "ArrowLeft" && key !== "ArrowRight" && key !== "ArrowUp" && key !== "ArrowDown") { return; }
        var activeFrameId = String(global.__vfNativeSceneCameraControls && global.__vfNativeSceneCameraControls.activeFrameId || "").trim();
        var activeState = activeFrameId && global.__vfNativeSceneCameraControls && global.__vfNativeSceneCameraControls.states
          ? global.__vfNativeSceneCameraControls.states[activeFrameId]
          : null;
        if (!activeState) { return; }
        if (activeState.controlsEnabled === false) { return; }
        if (!keyEventAllowedForActiveFrame(ev, activeFrameId)) { return; }
        ev.preventDefault();
        var wasActive = activeState.keyLeft === true || activeState.keyRight === true || activeState.keyUp === true || activeState.keyDown === true;
        if (key === "ArrowLeft") { activeState.keyLeft = true; }
        else if (key === "ArrowRight") { activeState.keyRight = true; }
        else if (key === "ArrowUp") { activeState.keyUp = true; }
        else if (key === "ArrowDown") { activeState.keyDown = true; }
        if (!wasActive || Number(activeState.cameraKeyLastTsMs || 0.0) <= 0.0) {
          activeState.cameraKeyLastTsMs = global.performance && typeof global.performance.now === "function"
            ? global.performance.now()
            : Date.now();
        }
        activeState.userInteracted = true;
        ensureCameraHoldLoop(activeState);
        if (typeof activeState.requestCameraHoldFrame === "function") {
          activeState.requestCameraHoldFrame();
        } else if (typeof activeState.requestCameraFrame === "function") {
          activeState.requestCameraFrame();
        }
      }, true);
      global.addEventListener("keyup", function (ev) {
        var key = String(ev && ev.key || "");
        if (key !== "ArrowLeft" && key !== "ArrowRight" && key !== "ArrowUp" && key !== "ArrowDown") { return; }
        var activeFrameId = String(global.__vfNativeSceneCameraControls && global.__vfNativeSceneCameraControls.activeFrameId || "").trim();
        var activeState = activeFrameId && global.__vfNativeSceneCameraControls && global.__vfNativeSceneCameraControls.states
          ? global.__vfNativeSceneCameraControls.states[activeFrameId]
          : null;
        if (!activeState) { return; }
        if (!keyEventAllowedForActiveFrame(ev, activeFrameId)) { return; }
        if (key === "ArrowLeft") { activeState.keyLeft = false; }
        else if (key === "ArrowRight") { activeState.keyRight = false; }
        else if (key === "ArrowUp") { activeState.keyUp = false; }
        else if (key === "ArrowDown") { activeState.keyDown = false; }
        if (!(activeState.keyLeft === true || activeState.keyRight === true || activeState.keyUp === true || activeState.keyDown === true)) {
          activeState.cameraKeyLastTsMs = 0.0;
          activeState.cameraKeyStepPending = false;
        }
        if (typeof activeState.requestCameraFrame === "function") {
          activeState.requestCameraFrame();
        }
      }, true);
      global.addEventListener("blur", function () {
        var registry = global.__vfNativeSceneCameraControls;
        if (!registry || !registry.states) { return; }
        var frameIds = Object.keys(registry.states);
        for (var i = 0; i < frameIds.length; i += 1) {
          var state = registry.states[frameIds[i]];
          if (!state) { continue; }
          state.keyLeft = false;
          state.keyRight = false;
          state.keyUp = false;
          state.keyDown = false;
          state.cameraKeyLastTsMs = 0.0;
          state.cameraKeyStepPending = false;
        }
      }, true);
    }
    var chessRuntime = null;
    function ensureChessRuntimeEventsAttached() {
      chessRuntime = initChessRuntime();
      if (chessRuntime && !chessRuntime.eventsAttached) {
        chessRuntime.eventsAttached = true;
        global.addEventListener("vf_event", function (ev) {
          try {
            handleChessEvent(chessRuntime, ev && ev.detail ? ev.detail : null);
          } catch (err) {
            failFast("chess interaction failed: " + (err && err.message ? err.message : String(err)));
          }
        });
      }
      return chessRuntime;
    }

    function ensureGeomRendererReady(attempt) {
      var status = global.VfDisplay && typeof global.VfDisplay.geomFrameStatus === "function"
        ? global.VfDisplay.geomFrameStatus(watchedFrameId)
        : null;
      if (status && status.runningRenderers > 0) {
        clearStatusOverlay();
        return;
      }
      if (status) {
        var runtimeFailures = Array.isArray(status.runtimeFailures) ? status.runtimeFailures.filter(Boolean) : [];
        var initFailures = Array.isArray(status.initFailures) ? status.initFailures.filter(Boolean) : [];
        if (runtimeFailures.length || initFailures.length) {
          failFast("geom renderer failed for frame " + watchedFrameId + ": " + JSON.stringify(status || {}));
        }
      }
      if (attempt > 240) {
        return;
      }
      global.setTimeout(function () { ensureGeomRendererReady(attempt + 1); }, 16);
    }

    function renderFrame() {
        if (controlState.rendering === true) {
          controlState.debugRenderFrameSkippedCount = Number(controlState.debugRenderFrameSkippedCount || 0) + 1;
          if (controlState.debugRenderFrameSkippedCount <= 3 || controlState.debugRenderFrameSkippedCount % 20 === 0) {
            chessLagDebug(
              "render_skipped_busy skipped=" + Number(controlState.debugRenderFrameSkippedCount || 0) +
                " camera_requests=" + Number(controlState.debugCameraRequestCount || 0) +
                " camera_coalesced=" + Number(controlState.debugCameraRequestCoalescedCount || 0)
            );
          }
          return;
        }
        if (chessInteractionConfig()) {
          ensureChessRuntimeEventsAttached();
        }
        controlState.rendering = true;
        controlState.debugRenderFrameCount = Number(controlState.debugRenderFrameCount || 0) + 1;
        var debugRenderStartMs = global.performance && typeof global.performance.now === "function"
          ? global.performance.now()
          : Date.now();
        try {
          var rawNowMs = (global.performance && typeof global.performance.now === "function")
            ? global.performance.now()
            : Date.now();
          var pauseActive = global.__vfFrameResizeClockPaused === true;
          if (pauseActive && !(controlState.resizeClockPauseStartMs > 0.0)) {
            controlState.resizeClockPauseStartMs = rawNowMs;
          } else if (!pauseActive && controlState.resizeClockPauseStartMs > 0.0) {
            controlState.resizeClockPausedTotalMs = Number(controlState.resizeClockPausedTotalMs || 0.0) + Math.max(0.0, rawNowMs - controlState.resizeClockPauseStartMs);
            controlState.resizeClockPauseStartMs = 0.0;
          }
          var pausedTotalMs = Number(controlState.resizeClockPausedTotalMs || 0.0);
          var effectiveNowMs = pauseActive && controlState.resizeClockPauseStartMs > 0.0
            ? controlState.resizeClockPauseStartMs - pausedTotalMs
            : rawNowMs - pausedTotalMs;
          var seconds = effectiveNowMs * 0.001;
          var nowMs = seconds * 1000.0;
          if (!useVisibleFrame && dependencySourceFrameId) {
            var dependencyCamera = global.__vfNativeSceneLiveCameras && global.__vfNativeSceneLiveCameras[dependencySourceFrameId];
            if (!dependencyCamera || !Array.isArray(dependencyCamera.pos) || !Array.isArray(dependencyCamera.target)) {
              if (!(controlState.dependencyWaitStartMs > 0.0)) {
                controlState.dependencyWaitStartMs = nowMs;
              }
              if ((nowMs - controlState.dependencyWaitStartMs) > 4000.0) {
                failFast('dependent reflected frame "' + watchedFrameId + '" timed out waiting for source frame "' + dependencySourceFrameId + '"');
              }
              controlState.rendering = false;
              global.setTimeout(renderFrame, 16);
              return;
            }
            controlState.dependencyWaitStartMs = 0.0;
          }
          var keyHoldActive = cameraKeysActive();
          if (useVisibleFrame && keyHoldActive && visibleRenderBackpressureActive()) {
            controlState.cameraKeyLastTsMs = nowMs;
            controlState.cameraKeyStepPending = false;
            controlState.rendering = false;
            ensureCameraHoldLoop(controlState);
            return;
          }
          var dtSec = controlState.lastRenderTsMs > 0
            ? Math.max(0.0, Math.min(1.0 / 30.0, (nowMs - controlState.lastRenderTsMs) * 0.001))
            : (1.0 / 60.0);
          controlState.lastRenderTsMs = nowMs;
          if (controlState.controlsEnabled !== false) {
            var orbitSpeed = Number(controlState.orbitSpeedRadPerSec || 0.0) || 0.0;
            if (orbitSpeed > 0.0) {
              var keyElapsedSec = controlState.cameraKeyLastTsMs > 0.0
                ? Math.max(0.0, (nowMs - controlState.cameraKeyLastTsMs) * 0.001)
                : (1.0 / 120.0);
              var keyDtSec = Math.max(1.0 / 240.0, Math.min(1.0 / 120.0, keyElapsedSec || (1.0 / 120.0)));
              var deltaPhi = 0.0;
              var deltaTheta = 0.0;
              if (keyHoldActive) {
                if (controlState.keyLeft) { deltaPhi -= orbitSpeed * keyDtSec; }
                if (controlState.keyRight) { deltaPhi += orbitSpeed * keyDtSec; }
                if (controlState.keyUp) { deltaTheta += orbitSpeed * keyDtSec; }
                if (controlState.keyDown) { deltaTheta -= orbitSpeed * keyDtSec; }
                controlState.cameraKeyLastTsMs = nowMs;
                controlState.cameraKeyStepPending = false;
              } else if (!keyHoldActive) {
                controlState.cameraKeyLastTsMs = 0.0;
                controlState.cameraKeyStepPending = false;
              }
              if (deltaPhi !== 0.0 || deltaTheta !== 0.0) {
                controlState.orbitPhi += deltaPhi;
                controlState.orbitTheta += deltaTheta;
                controlState.userInteracted = true;
              }
            }
          }
          var authoredCamera = makeCamera(config.camera || {}, cameraFallback, seconds);
          if (controlState.lockApertureCamera === true) {
            var currentEyeKey = linkedSourceEyeKey();
            if (!controlState.exactInitCamera || currentEyeKey !== controlState.linkedEyeKey) {
              var lockedCamera = resolveLinkedMirrorCamera(authoredCamera, seconds);
            var lockedAspect = useVisibleFrame
              ? fittedViewAspect(frame, body)
              : (offscreenFramePixels().width / Math.max(1, offscreenFramePixels().height));
              lockedCamera = resolveMirrorApertureCamera(lockedCamera, seconds, lockedAspect);
              controlState.baseCamera = cloneCameraState(lockedCamera, cameraFallback);
              controlState.exactInitCamera = cloneCameraState(lockedCamera, cameraFallback);
              controlState.linkedEyeKey = currentEyeKey;
            }
            controlState.apertureInitDone = true;
            controlState.userInteracted = false;
          }
          if (!controlState.apertureInitDone) {
            var initCamera = resolveLinkedMirrorCamera(authoredCamera, seconds);
            var initAspect = useVisibleFrame
              ? fittedViewAspect(frame, body)
              : (offscreenFramePixels().width / Math.max(1, offscreenFramePixels().height));
            initCamera = resolveMirrorApertureCamera(initCamera, seconds, initAspect);
            controlState.baseCamera = cloneCameraState(initCamera, cameraFallback);
            controlState.exactInitCamera = cloneCameraState(initCamera, cameraFallback);
            controlState.apertureInitDone = true;
          }
          var baseCamera = controlState.baseCamera
            ? cloneCameraState(controlState.baseCamera, cameraFallback)
            : authoredCamera;
          var userCamera;
          if (controlState.lookOnlyControls === true) {
            var zoomedBaseCamera = Math.abs(Number(controlState.zoomFactor || 1.0) - 1.0) > 1e-6
              ? zoomCamera(baseCamera, Number(controlState.zoomFactor || 1.0))
              : baseCamera;
            userCamera = (Math.abs(Number(controlState.orbitPhi || 0.0)) > 1e-9 || Math.abs(Number(controlState.orbitTheta || 0.0)) > 1e-9)
              ? orbitCameraAroundTarget(zoomedBaseCamera, Number(controlState.orbitPhi || 0.0), Number(controlState.orbitTheta || 0.0))
              : zoomedBaseCamera;
          } else {
            var orbitCamera = (Math.abs(Number(controlState.orbitPhi || 0.0)) > 1e-9 || Math.abs(Number(controlState.orbitTheta || 0.0)) > 1e-9)
              ? orbitCameraAroundTarget(baseCamera, Number(controlState.orbitPhi || 0.0), Number(controlState.orbitTheta || 0.0))
              : baseCamera;
            userCamera = Math.abs(Number(controlState.zoomFactor || 1.0) - 1.0) > 1e-6
              ? zoomCamera(orbitCamera, Number(controlState.zoomFactor || 1.0))
              : orbitCamera;
          }
          var renderCamera = controlState.userInteracted !== true && controlState.exactInitCamera
            ? cloneCameraState(controlState.exactInitCamera, cameraFallback)
            : userCamera;
          var markerReferenceHeightPx;
          if (useVisibleFrame) {
            markerReferenceHeightPx = Math.max(
              1,
              Math.round((body && body.getBoundingClientRect ? body.getBoundingClientRect().height : 0) || 0) ||
              Math.round(Number(global.innerHeight || 720) || 720)
            );
          } else {
            var sourceMarkerReferenceHeightPx = 0;
            if (dependencySourceFrameId && global.__vfNativeSceneLiveCameras) {
              sourceMarkerReferenceHeightPx = Number(
                global.__vfNativeSceneLiveCameras[dependencySourceFrameId] &&
                global.__vfNativeSceneLiveCameras[dependencySourceFrameId].viewport_marker_reference_height_px || 0
              ) || 0;
            }
            markerReferenceHeightPx = sourceMarkerReferenceHeightPx > 0
              ? Math.max(1, Math.round(sourceMarkerReferenceHeightPx))
              : Math.max(1, Number(offscreenPixels && offscreenPixels.height || 0) || 1);
          }
          var markerSizeCamera = null;
          if (!useVisibleFrame && dependencySourceFrameId && global.__vfNativeSceneLiveCameras) {
            var sourceMarkerCamera = global.__vfNativeSceneLiveCameras[dependencySourceFrameId];
            if (sourceMarkerCamera && typeof sourceMarkerCamera === "object") {
              markerSizeCamera = Object.assign({}, sourceMarkerCamera);
              if (!(Number(markerSizeCamera.viewport_height_px || 0) > 0)) {
                markerSizeCamera.viewport_height_px = Number(markerSizeCamera.viewport_marker_reference_height_px || 0) || 0;
              }
            }
          }
          publishLiveCamera(renderCamera, markerReferenceHeightPx, markerSizeCamera);
        if (useVisibleFrame && sceneWorldAnimationsPending() && visibleRenderBackpressureActive()) {
          controlState.rendering = false;
          scheduleNextFrameIfNeeded(true);
          return;
        }
        var worldAnimationActive = dependencySourceFrameId
          ? sceneWorldAnimationsPending()
          : applySceneWorldFrame(seconds);
        if (controlState.pendingAutoSwitchCamera === true && worldAnimationActive !== true) {
          controlState.pendingAutoSwitchCamera = false;
          startAutoSwitchCamera(renderCamera, controlState.pendingAutoSwitchSide || "white");
        }
        renderCamera = applyCameraSwitch(renderCamera);
        publishLiveCamera(renderCamera, markerReferenceHeightPx, markerSizeCamera);
        var dirtyVersion = currentSceneWorldDirtyVersion();
        var meshStructureSignature = sceneWorldMeshStructureSignature();
        var heldCameraKeyActive = cameraKeysActive();
        var canUseVisibleCameraOnly = cameraOnlyFastPathEnabled && useVisibleFrame && !worldAnimationActive && visibleSpec && dirtyVersion === visibleLastDirtyVersion && meshStructureSignature === visibleLastMeshStructureSignature;
        if (heldCameraKeyActive && useVisibleFrame && visibleSpec) {
          renderFrameDependentsBeforePresent();
          if (!updateVisibleCameraOnly(renderCamera, { immediate: true })) {
            failFast('held camera frame "' + String(frameSpec.frame_id || config.frame_id) + '" could not present immediately');
          }
          scenePerf.cameraOnlyUpdates += 1;
          finishRenderFrame(worldAnimationActive, false);
          return;
        }
        if (canUseVisibleCameraOnly) {
          renderFrameDependentsBeforePresent();
          if (!updateVisibleCameraOnly(renderCamera, { immediate: heldCameraKeyActive })) {
            failFast('camera-only frame "' + String(frameSpec.frame_id || config.frame_id) + '" could not present immediately');
          }
          scenePerf.cameraOnlyUpdates += 1;
          if (controlState.debugRenderFrameCount % 60 === 0) {
            chessLagDebug(
              "render_camera_only count=" + Number(controlState.debugRenderFrameCount || 0) +
                " elapsed_ms=" + ((global.performance && typeof global.performance.now === "function" ? global.performance.now() : Date.now()) - debugRenderStartMs).toFixed(1) +
                " camera_only=" + Number(scenePerf.cameraOnlyUpdates || 0) +
                " full=" + Number(scenePerf.fullSceneUpdates || 0)
            );
          }
          finishRenderFrame(worldAnimationActive, false);
          return;
        }
        if (!useVisibleFrame && offscreenMounted && offscreenSpec && dirtyVersion === offscreenLastDirtyVersion && meshStructureSignature === offscreenLastMeshStructureSignature && updateOffscreenCameraOnly(renderCamera, { immediate: dependencySourceFrameId ? true : heldCameraKeyActive })) {
          scenePerf.cameraOnlyUpdates += 1;
          if (controlState.debugRenderFrameCount % 60 === 0) {
            chessLagDebug(
              "render_camera_only count=" + Number(controlState.debugRenderFrameCount || 0) +
                " elapsed_ms=" + ((global.performance && typeof global.performance.now === "function" ? global.performance.now() : Date.now()) - debugRenderStartMs).toFixed(1) +
                " camera_only=" + Number(scenePerf.cameraOnlyUpdates || 0) +
                " full=" + Number(scenePerf.fullSceneUpdates || 0)
            );
          }
          finishRenderFrame(worldAnimationActive, true);
          return;
        }
        if (useVisibleFrame) {
          triggerFrameDependents(String(frameSpec.frame_id || config.frame_id), { immediate: true });
        }
        var rendered = renderPayload(renderCamera, seconds, { skipChessInteraction: true });
        if (useVisibleFrame) {
          pushVisibleRender(rendered, { immediate: !!chessInteractionConfig() });
          visibleLastDirtyVersion = dirtyVersion;
          visibleLastMeshStructureSignature = meshStructureSignature;
        } else {
          offscreenSpec = rendered.payload && rendered.payload.geom
            ? rendered.payload.geom[watchedFrameId] || null
            : null;
          if (!offscreenMounted) {
            global.VfDisplay.mountOffscreenGeomFrame(watchedFrameId, function () {
              return offscreenSpec;
            }, offscreenPixels.width, offscreenPixels.height);
            offscreenMounted = true;
          }
          global.VfDisplay.requestDynamicGeomFrameUpdate(watchedFrameId);
          offscreenLastDirtyVersion = dirtyVersion;
          offscreenLastMeshStructureSignature = meshStructureSignature;
          triggerFrameDependents(String(frameSpec.frame_id || config.frame_id), { immediate: true });
        }
        chessLagDebug(
          "render_full count=" + Number(controlState.debugRenderFrameCount || 0) +
            " elapsed_ms=" + ((global.performance && typeof global.performance.now === "function" ? global.performance.now() : Date.now()) - debugRenderStartMs).toFixed(1) +
            " camera_only=" + Number(scenePerf.cameraOnlyUpdates || 0) +
            " full=" + Number(scenePerf.fullSceneUpdates || 0) +
            " dirty=" + Number(dirtyVersion || 0)
        );
        finishRenderFrame(worldAnimationActive, false);
      } catch (err) {
        controlState.rendering = false;
        failFast("render loop failed: " + (err && err.message ? err.message : String(err)));
      }
    }
    function wireChessRuntimeRenderCallbacks() {
      var runtimeForCallbacks = ensureChessRuntimeEventsAttached();
      if (!runtimeForCallbacks || runtimeForCallbacks.renderCallbacksAttached === true) { return; }
      runtimeForCallbacks.renderCallbacksAttached = true;
      runtimeForCallbacks.afterChessAnimationsComplete = function (side) {
        controlState.pendingAutoSwitchCamera = true;
        controlState.pendingAutoSwitchSide = String(side || "white");
        if (typeof runtimeForCallbacks.requestInteractionFrame === "function") {
          runtimeForCallbacks.requestInteractionFrame();
        }
      };
      runtimeForCallbacks.requestInteractionFrame = function () {
        if (controlState.interactionFramePending === true) { return; }
        controlState.interactionFramePending = true;
        global.requestAnimationFrame(function () {
          controlState.interactionFramePending = false;
          if (controlState.rendering === true) {
            runtimeForCallbacks.requestInteractionFrame();
            return;
          }
          renderFrame();
        });
      };
    }

    function startInitialSceneRender() {
      wireChessRuntimeRenderCallbacks();
      renderFrame();
      if (useVisibleFrame) {
        ensureGeomRendererReady(0);
      }
    }

    function postVisibleShellLayout() {
      if (!useVisibleFrame || !global.VfFrame || typeof global.VfFrame.postNativeHostLayout !== "function") {
        return;
      }
      var layer = document.body || document.documentElement;
      if (layer) {
        global.VfFrame.postNativeHostLayout(layer, { stageAlpha: 0 });
      }
    }

    function mountResponsiveVisibleShell() {
      if (!useVisibleFrame) { return; }
      ensureVisibleSceneFrameShell();
      postVisibleShellLayout();
    }

    function scheduleVisibleInitialSceneRender() {
      mountResponsiveVisibleShell();
      var start = function () {
        mountResponsiveVisibleShell();
        global.requestAnimationFrame(function () {
          mountResponsiveVisibleShell();
          global.requestAnimationFrame(startInitialSceneRender);
        });
      };
      if (typeof global.requestIdleCallback === "function") {
        global.requestIdleCallback(start, { timeout: 600 });
        return;
      }
      global.setTimeout(start, 120);
    }

    if (useVisibleFrame) {
      scheduleVisibleInitialSceneRender();
    } else {
      startInitialSceneRender();
    }
  }

  function waitForFrame(attempt) {
    if (!requireRuntime()) {
      if (attempt > 240) {
        failFast("VfDisplay.renderFromJson is unavailable");
      }
      global.setTimeout(function () { waitForFrame(attempt + 1); }, 16);
      return;
    }
    if (!sceneFrameVisible()) {
      boot();
      return;
    }
    var frame = document.querySelector('.vf-frame[data-vf-frame-id="' + String(frameSpec.frame_id || config.frame_id) + '"]');
    if (frame) {
      boot();
      return;
    }
    if (global.VfDisplay && typeof global.VfDisplay.mountDynamicGeomFrame === "function") {
      ensureVisibleSceneFrameShell();
      boot();
      return;
    }
    if (attempt > 240) {
      failFast("timed out waiting for scene frame");
    }
    global.setTimeout(function () { waitForFrame(attempt + 1); }, 16);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { waitForFrame(0); }, { once: true });
  } else {
    waitForFrame(0);
  }
})(typeof window !== "undefined" ? window : this);
