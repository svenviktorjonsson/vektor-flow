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
    "widget.append_text": true,
    "input.event": true
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
    if (kind === "input.event") {
      var event = payload && payload.event;
      if (!event || typeof event !== "object" || typeof event.event !== "string" || !event.event ||
          (event.widget_id != null && (typeof event.widget_id !== "string" || !event.widget_id)) ||
          (event.frame_id != null && (typeof event.frame_id !== "string" || !event.frame_id))) {
        return phase === "source" ? "malformed input.event packet" : "input.event packet missing event payload";
      }
    }
    return "";
  }

  function createQueue() {
    var values = [];
    var head = 0;
    return {
      push: function(value) {
        values.push(value);
      },
      get: function() {
        if (head >= values.length) return null;
        var value = values[head];
        head += 1;
        if (head >= 64 && head * 2 >= values.length) {
          values = values.slice(head);
          head = 0;
        }
        return value;
      }
    };
  }

  function requireOwnerId(value, name) {
    if (typeof value !== "string" || !value) {
      throw new TypeError("internal owner event queues require " + name);
    }
    return value;
  }

  function createInternalButtonClickedOwnerQueues(options) {
    options = options || {};
    var buttonId = requireOwnerId(options.buttonId, "buttonId");
    var frameId = requireOwnerId(options.frameId, "frameId");
    var displayId = requireOwnerId(options.displayId, "displayId");
    var buttonQueue = createQueue();
    var frameQueue = createQueue();
    var displayQueue = createQueue();
    var lastSequence = 0;

    function owner(kind, id, queue) {
      return Object.freeze({
        kind: kind,
        id: id,
        events: Object.freeze({ get: queue.get })
      });
    }

    var queues = {
      button: owner("Button", buttonId, buttonQueue),
      frame: owner("Frame", frameId, frameQueue),
      display: owner("Display", displayId, displayQueue),
      consumeRuntimePacket: function(packet) {
        if (!packet || packet.kind !== "input.event" ||
            !Number.isSafeInteger(packet.seq) || packet.seq <= lastSequence) {
          throw new TypeError("internal owner event queues require increasing input.event packets");
        }
        var payloadError = validatePacketPayload("input.event", packet.payload, "route");
        if (payloadError) {
          throw new TypeError(payloadError);
        }
        var event = packet.payload.event;
        if (event.event !== "ButtonClicked" || event.widget_id !== buttonId || event.frame_id !== frameId) {
          throw new TypeError("ButtonClicked owner event does not match its bound owners");
        }

        var buttonEvent = Object.freeze(Object.assign({}, event));
        var frameEvent = Object.freeze(Object.assign({}, event));
        var displayEvent = Object.freeze(Object.assign({}, event));
        lastSequence = packet.seq;
        buttonQueue.push(buttonEvent);
        frameQueue.push(frameEvent);
        displayQueue.push(displayEvent);
        return buttonEvent;
      }
    };
    return Object.freeze(queues);
  }

  function executeInternalOwnerEventPoll(poll, owners) {
    var owner = poll && poll.owner;
    var boundOwner = owner && owners && owners[owner.name];
    if (!poll || poll.kind !== "ui_owner_event_get" ||
        poll.owner_kind !== "Button" || poll.type !== "ButtonEvent|null" ||
        !owner || owner.kind !== "load" || owner.type !== "ui_component<Button>" ||
        !boundOwner || boundOwner.kind !== "Button" || !boundOwner.events ||
        typeof boundOwner.events.get !== "function") {
      throw new TypeError("internal Button owner event poll is malformed");
    }
    return boundOwner.events.get();
  }

  return {
    PACKET_KINDS: PACKET_KINDS,
    BOOTSTRAP_COALESCE_KINDS: BOOTSTRAP_COALESCE_KINDS,
    validatePacketPayload: validatePacketPayload,
    createInternalButtonClickedOwnerQueues: createInternalButtonClickedOwnerQueues,
    executeInternalOwnerEventPoll: executeInternalOwnerEventPoll
  };
}));
