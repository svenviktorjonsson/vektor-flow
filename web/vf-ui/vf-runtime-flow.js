/**
 * vf-runtime-flow.js — packet routing and legacy fallback flow for the runtime shell.
 */
(function(global) {
  "use strict";

  if (global.VfRuntimeFlow) { return; }

  var _packetContract = global.VfRuntimePacketContract || null;
  var FALLBACK_PACKET_KINDS = {
    "scene.replace": true,
    "ui_state.replace": true,
    "display.replace": true,
    "geom.color.patch": true,
    "widget.append_text": true
  };
  var FALLBACK_BOOTSTRAP_COALESCE_KINDS = {
    "scene.replace": true,
    "ui_state.replace": true,
    "display.replace": true
  };

  function validatePacketPayload(kind, payload) {
    if (_packetContract && typeof _packetContract.validatePacketPayload === "function") {
      return _packetContract.validatePacketPayload(kind, payload, "route");
    }
    if (!FALLBACK_PACKET_KINDS[kind]) { return "unsupported packet kind " + kind; }
    if (kind === "scene.replace" && (!payload || !Array.isArray(payload.commands))) { return "scene.replace packet missing commands"; }
    if (kind === "ui_state.replace" && (!payload || !payload.state || typeof payload.state !== "object")) { return "ui_state.replace packet missing state"; }
    if (kind === "display.replace" && (!payload || !payload.display || typeof payload.display !== "object")) { return "display.replace packet missing display"; }
    if (kind === "widget.append_text" && (!payload || !payload.frame_id || !payload.widget_id || payload.text == null || !Number.isFinite(Number(payload.append_seq)))) { return "widget.append_text packet missing append payload"; }
    if (kind === "geom.color.patch" && (!payload || !payload.frame_id || !Number.isFinite(Number(payload.object_id)) || Number(payload.object_id) <= 0 || payload.color == null)) { return "geom.color.patch packet missing color payload"; }
    return "";
  }

  function isRuntimePacketKind(kind) {
    var kinds = _packetContract && _packetContract.PACKET_KINDS || FALLBACK_PACKET_KINDS;
    return !!kinds[String(kind || "")];
  }

  var PACKET_RUNTIME_STATES = {
    BOOTSTRAP_ONLY: "bootstrap-only",
    ACTIVE_STREAM: "active-stream",
    IDLE: "idle"
  };

  function createFlow(options) {
    options = options || {};
    var config = options.config || {};
    var createRuntimeDependencies = options.createRuntimeDependencies || function() { return {}; };
    var runtimeLog = options.runtimeLog || function() {};
    var getRuntimeSource = options.getRuntimeSource || function() { return null; };
    var applySceneCommands = options.applySceneCommands || function() {};
    var state = options.state || {};
    var BOOTSTRAP_COALESCE_KINDS = _packetContract && _packetContract.BOOTSTRAP_COALESCE_KINDS || FALLBACK_BOOTSTRAP_COALESCE_KINDS;

    function strictPacketOnlyEnabled() {
      return !!config.strictPacketOnly;
    }

    function getPacketRuntimeState() {
      var value = String(state.packetRuntimeState || "");
      if (value === PACKET_RUNTIME_STATES.ACTIVE_STREAM || value === PACKET_RUNTIME_STATES.IDLE) {
        return value;
      }
      return PACKET_RUNTIME_STATES.BOOTSTRAP_ONLY;
    }

    function setPacketRuntimeState(nextState, reason) {
      var currentState = getPacketRuntimeState();
      var normalized = String(nextState || "");
      if (normalized !== PACKET_RUNTIME_STATES.ACTIVE_STREAM && normalized !== PACKET_RUNTIME_STATES.IDLE) {
        normalized = PACKET_RUNTIME_STATES.BOOTSTRAP_ONLY;
      }
      if (currentState === normalized) { return normalized; }
      state.packetRuntimeState = normalized;
      runtimeLog(
        "info",
        "packetRuntimeState: " + currentState + " -> " + normalized +
          (reason ? " (" + reason + ")" : "")
      );
      return normalized;
    }

    function enterBootstrapOnly(reason) {
      state.packetIdlePolls = 0;
      return setPacketRuntimeState(PACKET_RUNTIME_STATES.BOOTSTRAP_ONLY, reason);
    }

    function enterActiveStream(reason) {
      state.packetIdlePolls = 0;
      return setPacketRuntimeState(PACKET_RUNTIME_STATES.ACTIVE_STREAM, reason);
    }

    function enterIdle(reason) {
      return setPacketRuntimeState(PACKET_RUNTIME_STATES.IDLE, reason);
    }

    function getNextPacketPollDelay() {
      var currentState = getPacketRuntimeState();
      if (currentState === PACKET_RUNTIME_STATES.IDLE) {
        return null;
      }
      if (currentState === PACKET_RUNTIME_STATES.BOOTSTRAP_ONLY) {
        return Number(config.packetPollMs) || 16;
      }
      var idlePolls = Number(state.packetIdlePolls || 0);
      var idleThreshold = Number(config.packetPollIdleThreshold) || 12;
      var steadyThreshold = Number(config.packetPollSteadyThreshold) || 60;
      var quiesceThreshold = Number(config.packetPollQuiesceThreshold);
      if (!(quiesceThreshold > 0)) {
        quiesceThreshold = steadyThreshold;
      }
      if (idlePolls >= quiesceThreshold) {
        enterIdle("idle polls=" + idlePolls);
        return null;
      }
      if (idlePolls >= steadyThreshold) {
        return Number(config.packetPollSteadyMs) || 400;
      }
      if (idlePolls >= idleThreshold) {
        return Number(config.packetPollIdleMs) || 120;
      }
      return Number(config.packetPollMs) || 16;
    }

    function displayRefresh() {
      var deps = createRuntimeDependencies();
      if (state.packetModeActive && deps.display && deps.display.redrawCurrentDisplay) {
        deps.display.redrawCurrentDisplay();
        return;
      }
      if (strictPacketOnlyEnabled()) {
        runtimeLog("info", "displayRefresh: strict packet-only mode suppressed legacy display file refresh");
        return;
      }
      if (state.legacyFallbackActive && deps.display && deps.display.loadAndRender) {
        deps.display.loadAndRender();
        return;
      }
      if (!deps.display) {
        runtimeLog("warn", "displayRefresh: VfDisplay not available");
      }
    }

    function stopLegacyFallback() {
      var deps = createRuntimeDependencies();
      state.legacyFallbackActive = false;
      if (state.scenePollTimer && typeof global.clearInterval === "function") {
        global.clearInterval(state.scenePollTimer);
      }
      state.scenePollTimer = 0;
      if (deps.widgets && deps.widgets.stopStatePoll) {
        deps.widgets.stopStatePoll();
      }
    }

    function strictPacketRouteError(message) {
      return new Error("strict packet-only runtime packet routing failed: " + String(message || "unknown error"));
    }

    function validateStrictRoutePacket(packet, deps) {
      if (!strictPacketOnlyEnabled()) { return; }
      if (!packet || typeof packet !== "object") {
        throw strictPacketRouteError("packet is not an object");
      }
      var seq = Number(packet.seq);
      if (!Number.isFinite(seq) || seq <= Number(state.lastRuntimePacketSeq || 0)) {
        throw strictPacketRouteError("stale or invalid packet seq");
      }
      var kind = String(packet.kind || "");
      var payload = packet.payload;
      if (!isRuntimePacketKind(kind)) {
        throw strictPacketRouteError("unsupported packet kind " + kind);
      }
      if (kind === "scene.replace" || kind === "ui_state.replace" || kind === "display.replace") {
        var replacePayloadError = validatePacketPayload(kind, payload);
        if (replacePayloadError) { throw strictPacketRouteError(replacePayloadError); }
      }
      if (kind === "ui_state.replace" && (!deps.widgets || !deps.widgets.applyRuntimePacket)) {
        throw strictPacketRouteError("ui_state.replace packet requires widget runtime adapter");
      }
      if ((kind === "display.replace" || kind === "geom.color.patch") && (!deps.display || !deps.display.applyRuntimePacket)) {
        throw strictPacketRouteError(kind + " packet requires display runtime adapter");
      }
      if (kind === "widget.append_text" && (!deps.widgets || !deps.widgets.applyRuntimePacket)) {
        throw strictPacketRouteError("widget.append_text packet requires widget runtime adapter");
      }
      if (kind === "widget.append_text" || kind === "geom.color.patch") {
        var patchPayloadError = validatePacketPayload(kind, payload);
        if (patchPayloadError) { throw strictPacketRouteError(patchPayloadError); }
      }
    }

    function routeRuntimePacket(packet) {
      var deps = createRuntimeDependencies();
      if (!packet || typeof packet !== "object") { return; }
      validateStrictRoutePacket(packet, deps);
      var seq = Number(packet.seq);
      var kind = String(packet.kind || "");
      runtimeLog("info", "routeRuntimePacket: seq=" + String(packet.seq) + " kind=" + kind);
      var payload = packet.payload;
      if (kind === "scene.replace" && payload && Array.isArray(payload.commands)) {
        runtimeLog("info", "routeRuntimePacket: scene.replace commands=" + payload.commands.length);
        applySceneCommands(payload.commands);
        state.packetSceneMounted = true;
        if (Number.isFinite(seq) && seq > Number(state.lastRuntimePacketSeq || 0)) {
          state.lastRuntimePacketSeq = seq;
        }
        state.packetModeActive = true;
        enterActiveStream("packet seq=" + String(packet.seq));
        if (state.legacyFallbackActive) {
          stopLegacyFallback();
        }
        if (state.pendingDisplayReplacePacket) {
          var pendingDisplay = state.pendingDisplayReplacePacket;
          state.pendingDisplayReplacePacket = null;
          global.setTimeout(function() {
            routeRuntimePacket(pendingDisplay);
          }, 0);
        }
        return;
      }
      if (kind === "display.replace" && !state.packetSceneMounted) {
        var declared = Number(global.__vfSceneDeclaredFrameCount || 0);
        if (declared <= 0 && getPacketRuntimeState() === PACKET_RUNTIME_STATES.BOOTSTRAP_ONLY) {
          runtimeLog("info", "routeRuntimePacket: delaying display.replace until scene frame mounts");
          state.pendingDisplayReplacePacket = packet;
          return;
        }
      }
      if (deps.widgets && deps.widgets.applyRuntimePacket) {
        deps.widgets.applyRuntimePacket(packet);
      }
      if (deps.display && deps.display.applyRuntimePacket) {
        deps.display.applyRuntimePacket(packet);
      }
      if (Number.isFinite(seq) && seq > Number(state.lastRuntimePacketSeq || 0)) {
        state.lastRuntimePacketSeq = seq;
      }
      state.packetModeActive = true;
      enterActiveStream("packet seq=" + String(packet.seq));
      if (state.legacyFallbackActive) {
        stopLegacyFallback();
      }
    }

    function applyRuntimePayload(payload) {
      if (!payload || typeof payload !== "object") { return false; }
      if (Array.isArray(payload.packets)) {
        if (strictPacketOnlyEnabled() && payload.packets.length <= 0) {
          throw strictPacketRouteError("empty runtime payload packet stream");
        }
        for (var i = 0; i < payload.packets.length; i++) {
          routeRuntimePacket(payload.packets[i]);
        }
        return true;
      }
      if (Array.isArray(payload.commands)) {
        if (strictPacketOnlyEnabled()) {
          throw strictPacketRouteError("legacy scene command payload is not allowed");
        }
        applySceneCommands(payload.commands);
        return true;
      }
      return false;
    }

    function loadScene() {
      var runtimeSource = getRuntimeSource();
      if (strictPacketOnlyEnabled()) { return Promise.resolve(null); }
      if (!state.legacyFallbackActive || state.sceneLoadInFlight || typeof fetch === "undefined" || !runtimeSource) { return; }
      state.sceneLoadInFlight = true;
      return runtimeSource.loadSceneCommands()
        .then(function(result) {
          if (!result) {
            displayRefresh();
            return;
          }
          if (result.raw === state.lastSceneText) {
            displayRefresh();
            return;
          }
          state.lastSceneText = result.raw;
          applySceneCommands(result.commands);
        })
        .catch(function(fetchErr) {
          if (fetchErr && fetchErr.message === "Unexpected end of JSON input") {
            runtimeLog("error", "loadScene: JSON.parse failed: " + fetchErr.message);
            displayRefresh();
            return;
          }
          if (fetchErr && /JSON/.test(String(fetchErr && fetchErr.message || ""))) {
            runtimeLog("error", "loadScene: JSON.parse failed: " + fetchErr.message);
            displayRefresh();
            return;
          }
          runtimeLog("warn", "loadScene: fetch threw: " + (fetchErr && fetchErr.message ? fetchErr.message : String(fetchErr)));
        })
        .finally(function() {
          state.sceneLoadInFlight = false;
        });
    }

    function startLegacyFallback() {
      var deps = createRuntimeDependencies();
      if (strictPacketOnlyEnabled()) {
        runtimeLog("info", "startLegacyFallback: strict packet-only mode suppressed legacy fallback");
        return;
      }
      if (state.packetModeActive || state.legacyFallbackActive) { return; }
      state.legacyFallbackActive = true;
      if (deps.widgets && deps.widgets.startStatePoll) {
        deps.widgets.startStatePoll();
      }
      loadScene();
      if (typeof global.setInterval === "function") {
        state.scenePollTimer = global.setInterval(loadScene, Number(config.scenePollMs) || 1500);
      }
    }

    function coalesceBootstrapPackets(packets) {
      if (!Array.isArray(packets) || packets.length <= 1) { return packets; }
      if (getPacketRuntimeState() !== PACKET_RUNTIME_STATES.BOOTSTRAP_ONLY) { return packets; }
      var latestByKind = Object.create(null);
      var preserved = [];
      for (var i = 0; i < packets.length; i++) {
        var packet = packets[i];
        var kind = String(packet && packet.kind || "");
        if (!BOOTSTRAP_COALESCE_KINDS[kind]) {
          preserved.push(packet);
          continue;
        }
        latestByKind[kind] = packet;
      }
      if (!latestByKind["scene.replace"] &&
          !latestByKind["ui_state.replace"] &&
          !latestByKind["display.replace"]) {
        return packets;
      }
      var ordered = preserved.slice();
      if (latestByKind["scene.replace"]) {
        ordered.push(latestByKind["scene.replace"]);
      }
      if (latestByKind["ui_state.replace"]) {
        ordered.push(latestByKind["ui_state.replace"]);
      }
      if (latestByKind["display.replace"]) {
        ordered.push(latestByKind["display.replace"]);
      }
      if (strictPacketOnlyEnabled()) {
        ordered.sort(function(a, b) {
          return Number(a && a.seq || 0) - Number(b && b.seq || 0);
        });
      }
      runtimeLog(
        "info",
        "coalesceBootstrapPackets: in=" + packets.length + " out=" + ordered.length
      );
      return ordered;
    }

    function loadRuntimePackets() {
      var runtimeSource = getRuntimeSource();
      if (state.runtimePacketsInFlight) { return; }
      if (!runtimeSource) {
        if (strictPacketOnlyEnabled()) {
          return Promise.reject(new Error("strict packet-only runtime packet source failed: runtime source unavailable"));
        }
        return;
      }
      state.runtimePacketsInFlight = true;
      return runtimeSource.loadPackets()
        .then(function(packets) {
          var applied = 0;
          if (!Array.isArray(packets)) {
            return {
              applied: applied,
              nextPollDelayMs: getNextPacketPollDelay(),
              packetRuntimeState: getPacketRuntimeState()
            };
          }
          var routedPackets = coalesceBootstrapPackets(packets);
          for (var i = 0; i < routedPackets.length; i++) {
            var packet = routedPackets[i];
            var seq = Number(packet && packet.seq);
            if (!Number.isFinite(seq) || seq <= state.lastRuntimePacketSeq) {
              if (strictPacketOnlyEnabled()) {
                throw strictPacketRouteError("stale or invalid packet seq at index " + i);
              }
              continue;
            }
            routeRuntimePacket(packet);
            state.lastRuntimePacketSeq = seq;
            applied += 1;
          }
          if (applied > 0) {
            state.runtimePacketsSeen = true;
            enterActiveStream("applied=" + applied);
            runtimeLog("info", "loadRuntimePackets: applied=" + applied + " newLastSeq=" + state.lastRuntimePacketSeq);
          } else {
            if (state.runtimePacketsSeen) {
              state.packetIdlePolls = Number(state.packetIdlePolls || 0) + 1;
            }
          }
          return {
            applied: applied,
            nextPollDelayMs: getNextPacketPollDelay(),
            packetRuntimeState: getPacketRuntimeState()
          };
        })
        .catch(function(err) {
          runtimeLog("warn", "loadRuntimePackets: " + (err && err.message ? err.message : String(err)));
          if (strictPacketOnlyEnabled()) { throw err; }
          return {
            applied: 0,
            nextPollDelayMs: getNextPacketPollDelay(),
            packetRuntimeState: getPacketRuntimeState()
          };
        })
        .finally(function() {
          state.runtimePacketsInFlight = false;
        });
    }

    return {
      displayRefresh: displayRefresh,
      stopLegacyFallback: stopLegacyFallback,
      startLegacyFallback: startLegacyFallback,
      routeRuntimePacket: routeRuntimePacket,
      applyRuntimePayload: applyRuntimePayload,
      loadRuntimePackets: loadRuntimePackets,
      loadScene: loadScene,
      getPacketRuntimeState: getPacketRuntimeState,
      getNextPacketPollDelay: getNextPacketPollDelay,
      enterBootstrapOnly: enterBootstrapOnly,
      packetRuntimeStates: PACKET_RUNTIME_STATES
    };
  }

  global.VfRuntimeFlow = {
    createFlow: createFlow
  };
})(typeof window !== "undefined" ? window : this);
