/**
 * vf-runtime-packet-contract.js — authoritative runtime packet names/shapes.
 */
(function(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.VfRuntimePacketContract = factory();
}(typeof globalThis !== "undefined" ? globalThis : this, function() {
  "use strict";

  var PACKET_KINDS = {
    "scene.replace": true,
    "ui_state.replace": true,
    "display.replace": true,
    "geom.color.patch": true,
    "widget.append_text": true
  };

  var BOOTSTRAP_COALESCE_KINDS = {
    "scene.replace": true,
    "ui_state.replace": true,
    "display.replace": true
  };

  function validatePacketPayload(kind, payload, phase) {
    kind = String(kind || "");
    phase = String(phase || "route");
    if (!PACKET_KINDS[kind]) {
      return "unsupported packet kind " + kind;
    }
    if (kind === "scene.replace" && (!payload || !Array.isArray(payload.commands))) {
      return phase === "source" ? "malformed scene.replace packet" : "scene.replace packet missing commands";
    }
    if (kind === "ui_state.replace" && (!payload || !payload.state || typeof payload.state !== "object")) {
      return phase === "source" ? "malformed ui_state.replace packet" : "ui_state.replace packet missing state";
    }
    if (kind === "display.replace" && (!payload || !payload.display || typeof payload.display !== "object")) {
      return phase === "source" ? "malformed display.replace packet" : "display.replace packet missing display";
    }
    if (
      kind === "widget.append_text" &&
      (!payload || !payload.frame_id || !payload.widget_id || payload.text == null || !Number.isFinite(Number(payload.append_seq)))
    ) {
      return phase === "source" ? "malformed widget.append_text packet" : "widget.append_text packet missing append payload";
    }
    if (
      kind === "geom.color.patch" &&
      (!payload || !payload.frame_id || !Number.isFinite(Number(payload.object_id)) || Number(payload.object_id) <= 0 || payload.color == null)
    ) {
      return phase === "source" ? "malformed geom.color.patch packet" : "geom.color.patch packet missing color payload";
    }
    return "";
  }

  return {
    PACKET_KINDS: PACKET_KINDS,
    BOOTSTRAP_COALESCE_KINDS: BOOTSTRAP_COALESCE_KINDS,
    validatePacketPayload: validatePacketPayload
  };
}));
