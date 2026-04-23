/**
 * WebGPU: draws packed vf-geom mesh (triangles or lines) into a canvas.
 * Depends: vf-geom-math.js (VfGeomMath)
 */
(function (global) {
  "use strict";

  function wlog(level, text) {
    var s = "[vf-geom-wgpu] " + String(text);
    try {
      if (global.console) {
        if (level === "error" && global.console.error) {
          global.console.error(s);
        } else if (global.console.warn) {
          global.console.warn(s);
        } else if (global.console.log) {
          global.console.log(s);
        }
      }
    } catch (e) {}
    try {
      if (global.chrome && global.chrome.webview && global.chrome.webview.postMessage) {
        global.chrome.webview.postMessage({ type: "vf_log", level: level, message: s, t: Date.now() });
      }
    } catch (e) {}
  }

  var SHADER = `
struct U { mvp: mat4x4<f32>, }
@group(0) @binding(0) var<uniform> u: U;

struct Vin {
  @location(0) pos: vec3<f32>,
  @location(1) color: vec4<f32>,
}
struct Vout {
  @builtin(position) clip: vec4<f32>,
  @location(0) color: vec4<f32>,
}
@vertex
fn vs(v: Vin) -> Vout {
  var o: Vout;
  o.clip = u.mvp * vec4f(v.pos, 1.0);
  o.color = v.color;
  return o;
}
@fragment
fn fs(i: Vout) -> @location(0) vec4f {
  return i.color;
}
`;

  var M = null;

  function getMath() {
    if (!M) {
      M = global.VfGeomMath;
    }
    if (!M) {
      throw new Error("VfGeomMath not loaded (include vf-geom-math.js before vf-geom-wgpu.js)");
    }
    return M;
  }

  /* One device + pipelines for all canvases. Multiple requestDevice() in WebView2 often fails after 1–2 — blank views. */
  var sharedWgpu = null;
  var sharedWgpuPromise = null;

  function getSharedWgpu() {
    if (sharedWgpu) {
      return Promise.resolve(sharedWgpu);
    }
    if (sharedWgpuPromise) {
      return sharedWgpuPromise;
    }
    if (!navigator.gpu) {
      wlog("error", "navigator.gpu missing — need WebView2/Chrome with --enable-unsafe-webgpu (vf-overlay sets this).");
      return Promise.resolve(null);
    }
    sharedWgpuPromise = (async function () {
      try {
        wlog("info", "getSharedWgpu: requestAdapter…");
        var adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
        if (!adapter) {
          wlog("error", "requestAdapter() returned null (no GPU or blocked).");
          sharedWgpuPromise = null;
          return null;
        }
        wlog("info", "getSharedWgpu: requestDevice…");
        var device = await adapter.requestDevice();
        device.lost.then(function (info) {
          wlog("error", "GPUDevice.lost: " + (info && info.message ? info.message : String(info)));
        });
        try {
          device.addEventListener("uncapturederror", function (ev) {
            var err = ev && ev.error;
            wlog("error", "WebGPU uncapturederror: " + (err && err.message ? err.message : String(err)));
          });
        } catch (e) {}
        var format = navigator.gpu.getPreferredCanvasFormat();
        wlog("info", "preferred canvas format: " + format);
        var mod = device.createShaderModule({ code: SHADER });
        var bindLayout = device.createBindGroupLayout({
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
              buffer: { type: "uniform" },
            },
          ],
        });
        var plLayout = device.createPipelineLayout({ bindGroupLayouts: [bindLayout] });
        var vbuf = {
          arrayStride: 28,
          stepMode: "vertex",
          attributes: [
            { format: "float32x3", offset: 0, shaderLocation: 0 },
            { format: "float32x4", offset: 12, shaderLocation: 1 },
          ],
        };
        var triDesc = {
          layout: plLayout,
          vertex: { module: mod, entryPoint: "vs", buffers: [vbuf] },
          fragment: {
            module: mod,
            entryPoint: "fs",
            targets: [{ format: format }],
          },
          primitive: { topology: "triangle-list", cullMode: "none" },
          depthStencil: { depthWriteEnabled: true, depthCompare: "less", format: "depth24plus" },
        };
        var lineDesc = {
          layout: plLayout,
          vertex: { module: mod, entryPoint: "vs", buffers: [vbuf] },
          fragment: {
            module: mod,
            entryPoint: "fs",
            targets: [{ format: format }],
          },
          primitive: { topology: "line-list" },
          depthStencil: { depthWriteEnabled: true, depthCompare: "less", format: "depth24plus" },
        };
        var pipeTri;
        var pipeLine;
        if (typeof device.createRenderPipelineAsync === "function") {
          wlog("info", "createRenderPipelineAsync (tri + line)…");
          pipeTri = await device.createRenderPipelineAsync(triDesc);
          pipeLine = await device.createRenderPipelineAsync(lineDesc);
        } else {
          wlog("warn", "createRenderPipelineAsync missing; using sync createRenderPipeline");
          pipeTri = device.createRenderPipeline(triDesc);
          pipeLine = device.createRenderPipeline(lineDesc);
        }
        sharedWgpu = { device: device, format: format, bindLayout: bindLayout, pipeTri: pipeTri, pipeLine: pipeLine };
        wlog("info", "getSharedWgpu: OK (one shared device for all panels)");
        return sharedWgpu;
      } catch (err) {
        var stack = err && err.stack ? err.stack : "";
        wlog("error", "getSharedWgpu failed: " + (err && err.message ? err.message : err) + (stack ? "\n" + stack : ""));
        sharedWgpu = null;
        sharedWgpuPromise = null;
        throw err;
      }
    })();
    return sharedWgpuPromise;
  }

  function VfGeomWgpu(canvas, getMesh) {
    this._canvas = canvas;
    this._getMesh = getMesh; // function(time) => mesh or null
    this._device = null;
    this._ctx = null;
    this._format = null;
    this._pipeTri = null;
    this._pipeLine = null;
    this._bindLayout = null;
    this._depthTex = null;
    this._uniformBuffer = null;
    this._bindGroup = null;
    this._vb = null;
    this._ib = null;
    this._ibCount = 0;
    this._ibFormat = "uint32";
    this._topology = "triangle-list";
    this._lastMesh = null;
    this._depthW = 0;
    this._depthH = 0;
    this._running = false;
    this._raf = 0;
    this._resizeRaf = 0;
    this._frameErrorLogged = false;
  }

  VfGeomWgpu.prototype = {
    _ensureDepth: function () {
      var c = this._canvas;
      var w = Math.max(1, c.width);
      var h = Math.max(1, c.height);
      if (this._depthTex && this._depthW === w && this._depthH === h) {
        return;
      }
      this._depthW = w;
      this._depthH = h;
      if (this._depthTex) {
        this._depthTex.destroy();
      }
      this._depthTex = this._device.createTexture({
        size: { width: w, height: h, depthOrArrayLayers: 1 },
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    },

    _uploadMesh: function (mesh) {
      if (!mesh || !this._device) {
        return;
      }
      var dev = this._device;
      try {
        if (this._vb) {
          this._vb.destroy();
          this._vb = null;
        }
        if (this._ib) {
          this._ib.destroy();
          this._ib = null;
        }
        this._vb = dev.createBuffer({ size: mesh.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        dev.queue.writeBuffer(this._vb, 0, mesh.vertices);
        this._ib = dev.createBuffer({ size: mesh.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
        dev.queue.writeBuffer(this._ib, 0, mesh.indices);
        this._ibCount = mesh.indices.length;
        this._topology = mesh.topology || "triangle-list";
      } catch (ue) {
        wlog("error", "_uploadMesh: " + (ue && ue.message ? ue.message : ue));
      }
    },

    /**
     * One full draw (mesh + MVO + pass). Used by the rAF loop and after context reconfigure on resize
     * so the swap chain is not left black between frames.
     */
    _renderContent: function (t) {
      if (!this._device) {
        return;
      }
      var tSec = t * 0.001;
      var mesh = this._getMesh(tSec);
      if (mesh) {
        if (mesh !== this._lastMesh) {
          this._lastMesh = mesh;
          this._uploadMesh(mesh);
        }
      }
      if (!this._vb || !this._ib) {
        return;
      }

      var M = getMath();
      var w = this._canvas.width;
      var h = this._canvas.height;
      var aspect = w / Math.max(1, h);
      var mvp;
      if (mesh && mesh.mode3d === false) {
        mvp = M.mat4OrthoZ01(-1, 1, -1, 1, 0, 1);
      } else {
        var ang = t * 0.0008;
        var persp = M.mat4PerspectiveZ01(0.45, aspect, 0.1, 50);
        var tr = M.mat4Translation(0, 0, -3.2);
        var rot = M.mat4RotationY(ang);
        mvp = M.mat4Mul(persp, M.mat4Mul(tr, rot));
      }

      this._device.queue.writeBuffer(this._uniformBuffer, 0, mvp);
      this._ensureDepth();
      var enc = this._device.createCommandEncoder();
      var pass = enc.beginRenderPass({
        colorAttachments: [
          {
            view: this._ctx.getCurrentTexture().createView(),
            clearValue: { r: 0.12, g: 0.12, b: 0.16, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
        depthStencilAttachment: {
          view: this._depthTex.createView(),
          depthClearValue: 1,
          depthLoadOp: "clear",
          depthStoreOp: "store",
        },
      });

      var pipe = this._topology === "line-list" ? this._pipeLine : this._pipeTri;
      pass.setPipeline(pipe);
      pass.setBindGroup(0, this._bindGroup);
      pass.setVertexBuffer(0, this._vb);
      pass.setIndexBuffer(this._ib, "uint32");
      pass.drawIndexed(this._ibCount, 1, 0, 0, 0);
      pass.end();
      this._device.queue.submit([enc.finish()]);
    },

    _frame: function (t) {
      var self = this;
      if (!self._running) {
        return;
      }
      if (!self._device) {
        if (self._running) {
          self._raf = requestAnimationFrame(function (x) {
            self._frame(x);
          });
        }
        return;
      }
      try {
        self._renderContent(t);
      } catch (ferr) {
        if (!self._frameErrorLogged) {
          self._frameErrorLogged = true;
          wlog("error", "_frame: " + (ferr && ferr.message ? ferr.message : ferr) + (ferr && ferr.stack ? "\n" + ferr.stack : ""));
        }
      }
      if (self._running) {
        self._raf = requestAnimationFrame(function (x) {
          self._frame(x);
        });
      }
    },

    start: function () {
      if (this._running) {
        return;
      }
      this._running = true;
      var self = this;
      this._raf = requestAnimationFrame(function (t) {
        self._frame(t);
      });
    },

    stop: function () {
      this._running = false;
      if (this._raf) {
        cancelAnimationFrame(this._raf);
        this._raf = 0;
      }
    },

    destroy: function () {
      this.stop();
      this._lastMesh = null;
      if (this._vb) {
        this._vb.destroy();
        this._vb = null;
      }
      if (this._ib) {
        this._ib.destroy();
        this._ib = null;
      }
      if (this._uniformBuffer) {
        this._uniformBuffer.destroy();
        this._uniformBuffer = null;
      }
      if (this._depthTex) {
        this._depthTex.destroy();
        this._depthTex = null;
      }
      this._device = null;
      this._ctx = null;
    },

    onResize: function () {
      if (!this._ctx || !this._device) {
        return;
      }
      if (this._resizeRaf) {
        try {
          cancelAnimationFrame(this._resizeRaf);
        } catch (_) {}
        this._resizeRaf = 0;
      }
      var base = {
        device: this._device,
        format: this._format,
        alphaMode: "opaque",
      };
      try {
        this._ctx.configure(base);
      } catch (e) {
        try {
          this._ctx.configure({
            device: this._device,
            format: this._format,
            alphaMode: "premultiplied",
          });
        } catch (e2) {
          wlog("error", "onResize configure: " + (e2 && e2.message ? e2.message : e2));
          return;
        }
      }
      this._depthW = 0;
      this._depthH = 0;
      this._ensureDepth();
      if (this._running && this._vb && this._ib) {
        var self = this;
        try {
          this._renderContent(performance.now());
        } catch (e3) {
          wlog("error", "onResize draw: " + (e3 && e3.message ? e3.message : e3));
        }
        /* One more draw on the next frame: after configure, the first getCurrentTexture can be stale in WebView2 while rescaling. */
        this._resizeRaf = requestAnimationFrame(function () {
          self._resizeRaf = 0;
          if (!self._running || !self._device || !self._vb || !self._ib) {
            return;
          }
          try {
            self._renderContent(performance.now());
          } catch (e4) {
            wlog("error", "onResize follow draw: " + (e4 && e4.message ? e4.message : e4));
          }
        });
      }
    },
  };

  /* WebView2 (legacy Chakra) rejects `async init: function(){}` in object literal — use assignment. */
  VfGeomWgpu.prototype.init = async function () {
    var c = this._canvas;
    var sg;
    try {
      sg = await getSharedWgpu();
    } catch (e) {
      wlog("error", "init: getSharedWgpu rejected: " + (e && e.message ? e.message : e));
      return false;
    }
    if (!sg) {
      wlog("error", "init: getSharedWgpu returned null (see prior vf-geom-wgpu lines)");
      return false;
    }
    this._device = sg.device;
    this._format = sg.format;
    this._bindLayout = sg.bindLayout;
    this._pipeTri = sg.pipeTri;
    this._pipeLine = sg.pipeLine;
    this._ctx = c.getContext("webgpu");
    if (!this._ctx) {
      wlog("error", "init: getContext('webgpu') null (canvas " + c.width + "x" + c.height + ")");
      return false;
    }
    try {
      this._ctx.configure({
        device: this._device,
        format: this._format,
        alphaMode: "opaque",
      });
      wlog("info", "init: canvas.configure OK (opaque), format=" + this._format);
    } catch (e) {
      wlog("warn", "init: configure opaque failed: " + (e && e.message ? e.message : e));
      try {
        this._ctx.configure({
          device: this._device,
          format: this._format,
          alphaMode: "premultiplied",
        });
        wlog("info", "init: canvas.configure OK (premultiplied)");
      } catch (e2) {
        wlog("error", "init: configure premultiplied failed: " + (e2 && e2.message ? e2.message : e2));
        return false;
      }
    }

    try {
      this._uniformBuffer = this._device.createBuffer({
        size: 64,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this._bindGroup = this._device.createBindGroup({
        layout: this._bindLayout,
        entries: [{ binding: 0, resource: { buffer: this._uniformBuffer } }],
      });
      this._ensureDepth();
      wlog("info", "init: OK canvas=" + c.width + "x" + c.height);
      return true;
    } catch (e3) {
      wlog("error", "init: buffer/bindGroup/depth: " + (e3 && e3.message ? e3.message : e3));
      return false;
    }
  };

  global.VfGeomWgpu = VfGeomWgpu;
})(typeof window !== "undefined" ? window : this);
