(function (global) {
  "use strict";

  var RECT_SLOT = 0;
  var RECT_W = 180;
  var RECT_H = 118;
  var START_X = 120;
  var START_Y = 96;

  function assertRuntime(name) {
    if (!global[name]) {
      throw new Error(name + " must be loaded before vf-shared-rect-demo.js");
    }
    return global[name];
  }

  function makeTrackedAdapter() {
    return {
      writes: [],
      writeBuffer: function (offset, bytes) {
        this.writes.push({
          offset: offset,
          byteLength: bytes.byteLength
        });
      }
    };
  }

  function rectFromMat4(mat4) {
    return {
      x: mat4[RECT_SLOT * 16 + 12],
      y: mat4[RECT_SLOT * 16 + 13],
      w: RECT_W,
      h: RECT_H
    };
  }

  function draw(ctx, canvas, mat4, dragging) {
    var rect = rectFromMat4(mat4);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    var x = Math.round(rect.x);
    var y = Math.round(rect.y);
    var w = Math.round(rect.w);
    var h = Math.round(rect.h);
    ctx.fillStyle = dragging ? "#ffd84d" : "#32d17d";
    ctx.fillRect(x, y, w, h);
  }

  function resizeCanvasToPanel(canvas) {
    var r = canvas.getBoundingClientRect();
    var dpr = global.devicePixelRatio || 1;
    var w = Math.max(1, Math.round(r.width * dpr));
    var h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return { w: w, h: h, dpr: dpr };
  }

  function createDemo(canvas) {
    var shared = assertRuntime("VfSharedRuntime");
    var gpu = assertRuntime("VfGpuRuntime");
    var wasmContract = assertRuntime("VfWasmDemoContract");
    var ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2D canvas context unavailable");
    }

    var arena = shared.createTransformArena(1);
    var eventArena = shared.createEventArena(32);
    var adapter = makeTrackedAdapter();
    var renderer = gpu.createTransformRenderer({ arena: arena, adapter: adapter });
    var sequence = 0;
    var dragging = false;
    var anchor = { x: 0, y: 0 };

    var compiledCoreStandIn = assertRuntime("VfSharedRectProgram").create();
    var contract = wasmContract.createWasmDemoContract({
      demo: compiledCoreStandIn,
      arena: arena,
      eventArena: eventArena
    });

    function canvasPoint(event) {
      var r = canvas.getBoundingClientRect();
      return {
        x: (event.clientX - r.left) * (canvas.width / r.width),
        y: (event.clientY - r.top) * (canvas.height / r.height)
      };
    }

    function containsRect(point) {
      var rect = rectFromMat4(arena.mat4);
      return point.x >= rect.x && point.x <= rect.x + rect.w &&
        point.y >= rect.y && point.y <= rect.y + rect.h;
    }

    function updateFromPointer(point, down) {
      eventArena.writeInputSample({
        sequence: ++sequence,
        timeMs: performance.now(),
        cursorPx: [point.x, point.y],
        pointerAnchorPx: [anchor.x, anchor.y],
        pointerDown: down,
        buttons: down ? 1 : 0
      });
      contract.update();
      renderer.flushDirtyTransforms();
    }

    canvas.addEventListener("pointerdown", function (event) {
      var point = canvasPoint(event);
      if (!containsRect(point)) {
        return;
      }
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      dragging = true;
      canvas.classList.add("dragging");
      anchor = point;
      updateFromPointer(point, true);
    });

    canvas.addEventListener("pointermove", function (event) {
      if (!dragging) {
        return;
      }
      event.preventDefault();
      updateFromPointer(canvasPoint(event), true);
    });

    canvas.addEventListener("pointerup", function (event) {
      if (!dragging) {
        return;
      }
      dragging = false;
      canvas.classList.remove("dragging");
      updateFromPointer(canvasPoint(event), false);
    });

    canvas.addEventListener("pointercancel", function () {
      dragging = false;
      canvas.classList.remove("dragging");
    });

    contract.init();
    renderer.flushDirtyTransforms();
    global.addEventListener("resize", function () {
      resizeCanvasToPanel(canvas);
    });

    function frame() {
      resizeCanvasToPanel(canvas);
      draw(ctx, canvas, arena.mat4, dragging);
      global.requestAnimationFrame(frame);
    }
    global.requestAnimationFrame(frame);

    return {
      arena: arena,
      eventArena: eventArena,
      adapter: adapter,
      renderer: renderer,
      contract: contract,
      getRect: function () {
        return rectFromMat4(arena.mat4);
      },
      getWrites: function () {
        return adapter.writes.slice();
      },
      getLatestInput: function () {
        return eventArena.latestSample();
      },
      isDragging: function () {
        return dragging;
      }
    };
  }

  global.VfSharedRectDemo = {
    createDemo: createDemo
  };

  global.addEventListener("DOMContentLoaded", function () {
    var layer = document.getElementById("layer");
    if (!layer) {
      throw new Error("vf-shared-rect-demo requires #layer");
    }
    var frameApi = global.VfFrame.mount(layer, {
      id: "shared-runtime-demo",
      title: "Shared runtime demo",
      titleAlign: "left",
      draggable: true,
      dockable: true,
      resizable: true,
      closable: true,
      alpha: 0.96,
      master: true,
      dockLocation: "bl",
      exitWhenLastFrameClosed: true
    });
    frameApi.root.style.left = "80px";
    frameApi.root.style.top = "72px";
    frameApi.root.style.width = "760px";
    frameApi.root.style.height = "460px";
    frameApi.root.classList.add("vf-frame--user-sized");

    var shell = document.createElement("div");
    shell.className = "vf-shared-demo-shell";
    var canvas = document.createElement("canvas");
    canvas.className = "vf-shared-demo-canvas";
    canvas.setAttribute("aria-label", "Shared runtime draggable rectangle demo");
    shell.appendChild(canvas);
    frameApi.body.replaceChildren(shell);

    global.__vfSharedFrame = frameApi;
    global.__vfSharedRectDemo = createDemo(canvas);

    if (global.VfFrame && typeof global.VfFrame.postNativeHostLayout === "function") {
      global.VfFrame.postNativeHostLayout(layer, { stageAlpha: 0 });
      global.requestAnimationFrame(function () {
        global.VfFrame.postNativeHostLayout(layer, { stageAlpha: 0 });
      });
    }
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
