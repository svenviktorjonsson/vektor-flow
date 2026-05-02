(function (global) {
  "use strict";

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

  function draw(ctx, canvas, rects, meshes) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (var i = 0; i < rects.length; i++) {
      var ref = rects[i];
      var rect = ref.world_rect();
      ctx.fillStyle = rgba(ref.color);
      ctx.fillRect(
        Math.round(rect.x),
        Math.round(rect.y),
        Math.round(rect.w),
        Math.round(rect.h)
      );
    }
    for (var m = 0; m < meshes.length; m++) {
      drawMesh(ctx, meshes[m]);
    }
  }

  function drawMesh(ctx, mesh) {
    var i;
    ctx.fillStyle = rgba(mesh.face_color);
    for (i = 0; i < mesh.faces.length; i++) {
      var face = mesh.faces[i];
      if (face.length < 3) {
        continue;
      }
      ctx.beginPath();
      var first = mesh.world_point(face[0]);
      ctx.moveTo(first[0], first[1]);
      for (var j = 1; j < face.length; j++) {
        var p = mesh.world_point(face[j]);
        ctx.lineTo(p[0], p[1]);
      }
      ctx.closePath();
      ctx.fill();
    }
    if (mesh.edge_width > 0) {
      ctx.strokeStyle = rgba(mesh.edge_color);
      ctx.lineWidth = mesh.edge_width;
      ctx.lineCap = "round";
      for (i = 0; i < mesh.edges.length; i++) {
        var edge = mesh.edges[i];
        var a = mesh.world_point(edge[0]);
        var b = mesh.world_point(edge[1]);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
    }
    if (mesh.vertex_width > 0) {
      ctx.fillStyle = rgba(mesh.vertex_color);
      for (i = 0; i < mesh.vertices.length; i++) {
        var v = mesh.world_point(mesh.vertices[i]);
        ctx.beginPath();
        ctx.arc(v[0], v[1], mesh.vertex_width, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function rgba(color) {
    var c = color || [1, 1, 1, 1];
    return "rgba(" +
      Math.round((Number(c[0]) || 0) * 255) + "," +
      Math.round((Number(c[1]) || 0) * 255) + "," +
      Math.round((Number(c[2]) || 0) * 255) + "," +
      (Number.isFinite(Number(c[3])) ? Number(c[3]) : 1) +
      ")";
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
    var vkfUi = assertRuntime("VfVkfUiRuntime");
    var gpu = assertRuntime("VfGpuRuntime");
    var wasmContract = assertRuntime("VfWasmDemoContract");
    var ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2D canvas context unavailable");
    }

    var arena = shared.createTransformArena(8);
    var eventArena = shared.createEventArena(32);
    var uiRuntime = vkfUi.createVkfUiRuntime({ arena: arena, eventArena: eventArena });
    var adapter = makeTrackedAdapter();
    var renderer = gpu.createTransformRenderer({ arena: arena, adapter: adapter });
    var sequence = 0;
    var dragging = false;
    var activeObjectId = -1;
    var activeHover = null;
    var anchor = { x: 0, y: 0 };

    var compiledCoreStandIn = assertRuntime("VfSharedRectProgram").create();
    var contract = wasmContract.createWasmDemoContract({
      demo: compiledCoreStandIn,
      arena: arena,
      eventArena: eventArena,
      uiRuntime: uiRuntime
    });

    function canvasPoint(event) {
      var r = canvas.getBoundingClientRect();
      return {
        x: (event.clientX - r.left) * (canvas.width / r.width),
        y: (event.clientY - r.top) * (canvas.height / r.height)
      };
    }

    function pickElement(point) {
      var frame = uiRuntime.ui.display.last_frame;
      return frame ? frame.pick([point.x, point.y]) : null;
    }

    function hoverFromPick(picked) {
      if (!picked) {
        return null;
      }
      if (picked.hover) {
        return {
          object: picked.hover.object_id,
          vertex: picked.hover.vertex_id,
          edge: picked.hover.edge_id,
          face: picked.hover.face_id
        };
      }
      return { object: picked.id };
    }

    function idFromPick(picked) {
      if (!picked) {
        return -1;
      }
      return picked.hover ? picked.hover.object_id : picked.id;
    }

    function updateFromPointer(point, down) {
      var picked = pickElement(point);
      var hover = hoverFromPick(picked);
      var objectId = idFromPick(picked);
      if (dragging && activeHover) {
        hover = activeHover;
        objectId = activeObjectId;
      }
      eventArena.writeInputSample({
        sequence: ++sequence,
        timeMs: performance.now(),
        cursorPx: [point.x, point.y],
        pointerAnchorPx: [anchor.x, anchor.y],
        pointerDown: down,
        buttons: down ? 1 : 0,
        hover: hover || (activeObjectId >= 0 ? { object: activeObjectId } : null)
      });
      contract.update();
      renderer.flushDirtyTransforms();
      anchor = point;
      if (objectId >= 0) {
        activeObjectId = objectId;
      }
      if (hover && !dragging) {
        activeHover = hover;
      }
    }

    canvas.addEventListener("pointerdown", function (event) {
      var point = canvasPoint(event);
      var picked = pickElement(point);
      if (!picked) {
        return;
      }
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      dragging = true;
      activeObjectId = idFromPick(picked);
      activeHover = hoverFromPick(picked);
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
      updateFromPointer(canvasPoint(event), false);
      activeObjectId = -1;
      activeHover = null;
    });

    canvas.addEventListener("pointercancel", function () {
      dragging = false;
      activeObjectId = -1;
      activeHover = null;
    });

    contract.init();
    renderer.flushDirtyTransforms();
    global.addEventListener("resize", function () {
      resizeCanvasToPanel(canvas);
    });

    function frame() {
      resizeCanvasToPanel(canvas);
      draw(ctx, canvas, uiRuntime.rects, uiRuntime.meshes);
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
        return uiRuntime.rects[0] ? uiRuntime.rects[0].world_rect() : null;
      },
      getRects: function () {
        return uiRuntime.rects.map(function (ref) {
          return ref.world_rect();
        });
      },
      getMeshes: function () {
        return uiRuntime.meshes.map(function (mesh) {
          return {
            points: mesh.world_points(),
            vertexWidth: mesh.vertex_width,
            edgeWidth: mesh.edge_width
          };
        });
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
