(function(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root || globalThis, require("./vf-shared-runtime.js"));
    return;
  }
  var api = factory(root || globalThis, root.VfSharedRuntime);
  root.VfGpuRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function(global, shared) {
  "use strict";

  function createTransformRenderer(options) {
    options = options || {};
    var arena = options.arena;
    var adapter = options.adapter;
    var byteOffset = Number(options.byteOffset) || 0;
    var view = arena.rendererView();

    return {
      flushDirtyTransforms: function() {
        var snapshot = view.copyDirtyMat4();
        if (snapshot.range.min < 0 || snapshot.range.max < snapshot.range.min) {
          return {
            version: snapshot.range.version,
            min: snapshot.range.min,
            max: snapshot.range.max,
            bytesWritten: 0
          };
        }
        var bytes = snapshot.data;
        var offset = byteOffset + snapshot.range.min * shared.MAT4_F32 * Float32Array.BYTES_PER_ELEMENT;
        adapter.writeBuffer(offset, bytes);
        view.consumeDirtyRange();
        return {
          version: snapshot.range.version,
          min: snapshot.range.min,
          max: snapshot.range.max,
          bytesWritten: bytes.byteLength
        };
      }
    };
  }

  function createWebGpuTransformAdapter(options) {
    options = options || {};
    var device = options.device;
    var buffer = options.buffer;
    return {
      writeBuffer: function(offset, floatView) {
        device.queue.writeBuffer(
          buffer,
          offset,
          floatView.buffer,
          floatView.byteOffset,
          floatView.byteLength
        );
      }
    };
  }

  function createWebGlTransformAdapter(options) {
    options = options || {};
    var gl = options.gl;
    var buffer = options.buffer;
    return {
      writeBuffer: function(offset, floatView) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, offset, floatView);
      }
    };
  }

  function gpuUsage(name, fallback) {
    var table = global && global.GPUBufferUsage ? global.GPUBufferUsage : null;
    return table && table[name] != null ? table[name] : fallback;
  }

  function gpuStage(name, fallback) {
    var table = global && global.GPUShaderStage ? global.GPUShaderStage : null;
    return table && table[name] != null ? table[name] : fallback;
  }

  function ceilDiv(a, b) {
    return Math.ceil(Math.max(0, Number(a) || 0) / Math.max(1, Number(b) || 1));
  }

  function normalizeParticleData(input, count) {
    if (input instanceof Float32Array) {
      return input;
    }
    var out = new Float32Array(count * 8);
    var items = Array.isArray(input) ? input : [];
    for (var i = 0; i < count; i += 1) {
      var item = items[i] || {};
      var base = i * 8;
      var r = Number(item.radius == null ? item.r : item.radius) || 0.01;
      var density = Number(item.density == null ? 1.0 : item.density) || 1.0;
      var mass = Number(item.mass);
      if (!(mass > 0.0)) {
        mass = Math.max(1.0e-9, Math.PI * r * r * density);
      }
      out[base + 0] = Number(item.x) || 0.0;
      out[base + 1] = Number(item.y) || 0.0;
      out[base + 2] = r;
      out[base + 3] = density;
      out[base + 4] = Number(item.vx) || 0.0;
      out[base + 5] = Number(item.vy) || 0.0;
      out[base + 6] = mass;
      out[base + 7] = 0.0;
    }
    return out;
  }

  function createBufferWithData(device, label, usage, dataOrByteLength) {
    var size = typeof dataOrByteLength === "number" ? dataOrByteLength : dataOrByteLength.byteLength;
    var buffer = device.createBuffer({ label: label, size: Math.max(4, size), usage: usage });
    if (typeof dataOrByteLength !== "number" && dataOrByteLength.byteLength > 0) {
      device.queue.writeBuffer(buffer, 0, dataOrByteLength.buffer, dataOrByteLength.byteOffset, dataOrByteLength.byteLength);
    }
    return buffer;
  }

  function makeHardDiscParams(options, dt) {
    var out = new Float32Array(16);
    out[0] = Number(options.worldWidth || options.width || 1.0) || 1.0;
    out[1] = Number(options.worldHeight || options.height || 1.0) || 1.0;
    out[2] = Number(options.restitution == null ? 1.0 : options.restitution) || 0.0;
    out[3] = Math.max(0.0, Number(dt) || 0.0);
    var gravity = Array.isArray(options.gravity) ? options.gravity : [0.0, 0.0];
    out[4] = Number(gravity[0]) || 0.0;
    out[5] = Number(gravity[1]) || 0.0;
    out[6] = Number(options.contactBandRatio == null ? 0.05 : options.contactBandRatio) || 0.0;
    out[7] = Number(options.particleCount || 0) || 0.0;
    out[8] = Number(options.cellSize || 0.025) || 0.025;
    out[9] = Number(options.gridCols || 1) || 1;
    out[10] = Number(options.gridRows || 1) || 1;
    out[11] = Number(options.maxParticlesPerCell || 64) || 64;
    out[12] = Number(options.passIndex || 0) || 0;
    out[13] = Number(options.passCount || 1) || 1;
    return out;
  }

  function createHardDiscPhysicsRuntime(options) {
    options = options || {};
    var device = options.device;
    if (!device) {
      throw new Error("createHardDiscPhysicsRuntime requires a WebGPU device");
    }
    var particleCount = Math.max(0, Number(options.particleCount || (options.particles && options.particles.length) || 0) | 0);
    var particles = normalizeParticleData(options.initialParticles || options.particles || [], particleCount);
    particleCount = Math.max(particleCount, Math.floor(particles.length / 8));
    var workgroupSize = Math.max(1, Number(options.workgroupSize || 128) | 0);
    var worldWidth = Number(options.worldWidth || options.width || 1.0) || 1.0;
    var worldHeight = Number(options.worldHeight || options.height || 1.0) || 1.0;
    var cellSize = Number(options.cellSize);
    if (!(cellSize > 0.0)) {
      cellSize = Number(options.maxRadius || 0.0125) * 2.25;
    }
    cellSize = Math.max(1.0e-5, cellSize);
    var gridCols = Math.max(1, Math.ceil(worldWidth / cellSize));
    var gridRows = Math.max(1, Math.ceil(worldHeight / cellSize));
    var maxParticlesPerCell = Math.max(8, Number(options.maxParticlesPerCell || 64) | 0);
    var gridCellCount = gridCols * gridRows;
    var storageUsage = gpuUsage("STORAGE", 128);
    var vertexUsage = gpuUsage("VERTEX", 32);
    var copyDstUsage = gpuUsage("COPY_DST", 8);
    var uniformUsage = gpuUsage("UNIFORM", 64);
    var particleBuffer = createBufferWithData(device, "vf physics particles", storageUsage | copyDstUsage, particles);
    var cellCountsBuffer = createBufferWithData(device, "vf physics cell counts", storageUsage | copyDstUsage, gridCellCount * 4);
    var cellItemsBuffer = createBufferWithData(device, "vf physics cell items", storageUsage | copyDstUsage, gridCellCount * maxParticlesPerCell * 4);
    var paramsBuffer = createBufferWithData(device, "vf physics params", uniformUsage | copyDstUsage, 16 * 4);
    var collisionMatrix = options.collisionMatrix instanceof Float32Array
      ? options.collisionMatrix
      : new Float32Array(options.collisionMatrix || [Number(options.restitution == null ? 1.0 : options.restitution), 0.0, 0.0, 1.0]);
    var collisionMatrixBuffer = createBufferWithData(device, "vf physics collision matrix", storageUsage | copyDstUsage, collisionMatrix);
    var renderInstanceBuffer = createBufferWithData(device, "vf physics render instances", storageUsage | vertexUsage | copyDstUsage, Math.max(1, particleCount * 8) * 4);
    var shaderModule = device.createShaderModule({ label: "vf physics hard discs", code: String(options.wgsl || options.shader || "") });
    var computeStage = gpuStage("COMPUTE", 4);
    var bindLayout = device.createBindGroupLayout({
      label: "vf physics hard discs bind layout",
      entries: [
        { binding: 0, visibility: computeStage, buffer: { type: "storage" } },
        { binding: 1, visibility: computeStage, buffer: { type: "storage" } },
        { binding: 2, visibility: computeStage, buffer: { type: "storage" } },
        { binding: 3, visibility: computeStage, buffer: { type: "uniform" } },
        { binding: 4, visibility: computeStage, buffer: { type: "read-only-storage" } },
        { binding: 5, visibility: computeStage, buffer: { type: "storage" } }
      ]
    });
    var pipelineLayout = device.createPipelineLayout({ label: "vf physics hard discs layout", bindGroupLayouts: [bindLayout] });
    function pipeline(entryPoint) {
      return device.createComputePipeline({
        label: "vf physics " + entryPoint,
        layout: pipelineLayout,
        compute: { module: shaderModule, entryPoint: entryPoint }
      });
    }
    var pipelines = {
      clear_cells: pipeline("clear_cells"),
      integrate: pipeline("integrate"),
      fill_cells: pipeline("fill_cells"),
      resolve_contacts: pipeline("resolve_contacts"),
      write_render_instances: pipeline("write_render_instances")
    };
    var bindGroup = device.createBindGroup({
      label: "vf physics hard discs bind group",
      layout: bindLayout,
      entries: [
        { binding: 0, resource: { buffer: particleBuffer } },
        { binding: 1, resource: { buffer: cellCountsBuffer } },
        { binding: 2, resource: { buffer: cellItemsBuffer } },
        { binding: 3, resource: { buffer: paramsBuffer } },
        { binding: 4, resource: { buffer: collisionMatrixBuffer } },
        { binding: 5, resource: { buffer: renderInstanceBuffer } }
      ]
    });
    var baseOptions = Object.assign({}, options, {
      particleCount: particleCount,
      worldWidth: worldWidth,
      worldHeight: worldHeight,
      cellSize: cellSize,
      gridCols: gridCols,
      gridRows: gridRows,
      maxParticlesPerCell: maxParticlesPerCell
    });
    function dispatch(pass, pipe, groups) {
      pass.setPipeline(pipe);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.max(1, groups));
    }
    function step(commandEncoder, dt) {
      var params = makeHardDiscParams(baseOptions, dt);
      device.queue.writeBuffer(paramsBuffer, 0, params.buffer, params.byteOffset, params.byteLength);
      var pass = commandEncoder.beginComputePass({ label: "vf physics hard discs step" });
      dispatch(pass, pipelines.integrate, ceilDiv(particleCount, workgroupSize));
      dispatch(pass, pipelines.clear_cells, ceilDiv(gridCellCount, workgroupSize));
      dispatch(pass, pipelines.fill_cells, ceilDiv(particleCount, workgroupSize));
      var iterations = Math.max(1, Number(baseOptions.solverIterations || 3) | 0);
      for (var i = 0; i < iterations; i += 1) {
        dispatch(pass, pipelines.resolve_contacts, ceilDiv(particleCount, workgroupSize));
      }
      dispatch(pass, pipelines.write_render_instances, ceilDiv(particleCount, workgroupSize));
      pass.end();
    }
    function destroy() {
      var buffers = [particleBuffer, renderInstanceBuffer, paramsBuffer, cellCountsBuffer, cellItemsBuffer, collisionMatrixBuffer];
      for (var i = 0; i < buffers.length; i += 1) {
        if (buffers[i] && typeof buffers[i].destroy === "function") {
          try { buffers[i].destroy(); } catch (_) {}
        }
      }
    }
    return {
      particleCount: particleCount,
      particleBuffer: particleBuffer,
      renderInstanceBuffer: renderInstanceBuffer,
      paramsBuffer: paramsBuffer,
      cellCountsBuffer: cellCountsBuffer,
      cellItemsBuffer: cellItemsBuffer,
      collisionMatrixBuffer: collisionMatrixBuffer,
      pipelines: pipelines,
      step: step,
      destroy: destroy
    };
  }

  return {
    createTransformRenderer: createTransformRenderer,
    createWebGpuTransformAdapter: createWebGpuTransformAdapter,
    createWebGlTransformAdapter: createWebGlTransformAdapter,
    createHardDiscPhysicsRuntime: createHardDiscPhysicsRuntime,
    normalizeHardDiscParticleData: normalizeParticleData
  };
});
