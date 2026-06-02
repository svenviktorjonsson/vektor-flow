(function(root, factory) {
  if (typeof module === "object" && module.exports) {
    var api = factory(
      root || globalThis,
      require("./vf-shared-runtime.js"),
      require("./vf-gpu-runtime.js"),
      require("./vf-vkf-ui-runtime.js")
    );
    module.exports = api;
    (root || globalThis).VfSharedRectDemo = api;
    return;
  }
  root.VfSharedRectDemo = factory(root || globalThis, root.VfSharedRuntime, root.VfGpuRuntime, root.VfVkfUiRuntime);
})(typeof globalThis !== "undefined" ? globalThis : this, function(global, shared, gpu, vkfUiRuntimeModule) {
  "use strict";

  var demoApi = null;
  var PRIMARY_RECT_SLOT = 0;
  var COMPILED_RECT_SLOTS = [0, 1, 2];

  function encodeU32(value, bytes) {
    value >>>= 0;
    do {
      var byte = value & 0x7f;
      value >>>= 7;
      if (value !== 0) {
        byte |= 0x80;
      }
      bytes.push(byte);
    } while (value !== 0);
  }

  function encodeI32(value, bytes) {
    value |= 0;
    var more = true;
    while (more) {
      var byte = value & 0x7f;
      value >>= 7;
      var signBit = (byte & 0x40) !== 0;
      more = !((value === 0 && !signBit) || (value === -1 && signBit));
      if (more) {
        byte |= 0x80;
      }
      bytes.push(byte);
    }
  }

  function encodeString(text, bytes) {
    var utf8 = new TextEncoder().encode(text);
    encodeU32(utf8.length, bytes);
    for (var i = 0; i < utf8.length; i += 1) {
      bytes.push(utf8[i]);
    }
  }

  function makeSection(id, content, bytes) {
    bytes.push(id);
    encodeU32(content.length, bytes);
    for (var i = 0; i < content.length; i += 1) {
      bytes.push(content[i]);
    }
  }

  function i32ConstBody(value) {
    var body = [];
    encodeU32(0, body);
    body.push(0x41);
    encodeI32(value, body);
    body.push(0x0b);
    return body;
  }

  function createInputSnapshot(sample) {
    sample = sample || {};
    return {
      sequence: sample.sequence == null ? 0 : sample.sequence | 0,
      timeMs: sample.timeMs == null ? 0 : Number(sample.timeMs) || 0,
      pointerX: sample.pointerX == null ? 0 : Number(sample.pointerX) || 0,
      pointerY: sample.pointerY == null ? 0 : Number(sample.pointerY) || 0,
      pointerAnchorX: sample.pointerAnchorX == null ? 0 : Number(sample.pointerAnchorX) || 0,
      pointerAnchorY: sample.pointerAnchorY == null ? 0 : Number(sample.pointerAnchorY) || 0,
      pointerDown: sample.pointerDown ? 1 : 0,
      buttons: sample.buttons == null ? 0 : sample.buttons | 0,
      keyMask: sample.keyMask == null ? 0 : sample.keyMask | 0
    };
  }

  function createCompiledRectRuntimeModuleBytes() {
    var bytes = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

    var typeSection = [];
    encodeU32(2, typeSection);
    typeSection.push(0x60); encodeU32(0, typeSection); encodeU32(0, typeSection);
    typeSection.push(0x60); encodeU32(0, typeSection); encodeU32(1, typeSection); typeSection.push(0x7f);
    makeSection(1, typeSection, bytes);

    var functionSection = [];
    encodeU32(7, functionSection);
    encodeU32(0, functionSection);
    encodeU32(0, functionSection);
    encodeU32(0, functionSection);
    encodeU32(1, functionSection);
    encodeU32(1, functionSection);
    encodeU32(1, functionSection);
    encodeU32(1, functionSection);
    makeSection(3, functionSection, bytes);

    var memorySection = [];
    encodeU32(1, memorySection);
    memorySection.push(0x00);
    encodeU32(1, memorySection);
    makeSection(5, memorySection, bytes);

    var exportSection = [];
    encodeU32(8, exportSection);
    encodeString("memory", exportSection); exportSection.push(0x02); encodeU32(0, exportSection);
    ["vkf_init", "vkf_update", "vkf_shutdown", "vkf_state_ptr", "vkf_state_size", "vkf_input_ptr", "vkf_input_size"].forEach(function(name, index) {
      encodeString(name, exportSection);
      exportSection.push(0x00);
      encodeU32(index, exportSection);
    });
    makeSection(7, exportSection, bytes);

    var codeSection = [];
    encodeU32(7, codeSection);

    var initBody = [];
    encodeU32(0, initBody);
    [0, 4, 8, 12, 16, 20, 24, 28, 32, 36].forEach(function(offset) {
      initBody.push(0x41); encodeI32(offset, initBody);
      initBody.push(0x41); encodeI32(0, initBody);
      initBody.push(0x36); encodeU32(2, initBody); encodeU32(0, initBody);
    });
    initBody.push(0x0b);
    encodeU32(initBody.length, codeSection); initBody.forEach(function(byte) { codeSection.push(byte); });

    var updateBody = [];
    encodeU32(0, updateBody);
    updateBody.push(0x41); encodeI32(0, updateBody);
    updateBody.push(0x41); encodeI32(24, updateBody);
    updateBody.push(0x28); encodeU32(2, updateBody); encodeU32(0, updateBody);
    updateBody.push(0x41); encodeI32(32, updateBody);
    updateBody.push(0x28); encodeU32(2, updateBody); encodeU32(0, updateBody);
    updateBody.push(0x6b);
    updateBody.push(0x36); encodeU32(2, updateBody); encodeU32(0, updateBody);

    updateBody.push(0x41); encodeI32(4, updateBody);
    updateBody.push(0x41); encodeI32(28, updateBody);
    updateBody.push(0x28); encodeU32(2, updateBody); encodeU32(0, updateBody);
    updateBody.push(0x41); encodeI32(36, updateBody);
    updateBody.push(0x28); encodeU32(2, updateBody); encodeU32(0, updateBody);
    updateBody.push(0x6b);
    updateBody.push(0x36); encodeU32(2, updateBody); encodeU32(0, updateBody);
    updateBody.push(0x41); encodeI32(8, updateBody);
    updateBody.push(0x41); encodeI32(0, updateBody);
    updateBody.push(0x28); encodeU32(2, updateBody); encodeU32(0, updateBody);
    updateBody.push(0x41); encodeI32(40, updateBody);
    updateBody.push(0x6a);
    updateBody.push(0x36); encodeU32(2, updateBody); encodeU32(0, updateBody);
    updateBody.push(0x41); encodeI32(12, updateBody);
    updateBody.push(0x41); encodeI32(4, updateBody);
    updateBody.push(0x28); encodeU32(2, updateBody); encodeU32(0, updateBody);
    updateBody.push(0x41); encodeI32(38, updateBody);
    updateBody.push(0x6a);
    updateBody.push(0x36); encodeU32(2, updateBody); encodeU32(0, updateBody);
    updateBody.push(0x41); encodeI32(16, updateBody);
    updateBody.push(0x41); encodeI32(0, updateBody);
    updateBody.push(0x28); encodeU32(2, updateBody); encodeU32(0, updateBody);
    updateBody.push(0x41); encodeI32(78, updateBody);
    updateBody.push(0x6a);
    updateBody.push(0x36); encodeU32(2, updateBody); encodeU32(0, updateBody);
    updateBody.push(0x41); encodeI32(20, updateBody);
    updateBody.push(0x41); encodeI32(4, updateBody);
    updateBody.push(0x28); encodeU32(2, updateBody); encodeU32(0, updateBody);
    updateBody.push(0x41); encodeI32(64, updateBody);
    updateBody.push(0x6a);
    updateBody.push(0x36); encodeU32(2, updateBody); encodeU32(0, updateBody);
    updateBody.push(0x0b);
    encodeU32(updateBody.length, codeSection); updateBody.forEach(function(byte) { codeSection.push(byte); });

    var noopBody = [0x00, 0x0b];
    encodeU32(noopBody.length, codeSection); noopBody.forEach(function(byte) { codeSection.push(byte); });

    [0, 24, 24, 16].forEach(function(value) {
      var body = i32ConstBody(value);
      encodeU32(body.length, codeSection);
      body.forEach(function(byte) { codeSection.push(byte); });
    });

    makeSection(10, codeSection, bytes);
    return new Uint8Array(bytes);
  }

  function createCompiledRectRuntime(uiRuntime) {
    if (!uiRuntime || !uiRuntime.ui || !uiRuntime.ui.compiled || typeof uiRuntime.ui.compiled.load_wasm_runtime !== "function") {
      return null;
    }
    return uiRuntime.ui.compiled.load_wasm_runtime({
      manifest: {
        runtime_surface: {
          state_ptr_export: "vkf_state_ptr",
          state_size_export: "vkf_state_size",
          input_ptr_export: "vkf_input_ptr",
          input_size_export: "vkf_input_size",
          init_export: "vkf_init",
          update_export: "vkf_update",
          shutdown_export: "vkf_shutdown",
          state_fields: [
            { name: "x", offset: 0, type: "num" },
            { name: "y", offset: 4, type: "num" },
            { name: "x1", offset: 8, type: "num" },
            { name: "y1", offset: 12, type: "num" },
            { name: "x2", offset: 16, type: "num" },
            { name: "y2", offset: 20, type: "num" }
          ],
          input_fields: [
            { name: "pointer_x", offset: 0, type: "num" },
            { name: "pointer_y", offset: 4, type: "num" },
            { name: "anchor_x", offset: 8, type: "num" },
            { name: "anchor_y", offset: 12, type: "num" }
          ]
        }
      },
      bytes: createCompiledRectRuntimeModuleBytes()
    });
  }

  function rgba(color) {
    var r = Math.round((color[0] || 0) * 255);
    var g = Math.round((color[1] || 0) * 255);
    var b = Math.round((color[2] || 0) * 255);
    var a = color.length > 3 ? color[3] : 1;
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  }

  function edgeDash(style, unitLength) {
    var unit = unitLength || 6;
    if (style === ".  ") {
      return { dash: [0, unit * 2], cap: "round" };
    }
    if (style === "---  ") {
      return { dash: [unit * 3, unit * 2], cap: "butt" };
    }
    return { dash: [], cap: "butt" };
  }

  function drawVertex(ctx, point, radius, style, color) {
    if (!(radius > 0)) { return; }
    ctx.fillStyle = rgba(color);
    if (style === "square") {
      ctx.rect(point[0] - radius, point[1] - radius, radius * 2, radius * 2);
      ctx.fill();
      return;
    }
    if (style === "triangle") {
      ctx.beginPath();
      ctx.moveTo(point[0], point[1] - radius);
      ctx.lineTo(point[0] + radius, point[1] + radius);
      ctx.lineTo(point[0] - radius, point[1] + radius);
      ctx.closePath();
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.arc(point[0], point[1], radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawMesh(ctx, mesh) {
    var faces = mesh.faces || [];
    var edges = mesh.edges || [];
    var vertices = mesh.vertices || [];
    var edgeWidth = mesh.edge_width || 1;
    var edgeStyle = edgeDash(mesh.edge_style || "", mesh.edge_unit_length || 6);
    var faceColor = mesh.face_color || [0, 0, 0, 0];
    var edgeColor = mesh.edge_color || [1, 1, 1, 1];
    var vertexColor = mesh.vertex_color || [1, 1, 1, 1];
    var vertexRadius = mesh.vertex_radius || 0;
    var vertexStyle = mesh.vertex_style || "disc";

    for (var f = 0; f < faces.length; f += 1) {
      var face = faces[f];
      if (!face || !face.length) { continue; }
      ctx.beginPath();
      var first = mesh.world_point(face[0]);
      ctx.moveTo(first[0], first[1]);
      for (var fi = 1; fi < face.length; fi += 1) {
        var fp = mesh.world_point(face[fi]);
        ctx.lineTo(fp[0], fp[1]);
      }
      ctx.closePath();
      ctx.fillStyle = rgba(faceColor);
      ctx.fill();
    }

    ctx.save();
    ctx.strokeStyle = rgba(edgeColor);
    ctx.lineWidth = edgeWidth;
    ctx.setLineDash(edgeStyle.dash);
    ctx.lineCap = edgeStyle.cap;
    for (var e = 0; e < edges.length; e += 1) {
      var edge = edges[e];
      var a = mesh.world_point(edge[0]);
      var b = mesh.world_point(edge[1]);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
    ctx.restore();

    for (var v = 0; v < vertices.length; v += 1) {
      drawVertex(ctx, mesh.world_point(vertices[v]), vertexRadius, vertexStyle, vertexColor);
    }
  }

  function createBrowserDemo() {
    var transformArena = shared.createTransformArena(12);
    var eventArena = shared.createEventArena(8);
    var uiRuntime = vkfUiRuntimeModule && typeof vkfUiRuntimeModule.createVkfUiRuntime === "function"
      ? vkfUiRuntimeModule.createVkfUiRuntime({ arena: transformArena, eventArena: eventArena })
      : null;
    var uiFrame = uiRuntime ? uiRuntime.ui.display.frame({ title: "shared-rect-demo" }) : null;
    var writeLog = [];
    var transformRenderer = gpu.createTransformRenderer({
      arena: transformArena,
      adapter: {
        writeBuffer: function(offset, floatView) {
          writeLog.push({
            offset: offset,
            bytes: Array.from(new Float32Array(floatView.buffer.slice(floatView.byteOffset, floatView.byteOffset + floatView.byteLength)))
          });
        }
      }
    });

    var meshRects = [
      { x: 80, y: 70, w: 220, h: 200, face: [0.14, 0.51, 0.93, 0.24], edge: [0.14, 0.51, 0.93, 1], vertex: [0.85, 0.95, 1, 1] },
      { x: 120, y: 120, w: 90, h: 70, face: [0.1, 0.8, 0.5, 0.2], edge: [0.1, 0.8, 0.5, 1], vertex: [0.8, 1, 0.9, 1] },
      { x: 210, y: 190, w: 70, h: 50, face: [0.95, 0.7, 0.2, 0.2], edge: [0.95, 0.7, 0.2, 1], vertex: [1, 0.95, 0.8, 1] }
    ];
    while (meshRects.length < 12) {
      meshRects.push({ x: 0, y: 0, w: 0, h: 0, face: [0, 0, 0, 0], edge: [0, 0, 0, 0], vertex: [0, 0, 0, 0] });
    }

    meshRects.forEach(function(rect, slot) {
      transformArena.setTranslate2D(slot, rect.x, rect.y);
    });
    transformRenderer.flushDirtyTransforms();
    if (uiRuntime && uiFrame) {
      uiRuntime.ui.display.add_frame(uiFrame, [0, 0, 1, 1]);
    }

    var decorativeRects = [
      { x: 88, y: 72, w: 260, h: 172 },
      { x: 134, y: 110, w: 142, h: 94 },
      { x: 168, y: 134, w: 54, h: 38 }
    ];

    function makeRectMesh(slot, rect) {
      return {
        slot: slot,
        face_color: rect.face,
        edge_color: rect.edge,
        vertex_color: rect.vertex,
        edge_width: 2,
        edge_style: slot === 0 ? "---  " : "",
        edge_unit_length: 6,
        vertex_radius: slot === 0 ? 4 : 0,
        vertex_style: "disc",
        vertices: slot === 0 ? [0, 1, 2, 3] : [],
        edges: [[0, 1], [1, 2], [2, 3], [3, 0]],
        faces: rect.w > 0 && rect.h > 0 ? [[0, 1, 2, 3]] : [],
        world_point: function(index) {
          var tx = transformArena.mat4[slot * shared.MAT4_F32 + 12];
          var ty = transformArena.mat4[slot * shared.MAT4_F32 + 13];
          if (index === 0) { return [tx, ty + rect.h, 0]; }
          if (index === 1) { return [tx + rect.w, ty + rect.h, 0]; }
          if (index === 2) { return [tx + rect.w, ty, 0]; }
          return [tx, ty, 0];
        }
      };
    }

    var meshes = meshRects.map(function(rect, slot) {
      return makeRectMesh(slot, rect);
    });
    var compiledRuntime = createCompiledRectRuntime(uiRuntime);
    var compiledController = null;
    var compiledRectObjects = uiFrame ? COMPILED_RECT_SLOTS.map(function(slot) {
      return uiFrame.add_rect(
        [meshRects[slot].x, meshRects[slot].y, meshRects[slot].w, meshRects[slot].h],
        { color: meshRects[slot].face }
      );
    }) : [];
    var primaryRectObject = compiledRectObjects.length ? compiledRectObjects[PRIMARY_RECT_SLOT] : null;

    var canvas = null;
    var ctx = null;
    var latestInput = createInputSnapshot({});
    var latestSample = eventArena.readerView().latestSample();
    var pointerActive = false;
    var pointerAnchor = [0, 0];
    var sequence = 0;

    function postLayout() {
      if (!global.chrome || !global.chrome.webview || typeof global.chrome.webview.postMessage !== "function") {
        return;
      }
      var rect = meshRects[0];
      global.chrome.webview.postMessage({
        type: "layout",
        stageAlpha: 0,
        hitRegions: [{
          left: rect.x,
          top: rect.y,
          right: rect.x + rect.w,
          bottom: rect.y + rect.h
        }]
      });
    }

    function render() {
      if (!ctx || !canvas) { return; }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      meshes.forEach(function(mesh) {
        if (!mesh.faces.length && !mesh.edges.length) { return; }
        drawMesh(ctx, mesh);
      });
    }

    function syncCompiledRectsFromState(state) {
      if (!state) { return; }
      var keyPairs = [
        ["x", "y"],
        ["x1", "y1"],
        ["x2", "y2"]
      ];
      for (var i = 0; i < COMPILED_RECT_SLOTS.length; i += 1) {
        var slot = COMPILED_RECT_SLOTS[i];
        var keys = keyPairs[i];
        if (Object.prototype.hasOwnProperty.call(state, keys[0])) {
          meshRects[slot].x = Number(state[keys[0]]) || 0;
        }
        if (Object.prototype.hasOwnProperty.call(state, keys[1])) {
          meshRects[slot].y = Number(state[keys[1]]) || 0;
        }
        transformArena.setTranslate2D(slot, meshRects[slot].x, meshRects[slot].y);
      }
    }

    function isPrimaryRectHit(point) {
      if (uiFrame && typeof uiFrame.pick === "function") {
        var hit = uiFrame.pick(point);
        return hit === primaryRectObject;
      }
      var rect = meshRects[PRIMARY_RECT_SLOT];
      return point[0] >= rect.x && point[0] <= rect.x + rect.w && point[1] >= rect.y && point[1] <= rect.y + rect.h;
    }

    function updateFromPointer(sample) {
      sequence += 1;
      eventArena.writeInputSample({
        sequence: sequence,
        timeMs: Date.now(),
        cursorPx: [sample.x, sample.y],
        pointerAnchorPx: pointerAnchor.slice(),
        pointerDown: !!sample.down,
        buttons: sample.down ? 1 : 0,
        hover: { object: 0 }
      });
      latestSample = eventArena.readerView().latestSample();
      latestInput = createInputSnapshot({
        sequence: sequence,
        timeMs: Date.now(),
        pointerX: sample.x,
        pointerY: sample.y,
        pointerAnchorX: pointerAnchor[0],
        pointerAnchorY: pointerAnchor[1],
        pointerDown: !!sample.down,
        buttons: sample.down ? 1 : 0
      });
      if (compiledController) {
        compiledController.step({
          cursorPx: [sample.x, sample.y],
          pointerAnchorPx: pointerAnchor.slice()
        });
      } else {
        transformArena.setAnchoredTranslate2D(PRIMARY_RECT_SLOT, sample.x, sample.y, pointerAnchor[0], pointerAnchor[1]);
      }
      transformRenderer.flushDirtyTransforms();
      render();
      postLayout();
    }

    function bindCanvas(nextCanvas) {
      canvas = nextCanvas;
      ctx = canvas.getContext("2d");
      function pointerPos(ev) {
        var box = canvas.getBoundingClientRect();
        return [ev.clientX - box.left, ev.clientY - box.top];
      }
      canvas.addEventListener("pointerdown", function(ev) {
        var pos = pointerPos(ev);
        if (!isPrimaryRectHit(pos)) {
          return;
        }
        pointerActive = true;
        pointerAnchor = [pos[0] - meshRects[PRIMARY_RECT_SLOT].x, pos[1] - meshRects[PRIMARY_RECT_SLOT].y];
        updateFromPointer({ x: pos[0], y: pos[1], down: true });
      });
      canvas.addEventListener("pointermove", function(ev) {
        if (!pointerActive) { return; }
        var pos = pointerPos(ev);
        updateFromPointer({ x: pos[0], y: pos[1], down: true });
      });
      canvas.addEventListener("pointerup", function(ev) {
        if (!pointerActive) { return; }
        pointerActive = false;
        var pos = pointerPos(ev);
        updateFromPointer({ x: pos[0], y: pos[1], down: false });
      });
      render();
      postLayout();
    }

    if (uiRuntime && uiRuntime.ui && uiRuntime.ui.compiled && typeof uiRuntime.ui.compiled.attach_wasm_runtime_controller === "function" && compiledRuntime) {
      var compiledRectStateApplier = null;
      if (typeof uiRuntime.ui.compiled.create_rect_state_applier === "function" && typeof uiRuntime.ui.compiled.compose_state_appliers === "function") {
        compiledRectStateApplier = uiRuntime.ui.compiled.compose_state_appliers(
          compiledRectObjects.map(function(object, index) {
            if (!object) { return null; }
            var suffix = index === 0 ? "" : String(index);
            return uiRuntime.ui.compiled.create_rect_state_applier(object, {
              offsetFields: ["x" + suffix, "y" + suffix]
            });
          })
        );
      }
      compiledController = uiRuntime.ui.compiled.attach_wasm_runtime_controller({
        runtime: compiledRuntime,
        mapInput: function(sample) {
          sample = sample || {};
          var cursorPx = sample.cursorPx || [0, 0];
          var pointerAnchorPx = sample.pointerAnchorPx || [0, 0];
          return {
            pointer_x: Number(cursorPx[0]) || 0,
            pointer_y: Number(cursorPx[1]) || 0,
            anchor_x: Number(pointerAnchorPx[0]) || 0,
            anchor_y: Number(pointerAnchorPx[1]) || 0
          };
        },
        applyState: function(state) {
          if (compiledRectStateApplier) {
            compiledRectStateApplier(state);
          }
          syncCompiledRectsFromState(state);
        }
      });
      compiledController.init({
        x: meshRects[PRIMARY_RECT_SLOT].x,
        y: meshRects[PRIMARY_RECT_SLOT].y,
        x1: meshRects[1].x,
        y1: meshRects[1].y,
        x2: meshRects[2].x,
        y2: meshRects[2].y
      });
    }

    return {
      bindCanvas: bindCanvas,
      drivePointerSample: function(sample) {
        sample = sample || {};
        if (sample.anchor) {
          pointerAnchor = sample.anchor.slice(0, 2);
        }
        if (sample.pointerActive != null) {
          pointerActive = !!sample.pointerActive;
        }
        updateFromPointer({
          x: Number(sample.x) || 0,
          y: Number(sample.y) || 0,
          down: sample.down !== false
        });
      },
      getMeshes: function() {
        return meshes.map(function(mesh) {
          return {
            points: [mesh.world_point(0), mesh.world_point(1), mesh.world_point(2), mesh.world_point(3)]
          };
        });
      },
      getRects: function() {
        return decorativeRects.map(function(rect) { return { x: rect.x, y: rect.y, w: rect.w, h: rect.h }; });
      },
      getPrimaryRect: function() {
        return {
          x: meshRects[PRIMARY_RECT_SLOT].x,
          y: meshRects[PRIMARY_RECT_SLOT].y,
          w: meshRects[PRIMARY_RECT_SLOT].w,
          h: meshRects[PRIMARY_RECT_SLOT].h
        };
      },
      getCompiledRects: function() {
        return COMPILED_RECT_SLOTS.map(function(slot) {
          return {
            x: meshRects[slot].x,
            y: meshRects[slot].y,
            w: meshRects[slot].w,
            h: meshRects[slot].h
          };
        });
      },
      hitTestPointer: function(point) {
        return isPrimaryRectHit(point);
      },
      getWrites: function() { return writeLog.slice(); },
      getLatestInput: function() { return latestSample; },
      getLatestSnapshot: function() { return latestInput; },
      getCompiledState: function() {
        return compiledController ? compiledController.readState() : (compiledRuntime ? compiledRuntime.readState() : null);
      }
    };
  }

  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("DOMContentLoaded", function() {
      var canvas = document.querySelector(".vf-shared-demo-canvas");
      if (!canvas) { return; }
      canvas.width = canvas.clientWidth || 960;
      canvas.height = canvas.clientHeight || 540;
      demoApi = createBrowserDemo();
      demoApi.bindCanvas(canvas);
      global.__vfSharedRectDemo = demoApi;
    }, { once: true });
  }

  return {
    drawMesh: drawMesh,
    createBrowserDemo: createBrowserDemo
  };
});
