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

    var g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    g.addColorStop(0, "#111827");
    g.addColorStop(1, "#18202f");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(rect.x, rect.y);
    ctx.fillStyle = dragging ? "#ffdc4a" : "#3df2a3";
    ctx.strokeStyle = "#f8f4dc";
    ctx.lineWidth = 4;
    ctx.shadowColor = "rgba(61, 242, 163, 0.45)";
    ctx.shadowBlur = 24;
    ctx.beginPath();
    ctx.roundRect(0, 0, rect.w, rect.h, 16);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.stroke();

    ctx.fillStyle = "#11131d";
    ctx.font = "700 18px Consolas, monospace";
    ctx.fillText("VKF core seam", 18, 36);
    ctx.font = "13px Consolas, monospace";
    ctx.fillText("arena mat4[" + RECT_SLOT + "]", 18, 62);
    ctx.restore();
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
    var start = { x: START_X, y: START_Y };

    var compiledCoreStandIn = {
      init: function (api) {
        api.transforms.setTranslate2D(RECT_SLOT, START_X, START_Y);
      },
      update: function (input, api) {
        if (input.pointerDown) {
          api.transforms.setTranslate2D(
            RECT_SLOT,
            start.x + input.pointerX - input.pointerAnchorX,
            start.y + input.pointerY - input.pointerAnchorY
          );
        }
      }
    };
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
      var rect = rectFromMat4(arena.mat4);
      start = { x: rect.x, y: rect.y };
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

    function frame() {
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
    var canvas = document.getElementById("demo");
    if (canvas) {
      global.__vfSharedRectDemo = createDemo(canvas);
    }
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
