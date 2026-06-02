/**
 * vf-runtime-source.js — packet/file sourcing for the runtime shell.
 */
(function(global) {
  "use strict";

  if (global.VfRuntimeSource) { return; }

  function createSource(options) {
    options = options || {};
    var config = options.config || {};
    var runtimeLog = options.runtimeLog || function() {};

    function strictPacketOnlyEnabled() {
      return !!config.strictPacketOnly;
    }

    function packetOnlyEnabled() {
      return strictPacketOnlyEnabled() || !!config.packetOnly;
    }

    function parsePacketPayload(payload) {
      return payload && Array.isArray(payload.packets) ? payload.packets : null;
    }

    var STRICT_SOURCE_KINDS = {
      "scene.replace": true,
      "ui_state.replace": true,
      "display.replace": true,
      "geom.color.patch": true,
      "widget.append_text": true
    };

    function validateStrictPackets(packets) {
      if (!strictPacketOnlyEnabled() || !Array.isArray(packets)) { return packets; }
      if (packets.length <= 0) {
        throw strictPacketSourceError("overlay packet API returned empty packet stream");
      }
      var previousSeq = 0;
      for (var i = 0; i < packets.length; i++) {
        var packet = packets[i];
        var seq = Number(packet && packet.seq);
        var kind = String(packet && packet.kind || "");
        if (
          !packet ||
          typeof packet !== "object" ||
          !Number.isFinite(seq) ||
          seq <= 0 ||
          !kind ||
          !packet.payload ||
          typeof packet.payload !== "object"
        ) {
          throw strictPacketSourceError("overlay packet API returned malformed packet at index " + i);
        }
        if (seq <= previousSeq) {
          throw strictPacketSourceError("overlay packet API returned non-monotonic packet seq at index " + i);
        }
        previousSeq = seq;
        var payload = packet.payload;
        if (!STRICT_SOURCE_KINDS[kind]) {
          throw strictPacketSourceError("overlay packet API returned unsupported packet kind " + kind + " at index " + i);
        }
        if (kind === "scene.replace" && !Array.isArray(payload.commands)) {
          throw strictPacketSourceError("overlay packet API returned malformed scene.replace packet at index " + i);
        }
        if (kind === "ui_state.replace" && (!payload.state || typeof payload.state !== "object")) {
          throw strictPacketSourceError("overlay packet API returned malformed ui_state.replace packet at index " + i);
        }
        if (kind === "display.replace" && (!payload.display || typeof payload.display !== "object")) {
          throw strictPacketSourceError("overlay packet API returned malformed display.replace packet at index " + i);
        }
        if (
          kind === "widget.append_text" &&
          (!payload.frame_id || !payload.widget_id || payload.text == null || !Number.isFinite(Number(payload.append_seq)))
        ) {
          throw strictPacketSourceError("overlay packet API returned malformed widget.append_text packet at index " + i);
        }
        if (
          kind === "geom.color.patch" &&
          (!payload.frame_id || !Number.isFinite(Number(payload.object_id)) || Number(payload.object_id) <= 0 || payload.color == null)
        ) {
          throw strictPacketSourceError("overlay packet API returned malformed geom.color.patch packet at index " + i);
        }
      }
      return packets;
    }

    function strictPacketSourceError(message) {
      return new Error("strict packet-only runtime packet source failed: " + String(message || "unknown error"));
    }

    function isStrictPacketSourceError(err) {
      return !!(err && /^strict packet-only runtime packet source failed: /.test(String(err.message || "")));
    }

    function loadFromOverlayApi() {
      if (typeof fetch === "undefined") {
        return strictPacketOnlyEnabled()
          ? Promise.reject(strictPacketSourceError("fetch is not available"))
          : Promise.resolve(null);
      }
      return fetch(String(config.overlayPacketUrl || "/api/runtime-packets") + "?t=" + Date.now(), { cache: "no-store" })
        .then(function(r) {
          if (!r.ok) {
            runtimeLog("warn", "loadFromOverlayApi: status=" + r.status);
            if (strictPacketOnlyEnabled()) {
              throw strictPacketSourceError("overlay packet API returned HTTP " + r.status);
            }
            return null;
          }
          return r.json();
        })
        .then(function(payload) {
          var packets = parsePacketPayload(payload);
          if (!Array.isArray(packets) && strictPacketOnlyEnabled()) {
            throw strictPacketSourceError("overlay packet API returned malformed packet payload");
          }
          return validateStrictPackets(packets);
        })
        .catch(function(err) {
          runtimeLog("warn", "loadFromOverlayApi: " + (err && err.message ? err.message : String(err)));
          if (strictPacketOnlyEnabled()) {
            throw isStrictPacketSourceError(err)
              ? err
              : strictPacketSourceError(err && err.message ? err.message : String(err));
          }
          return null;
        });
    }

    function loadFromFileMirror() {
      if (typeof fetch === "undefined") { return Promise.resolve(null); }
      return fetch(String(config.filePacketUrl || "vf-runtime-packets.json") + "?t=" + Date.now(), { cache: "no-store" })
        .then(function(r) {
          if (!r.ok) {
            runtimeLog("warn", "loadFromFileMirror: status=" + r.status);
            return null;
          }
          return r.text();
        })
        .then(function(raw) {
          if (raw == null) { return null; }
          var packets = JSON.parse(raw);
          return Array.isArray(packets) ? packets : null;
        })
        .catch(function(err) {
          runtimeLog("warn", "loadFromFileMirror: " + (err && err.message ? err.message : String(err)));
          return null;
        });
    }

    function loadPackets() {
      return loadFromOverlayApi().then(function(packets) {
        if (Array.isArray(packets)) { return packets; }
        if (packetOnlyEnabled()) {
          runtimeLog("info", "loadPackets: packet-only mode skipped file mirror fallback");
          return null;
        }
        return loadFromFileMirror();
      });
    }

    function loadSceneCommands() {
      if (strictPacketOnlyEnabled()) {
        runtimeLog("info", "loadScene: strict packet-only mode skipped scene file bootstrap");
        return Promise.resolve(null);
      }
      if (typeof fetch === "undefined") { return Promise.resolve(null); }
      var sceneUrl = String(config.sceneUrl || "vkf-scene.json");
      return fetch(sceneUrl + "?t=" + Date.now(), { cache: "no-store" })
        .then(function(r) {
          if (!r.ok) {
            runtimeLog("warn", "loadScene: " + sceneUrl + " fetch " + r.status + " — no scene yet, will retry");
            return null;
          }
          return r.text();
        })
        .then(function(raw) {
          if (raw == null) { return null; }
          var data = JSON.parse(raw);
          if (!Array.isArray(data)) {
            runtimeLog("warn", "loadScene: " + sceneUrl + " is not an array (got " + typeof data + ")");
            return null;
          }
          return {
            raw: raw,
            commands: data
          };
        });
    }

    return {
      loadPackets: loadPackets,
      loadSceneCommands: loadSceneCommands
    };
  }

  global.VfRuntimeSource = {
    createSource: createSource
  };
})(typeof window !== "undefined" ? window : this);
