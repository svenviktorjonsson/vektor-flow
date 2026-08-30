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
    "input.event": true,
    "__vf_internal_html.patch": true
  };

  var BOOTSTRAP_COALESCE_KINDS = {
    "scene.replace": true,
    "ui_state.replace": true,
    "display.replace": true
  };

  function hasExactKeys(value, keys) {
    if (!value || typeof value !== "object" || Array.isArray(value)) { return false; }
    var actual = Object.keys(value);
    return actual.length === keys.length && actual.every(function(key) { return keys.indexOf(key) >= 0; });
  }

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
    if (kind === "__vf_internal_html.patch") {
      var patch = payload && payload.__vf_internal_retained_html_patch;
      var owner = patch && patch.owner;
      var mutation = patch && patch.mutation;
      if (!hasExactKeys(payload, ["__vf_internal_retained_html_patch"]) ||
          !hasExactKeys(patch, ["version", "owner", "target", "mutation"]) || patch.version !== 1 ||
          !hasExactKeys(owner, ["kind", "id"]) ||
          !owner || (owner.kind !== "frame" && owner.kind !== "display") ||
          typeof owner.id !== "string" || !owner.id ||
          !Number.isInteger(patch.target) || patch.target < 0 ||
          !hasExactKeys(mutation, ["tag", "name", "value"]) ||
          !mutation || (mutation.tag !== 1 && mutation.tag !== 2) ||
          typeof mutation.name !== "string" || typeof mutation.value !== "string" ||
          (mutation.tag === 1 && mutation.name !== "") ||
          (mutation.tag === 2 && (!mutation.name || /^on/i.test(mutation.name)))) {
        return "private retained HTML patch is malformed";
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
    var frameIds = Array.isArray(options.frameIds)
      ? options.frameIds.map(function(id) { return requireOwnerId(id, "frameIds"); })
      : [requireOwnerId(options.frameId, "frameId")];
    if (frameIds.length === 0) {
      throw new TypeError("internal owner event queues require frameIds");
    }
    var frameId = frameIds[0];
    var displayId = requireOwnerId(options.displayId, "displayId");
    var ownerQueues = [];
    var ownerObjects = [];
    var defaultValues = [];
    var defaultHead = 0;
    var lastSequence = 0;

    function finalizeInteraction(interaction) {
      if (interaction.finalized) return;
      var lastOwner = interaction.stopAfter == null
        ? ownerQueues.length - 1
        : interaction.stopAfter;
      for (var index = 0; index <= lastOwner; index += 1) {
        if (!interaction.resolved[index]) return;
      }
      interaction.finalized = true;
      if (!interaction.preventDefault) {
        defaultValues.push(Object.freeze(Object.assign({}, interaction.event)));
      }
    }

    function completeDelivery(queue, directives) {
      if (!queue.active) {
        throw new TypeError("internal owner event completion requires an active event");
      }
      var interaction = queue.active.interaction;
      if (directives.preventDefault) interaction.preventDefault = true;
      if (directives.stopPropagation && interaction.stopAfter == null) {
        interaction.stopAfter = queue.index;
        for (var later = queue.index + 1; later < ownerQueues.length; later += 1) {
          var laterQueue = ownerQueues[later];
          laterQueue.values = laterQueue.values.slice(laterQueue.head).filter(function(delivery) {
            return delivery.interaction !== interaction;
          });
          laterQueue.head = 0;
        }
      }
      interaction.resolved[queue.index] = true;
      queue.active = null;
      finalizeInteraction(interaction);
    }

    function queueGet(queue) {
      if (queue.active) {
        completeDelivery(queue, { preventDefault: false, stopPropagation: false });
      }
      while (queue.head < queue.values.length) {
        var delivery = queue.values[queue.head];
        var interaction = delivery.interaction;
        if (interaction.stopAfter != null && queue.index > interaction.stopAfter) {
          queue.head += 1;
          continue;
        }
        for (var earlier = 0; earlier < queue.index; earlier += 1) {
          if (interaction.resolved[earlier]) continue;
          var earlierQueue = ownerQueues[earlier];
          if (earlierQueue.active && earlierQueue.active.interaction === interaction) {
            completeDelivery(earlierQueue, { preventDefault: false, stopPropagation: false });
          }
        }
        for (var pending = 0; pending < queue.index; pending += 1) {
          if (!interaction.resolved[pending]) return null;
        }
        queue.head += 1;
        queue.active = delivery;
        if (queue.head >= 64 && queue.head * 2 >= queue.values.length) {
          queue.values = queue.values.slice(queue.head);
          queue.head = 0;
        }
        return delivery.payload;
      }
      return null;
    }

    function owner(kind, id) {
      var queue = { index: ownerQueues.length, values: [], head: 0, active: null };
      ownerQueues.push(queue);
      var value = Object.freeze({
        kind: kind,
        id: id,
        events: Object.freeze({ get: function() { return queueGet(queue); } })
      });
      ownerObjects.push(value);
      return value;
    }

    var buttonOwner = owner("Button", buttonId);
    var frameOwners = frameIds.map(function(id) { return owner("Frame", id); });
    var displayOwner = owner("Display", displayId);
    var queues = {
      button: buttonOwner,
      frame: frameOwners[0],
      frames: Object.freeze(frameOwners.slice()),
      display: displayOwner,
      completeInternalOwnerEvent: function(ownerValue, directives) {
        var ownerIndex = ownerObjects.indexOf(ownerValue);
        if (ownerIndex < 0) {
          throw new TypeError("internal owner event completion requires a bound owner");
        }
        directives = directives == null ? {} : directives;
        if (!directives || typeof directives !== "object" || Array.isArray(directives) ||
            Object.keys(directives).some(function(key) {
              return key !== "preventDefault" && key !== "stopPropagation";
            }) ||
            (directives.preventDefault != null && typeof directives.preventDefault !== "boolean") ||
            (directives.stopPropagation != null && typeof directives.stopPropagation !== "boolean")) {
          throw new TypeError("internal owner event completion is malformed");
        }
        completeDelivery(ownerQueues[ownerIndex], {
          preventDefault: directives.preventDefault === true,
          stopPropagation: directives.stopPropagation === true
        });
      },
      takeInternalDefaultEvent: function() {
        if (defaultHead >= defaultValues.length) return null;
        var value = defaultValues[defaultHead];
        defaultHead += 1;
        return value;
      },
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

        var interactionEvent = Object.freeze(Object.assign({}, event));
        var interaction = {
          event: interactionEvent,
          preventDefault: false,
          stopAfter: null,
          resolved: ownerQueues.map(function() { return false; }),
          finalized: false
        };
        var events = ownerQueues.map(function(queue) {
          var payload = Object.freeze(Object.assign({}, interactionEvent));
          queue.values.push({ interaction: interaction, payload: payload });
          return payload;
        });
        lastSequence = packet.seq;
        return events[0];
      }
    };
    return Object.freeze(queues);
  }

  function requireLayerId(value) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError("internal geometry pick owner queues require layerId");
    }
    return value;
  }

  function cloneGeometryPickEvent(event, layerId) {
    var target = event && event.target;
    if (!event || event.event !== "MouseButtonPressed" ||
        !target || typeof target !== "object" || Array.isArray(target) ||
        !Number.isSafeInteger(target.layer_id) || target.layer_id !== layerId ||
        (target.type !== "Face" && target.type !== "Edge" && target.type !== "Vertex")) {
      throw new TypeError("geometry pick target does not match its bound Layer");
    }
    var topologyKeys = Object.keys(target).filter(function(key) {
      return key !== "layer_id" && key !== "type";
    });
    if (topologyKeys.length === 0 || topologyKeys.some(function(key) {
      return !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
        !Number.isSafeInteger(target[key]) || target[key] < 0;
    })) {
      throw new TypeError("geometry pick target topology indices are malformed");
    }
    var targetCopy = {};
    Object.keys(target).forEach(function(key) { targetCopy[key] = target[key]; });
    targetCopy = Object.freeze(targetCopy);
    var eventCopy = {};
    Object.keys(event).forEach(function(key) {
      if (key !== "event" && key !== "target") { eventCopy[key] = event[key]; }
    });
    eventCopy.target = targetCopy;
    return Object.freeze(eventCopy);
  }

  function createInternalGeometryPickOwnerQueues(options) {
    options = options || {};
    var layerId = requireLayerId(options.layerId);
    var frameId = options.frameId == null ? "" : requireOwnerId(options.frameId, "frameId");
    var displayId = requireOwnerId(options.displayId, "displayId");
    var frameQueue = frameId ? createQueue() : null;
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
      display: owner("Display", displayId, displayQueue),
      consumeRuntimePacket: function(packet) {
        if (!packet || packet.kind !== "input.event" ||
            !Number.isSafeInteger(packet.seq) || packet.seq <= lastSequence) {
          throw new TypeError("internal owner event queues require increasing input.event packets");
        }
        var payloadError = validatePacketPayload("input.event", packet.payload, "route");
        if (payloadError) { throw new TypeError(payloadError); }
        var event = packet.payload.event;
        var frameEvent = frameQueue ? cloneGeometryPickEvent(event, layerId) : null;
        var displayEvent = cloneGeometryPickEvent(event, layerId);
        lastSequence = packet.seq;
        if (frameQueue) { frameQueue.push(frameEvent); }
        displayQueue.push(displayEvent);
        return frameEvent || displayEvent;
      }
    };
    if (frameQueue) { queues.frame = owner("Frame", frameId, frameQueue); }
    return Object.freeze(queues);
  }

  function executeInternalOwnerEventPoll(poll, owners) {
    var owner = poll && poll.owner;
    var boundOwner = owner && owners && owners[owner.name];
    var buttonPoll = poll && poll.owner_kind === "Button" &&
      poll.type === "ButtonEvent|null" && owner && owner.type === "ui_component<Button>";
    var displayPoll = poll && poll.owner_kind === "Display" &&
      poll.type === "DisplayEvent|null" && owner && owner.type === "Display<2>";
    if (!poll || poll.kind !== "ui_owner_event_get" || (!buttonPoll && !displayPoll) ||
        !owner || owner.kind !== "load" ||
        !boundOwner || boundOwner.kind !== poll.owner_kind || !boundOwner.events ||
        typeof boundOwner.events.get !== "function") {
      throw new TypeError("internal owner event poll is malformed");
    }
    return boundOwner.events.get();
  }

  return {
    PACKET_KINDS: PACKET_KINDS,
    BOOTSTRAP_COALESCE_KINDS: BOOTSTRAP_COALESCE_KINDS,
    validatePacketPayload: validatePacketPayload,
    createInternalButtonClickedOwnerQueues: createInternalButtonClickedOwnerQueues,
    createInternalGeometryPickOwnerQueues: createInternalGeometryPickOwnerQueues,
    executeInternalOwnerEventPoll: executeInternalOwnerEventPoll
  };
}));
