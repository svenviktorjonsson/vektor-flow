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

  function storageBufferLimitBytes(device, fallback) {
    var limits = device && device.limits ? device.limits : null;
    var raw = limits && Number(limits.maxStorageBufferBindingSize);
    if (raw > 0) {
      return raw;
    }
    return Math.max(4, Number(fallback || (128 * 1024 * 1024)) || (128 * 1024 * 1024));
  }

  function hardSphereGridInfo(options) {
    var worldWidth = Math.max(1.0e-6, Number(options.worldWidth || options.width || 1.0) || 1.0);
    var worldDepth = Math.max(1.0e-6, Number(options.worldDepth || options.depth || 1.0) || 1.0);
    var worldHeight = Math.max(1.0e-6, Number(options.worldHeight || options.height || 1.0) || 1.0);
    var maxParticlesPerCell = Math.max(8, Number(options.maxParticlesPerCell || 96) | 0);
    var requestedCellSize = Number(options.cellSize);
    var baseCellSize = Number(options.maxRadius || 0.0125) * 2.25;
    var cellSize = requestedCellSize > 0.0 ? requestedCellSize : baseCellSize;
    cellSize = Math.max(1.0e-5, cellSize);
    var maxCellItemsBytes = Math.max(
      4,
      Math.floor(Number(options.maxCellItemsBytes || storageBufferLimitBytes(options.device, 128 * 1024 * 1024)) || (128 * 1024 * 1024))
    );
    var autoSized = !(requestedCellSize > 0.0);
    var adjusted = false;
    var gridCols = 1;
    var gridRows = 1;
    var gridLayers = 1;
    var gridCellCount = 1;
    var cellItemsBytes = 4;
    for (var attempt = 0; attempt < 64; attempt += 1) {
      gridCols = Math.max(1, Math.ceil(worldWidth / cellSize));
      gridRows = Math.max(1, Math.ceil(worldDepth / cellSize));
      gridLayers = Math.max(1, Math.ceil(worldHeight / cellSize));
      gridCellCount = gridCols * gridRows * gridLayers;
      cellItemsBytes = gridCellCount * maxParticlesPerCell * 4;
      if (cellItemsBytes <= maxCellItemsBytes || !autoSized) {
        break;
      }
      adjusted = true;
      cellSize *= Math.max(1.05, Math.pow(cellItemsBytes / maxCellItemsBytes, 1.0 / 3.0) * 1.02);
    }
    return {
      cellSize: cellSize,
      requestedCellSize: requestedCellSize > 0.0 ? requestedCellSize : 0.0,
      autoSized: autoSized,
      adjusted: adjusted,
      gridCols: gridCols,
      gridRows: gridRows,
      gridLayers: gridLayers,
      gridCellCount: gridCellCount,
      maxParticlesPerCell: maxParticlesPerCell,
      cellItemsBytes: cellItemsBytes,
      maxCellItemsBytes: maxCellItemsBytes
    };
  }

  function normalizeParticleData(input, count) {
    if (input instanceof Float32Array) {
      return input;
    }
    if (Array.isArray(input) && input.length >= count * 8 && (typeof input[0] === "number" || typeof input[0] === "string")) {
      return new Float32Array(input.slice(0, count * 8));
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

  function normalizeSphereParticleData(input, count) {
    if (input instanceof Float32Array) {
      return input;
    }
    if (Array.isArray(input) && input.length >= count * 12 && (typeof input[0] === "number" || typeof input[0] === "string")) {
      return new Float32Array(input.slice(0, count * 12));
    }
    var out = new Float32Array(count * 12);
    var items = Array.isArray(input) ? input : [];
    for (var i = 0; i < count; i += 1) {
      var item = items[i] || {};
      var base = i * 12;
      var r = Number(item.radius == null ? item.r : item.radius) || 0.01;
      var density = Number(item.density == null ? 1.0 : item.density) || 1.0;
      var mass = Number(item.mass);
      if (!(mass > 0.0)) {
        mass = Math.max(1.0e-9, (4.0 / 3.0) * Math.PI * r * r * r * density);
      }
      out[base + 0] = Number(item.x) || 0.0;
      out[base + 1] = Number(item.y) || 0.0;
      out[base + 2] = Number(item.z) || 0.0;
      out[base + 3] = r;
      out[base + 4] = Number(item.vx) || 0.0;
      out[base + 5] = Number(item.vy) || 0.0;
      out[base + 6] = Number(item.vz) || 0.0;
      out[base + 7] = density;
      out[base + 8] = mass;
      out[base + 9] = 0.0;
      out[base + 10] = 0.0;
      out[base + 11] = 0.0;
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

  function makeHardSphereParams(options, dt) {
    var out = new Float32Array(16);
    out[0] = Number(options.worldWidth || options.width || 1.0) || 1.0;
    out[1] = Number(options.worldDepth || options.depth || 1.0) || 1.0;
    out[2] = Number(options.worldHeight || options.height || 1.0) || 1.0;
    out[3] = Number(options.restitution == null ? 1.0 : options.restitution) || 0.0;
    var gravity = Array.isArray(options.gravity) ? options.gravity : [0.0, 0.0, -9.81];
    out[4] = Number(gravity[0]) || 0.0;
    out[5] = Number(gravity[1]) || 0.0;
    out[6] = Number(gravity[2]) || 0.0;
    out[7] = Math.max(0.0, Number(dt) || 0.0);
    out[8] = Number(options.cellSize || 0.025) || 0.025;
    out[9] = Number(options.gridCols || 1) || 1;
    out[10] = Number(options.gridRows || 1) || 1;
    out[11] = Number(options.gridLayers || 1) || 1;
    out[12] = Number(options.maxParticlesPerCell || 96) || 96;
    out[13] = Number(options.contactBandRatio == null ? 0.04 : options.contactBandRatio) || 0.0;
    out[14] = Number(options.particleCount || 0) || 0.0;
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

  function createHardSpherePhysicsRuntime(options) {
    options = options || {};
    var device = options.device;
    if (!device) {
      throw new Error("createHardSpherePhysicsRuntime requires a WebGPU device");
    }
    var particleCount = Math.max(0, Number(options.particleCount || (options.particles && options.particles.length) || 0) | 0);
    var particles = normalizeSphereParticleData(options.initialParticles || options.particles || [], particleCount);
    particleCount = Math.max(particleCount, Math.floor(particles.length / 12));
    var workgroupSize = Math.max(1, Number(options.workgroupSize || 128) | 0);
    var worldWidth = Number(options.worldWidth || options.width || 1.0) || 1.0;
    var worldDepth = Number(options.worldDepth || options.depth || 1.0) || 1.0;
    var worldHeight = Number(options.worldHeight || options.height || 1.0) || 1.0;
    var gridInfo = hardSphereGridInfo(Object.assign({}, options, {
      device: device,
      worldWidth: worldWidth,
      worldDepth: worldDepth,
      worldHeight: worldHeight
    }));
    var cellSize = gridInfo.cellSize;
    var gridCols = gridInfo.gridCols;
    var gridRows = gridInfo.gridRows;
    var gridLayers = gridInfo.gridLayers;
    var maxParticlesPerCell = gridInfo.maxParticlesPerCell;
    var gridCellCount = gridInfo.gridCellCount;
    var storageUsage = gpuUsage("STORAGE", 128);
    var vertexUsage = gpuUsage("VERTEX", 32);
    var copyDstUsage = gpuUsage("COPY_DST", 8);
    var uniformUsage = gpuUsage("UNIFORM", 64);
    var particleBuffer = createBufferWithData(device, "vf physics sphere particles", storageUsage | copyDstUsage, particles);
    var cellCountsBuffer = createBufferWithData(device, "vf physics sphere cell counts", storageUsage | copyDstUsage, gridCellCount * 4);
    var cellItemsBuffer = createBufferWithData(device, "vf physics sphere cell items", storageUsage | copyDstUsage, gridCellCount * maxParticlesPerCell * 4);
    var paramsBuffer = createBufferWithData(device, "vf physics sphere params", uniformUsage | copyDstUsage, 16 * 4);
    var collisionMatrix = options.collisionMatrix instanceof Float32Array
      ? options.collisionMatrix
      : new Float32Array(options.collisionMatrix || [Number(options.restitution == null ? 1.0 : options.restitution), 0.0, 0.0, 1.0]);
    var collisionMatrixBuffer = createBufferWithData(device, "vf physics sphere collision matrix", storageUsage | copyDstUsage, collisionMatrix);
    var renderInstanceBuffer = createBufferWithData(device, "vf physics sphere render instances", storageUsage | vertexUsage | copyDstUsage, Math.max(1, particleCount * 8) * 4);
    var shaderModule = device.createShaderModule({ label: "vf physics hard spheres", code: String(options.wgsl || options.shader || "") });
    var computeStage = gpuStage("COMPUTE", 4);
    var bindLayout = device.createBindGroupLayout({
      label: "vf physics hard spheres bind layout",
      entries: [
        { binding: 0, visibility: computeStage, buffer: { type: "storage" } },
        { binding: 1, visibility: computeStage, buffer: { type: "storage" } },
        { binding: 2, visibility: computeStage, buffer: { type: "storage" } },
        { binding: 3, visibility: computeStage, buffer: { type: "uniform" } },
        { binding: 4, visibility: computeStage, buffer: { type: "read-only-storage" } },
        { binding: 5, visibility: computeStage, buffer: { type: "storage" } }
      ]
    });
    var pipelineLayout = device.createPipelineLayout({ label: "vf physics hard spheres layout", bindGroupLayouts: [bindLayout] });
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
      label: "vf physics hard spheres bind group",
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
      worldDepth: worldDepth,
      worldHeight: worldHeight,
      cellSize: cellSize,
      gridCols: gridCols,
      gridRows: gridRows,
      gridLayers: gridLayers,
      maxParticlesPerCell: maxParticlesPerCell
    });
    function dispatch(pass, pipe, groups) {
      pass.setPipeline(pipe);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.max(1, groups));
    }
    function step(commandEncoder, dt) {
      var params = makeHardSphereParams(baseOptions, dt);
      device.queue.writeBuffer(paramsBuffer, 0, params.buffer, params.byteOffset, params.byteLength);
      var pass = commandEncoder.beginComputePass({ label: "vf physics hard spheres step" });
      dispatch(pass, pipelines.integrate, ceilDiv(particleCount, workgroupSize));
      dispatch(pass, pipelines.clear_cells, ceilDiv(gridCellCount, workgroupSize));
      dispatch(pass, pipelines.fill_cells, ceilDiv(particleCount, workgroupSize));
      var iterations = Math.max(1, Number(baseOptions.solverIterations || 4) | 0);
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
      gridCellCount: gridCellCount,
      gridInfo: gridInfo,
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
    createHardSpherePhysicsRuntime: createHardSpherePhysicsRuntime,
    normalizeHardDiscParticleData: normalizeParticleData,
    normalizeHardSphereParticleData: normalizeSphereParticleData
  };
});
