(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.VfCompiledWebGpuAdapter = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var PLAN_SCHEMA = "vektor-flow/retained-scene-render-plan";
  var publicApi = null;
  var deviceAcquisitions = typeof WeakMap === "function" ? new WeakMap() : null;

  function startupMark(name, detail) {
    var globalObject = typeof globalThis !== "undefined" ? globalThis : null;
    var timeline = globalObject && globalObject.__vfStartupTimeline;
    if (!Array.isArray(timeline)) { return; }
    timeline.push({
      name: String(name),
      t: globalObject.performance && typeof globalObject.performance.now === "function"
        ? globalObject.performance.now()
        : Date.now(),
      detail: detail || null
    });
  }

  function renderPlan(artifacts) {
    var render = artifacts && artifacts.render;
    var manifest = render && render.manifest;
    var runtimeSurface = manifest && manifest.runtime_surface;
    var plan = runtimeSurface && runtimeSurface.render_plan;
    if (!render || render.kind !== "retained_scene_render" ||
        !plan || plan.schema !== PLAN_SCHEMA || Number(plan.version) !== 1) {
      throw new Error("compiled retained scene render_plan is missing or unsupported");
    }
    if (plan.execution_owner !== "wasm_wgsl") {
      throw new Error("compiled retained scene render_plan execution_owner must be wasm_wgsl");
    }
    if (!plan.arena || plan.arena.metadata_source !== "wasm_retained_scene_arena") {
      throw new Error("compiled retained scene render_plan must use the WASM arena");
    }
    if (!plan.vertex_layout || !Array.isArray(plan.vertex_layout.attributes) ||
        !Array.isArray(plan.targets) || !Array.isArray(plan.pipelines) ||
        !Array.isArray(plan.passes)) {
      throw new Error("compiled retained scene render_plan descriptors are incomplete");
    }
    return plan;
  }

  function targetFormat(spec, preferredFormat) {
    var format = String(spec.format || "");
    return format === "preferred_canvas_format"
      ? String(preferredFormat)
      : format;
  }

  function createTargets(device, plan, options) {
    var usage = options.gpuTextureUsage ||
      (typeof GPUTextureUsage !== "undefined" ? GPUTextureUsage : null);
    if (!usage) {
      throw new Error("compiled retained scene GPUTextureUsage is unavailable");
    }
    if (typeof device.createTexture !== "function") {
      throw new Error("compiled retained scene WebGPU texture factory is unavailable");
    }
    var canvas = options.canvas || null;
    var canvasWidth = Number(options.width || (canvas && canvas.width) || 1);
    var canvasHeight = Number(options.height || (canvas && canvas.height) || 1);
    var preferredFormat = String(options.format || "bgra8unorm");
    var targets = new Map();
    plan.targets.forEach(function (spec) {
      var id = String(spec.id || "");
      if (!id || targets.has(id)) {
        throw new Error("compiled retained scene target ids must be unique and non-empty");
      }
      var kind = String(spec.kind || "color");
      var format = targetFormat(spec, preferredFormat);
      var scale = spec.size_policy === "canvas_scale"
        ? Math.max(0.125, Math.min(1, Number(spec.scale || 1)))
        : 1;
      var width = spec.size_policy === "fixed"
        ? Number(spec.width)
        : Math.max(1, Math.round(canvasWidth * scale));
      var height = spec.size_policy === "fixed"
        ? Number(spec.height)
        : Math.max(1, Math.round(canvasHeight * scale));
      var layers = Number(spec.array_layers || 1);
      var sampleCount = Number(spec.sample_count || 1);
      var entry = {
        id: id,
        kind: kind,
        format: format,
        width: width,
        height: height,
        arrayLayers: layers,
        sampleCount: sampleCount,
        texture: null,
        view: null
      };
      if (kind !== "external_color") {
        var texture = device.createTexture({
          label: "vkf-compiled-target-" + id,
          size: { width: width, height: height, depthOrArrayLayers: layers },
          format: format,
          sampleCount: sampleCount,
          usage: usage.RENDER_ATTACHMENT | usage.TEXTURE_BINDING
        });
        entry.texture = texture;
        entry.view = texture.createView(layers > 1
          ? { dimension: "2d-array", arrayLayerCount: layers }
          : undefined);
      }
      targets.set(id, entry);
    });
    return targets;
  }

  function createResourceBuffers(device, plan, usage) {
    var resources = new Map();
    var specs = []
      .concat(Array.isArray(plan.derived_buffers) ? plan.derived_buffers : [])
      .concat(Array.isArray(plan.control_buffers) ? plan.control_buffers : []);
    var usageNames = {
      copy_dst: "COPY_DST",
      copy_src: "COPY_SRC",
      index: "INDEX",
      indirect: "INDIRECT",
      storage: "STORAGE",
      uniform: "UNIFORM",
      vertex: "VERTEX"
    };
    specs.forEach(function (spec) {
      var id = String(spec.id || "");
      var size = Number(spec.byte_size || 0);
      if (!id || resources.has(id) || !Number.isFinite(size) || size <= 0) {
        throw new Error("compiled retained scene buffer descriptors are malformed");
      }
      var flags = 0;
      (Array.isArray(spec.usage) ? spec.usage : []).forEach(function (name) {
        var enumName = usageNames[String(name)];
        if (!enumName || typeof usage[enumName] !== "number") {
          throw new Error("compiled retained scene buffer usage is unsupported: " + String(name));
        }
        flags |= usage[enumName];
      });
      if (!flags) {
        throw new Error("compiled retained scene buffer usage is empty: " + id);
      }
      resources.set(id, device.createBuffer({
        label: "vkf-compiled-buffer-" + id,
        size: size,
        usage: flags
      }));
    });
    return resources;
  }

  function createSamplers(device, plan) {
    var samplers = new Map();
    (Array.isArray(plan.samplers) ? plan.samplers : []).forEach(function (spec) {
      var id = String(spec.id || "");
      if (!id || samplers.has(id)) {
        throw new Error("compiled retained scene sampler ids must be unique and non-empty");
      }
      samplers.set(id, device.createSampler({
        label: "vkf-compiled-sampler-" + id,
        compare: spec.kind === "comparison" ? String(spec.compare) : undefined,
        magFilter: String(spec.mag_filter || "nearest"),
        minFilter: String(spec.min_filter || "nearest"),
        mipmapFilter: String(spec.mipmap_filter || "nearest"),
        addressModeU: String(spec.address_mode_u || "clamp-to-edge"),
        addressModeV: String(spec.address_mode_v || "clamp-to-edge"),
        addressModeW: String(spec.address_mode_w || "clamp-to-edge")
      }));
    });
    return samplers;
  }

  function createParameterBuffers(device, parameters, usage) {
    var buffers = new Map();
    var sections = parameters.descriptor.sections;
    if (!Array.isArray(sections) || !sections.length) {
      throw new Error("compiled retained scene parameter sections are unavailable");
    }
    sections.forEach(function (section) {
      var name = String(section.name || "");
      var offset = Number(section.byte_offset || 0);
      var length = Number(section.byte_length || 0);
      if (!name || buffers.has(name) || offset < 0 || length <= 0 ||
          offset + length > parameters.bytes.byteLength) {
        throw new Error("compiled retained scene parameter section is malformed: " + name);
      }
      var buffer = device.createBuffer({
        label: "vkf-compiled-parameter-" + name,
        size: length + ((4 - (length % 4)) % 4),
        usage: usage.COPY_DST | usage.STORAGE
      });
      var bytes = parameters.bytes.subarray(offset, offset + length);
      device.queue.writeBuffer(buffer, 0, bytes);
      buffers.set(name, {
        buffer: buffer,
        bytes: bytes,
        byteLength: length,
        descriptor: section
      });
    });
    return buffers;
  }

  function uploadDeclaredControlRecords(device, plan, buffers) {
    (Array.isArray(plan.control_buffers) ? plan.control_buffers : []).forEach(function (spec) {
      if (!Array.isArray(spec.records) || !spec.records.length) { return; }
      var target = buffers.get(String(spec.id || ""));
      if (!target) {
        throw new Error("compiled retained scene control buffer is missing");
      }
      var raw = new ArrayBuffer(Number(spec.byte_size));
      var view = new DataView(raw);
      var fields = (Array.isArray(spec.fields) ? spec.fields : []).map(function (field) {
        var match = /^([^:]+):(u32|i32|f32)@(\d+)$/.exec(String(field));
        if (!match) {
          throw new Error("compiled retained scene control field is malformed: " + String(field));
        }
        return { name: match[1], type: match[2], offset: Number(match[3]) };
      });
      spec.records.forEach(function (record) {
        var base = Number(record.byte_offset || 0);
        var data = record.data || {};
        fields.forEach(function (field) {
          var value = Number(data[field.name] || 0);
          if (field.type === "u32") {
            view.setUint32(base + field.offset, value, true);
          } else if (field.type === "i32") {
            view.setInt32(base + field.offset, value, true);
          } else {
            view.setFloat32(base + field.offset, value, true);
          }
        });
      });
      device.queue.writeBuffer(target, 0, new Uint8Array(raw));
    });
  }

  function vertexLayout(plan) {
    return {
      arrayStride: Number(plan.vertex_layout.array_stride),
      stepMode: String(plan.vertex_layout.step_mode || "vertex"),
      attributes: plan.vertex_layout.attributes.map(function (attribute) {
        return {
          shaderLocation: Number(attribute.shader_location),
          offset: Number(attribute.offset),
          format: String(attribute.format)
        };
      })
    };
  }

  function pipelineDescriptor(module, format, depthFormat, layout, spec) {
    var colorFormat = String(spec.color_format || spec.format || format);
    var pipelineDepthFormat = String(spec.depth_format || depthFormat || "");
    if (colorFormat === "preferred_canvas_format") {
      colorFormat = String(format);
    }
    var descriptor = {
      label: "vkf-compiled-" + String(spec.id || "pipeline"),
      layout: "auto",
      vertex: {
        module: module,
        entryPoint: String(spec.vertex_entry || ""),
        buffers: spec.vertex_buffers === false ? [] : [layout]
      },
      primitive: {
        topology: String(spec.topology || "triangle-list"),
        cullMode: String(spec.cull_mode || "back")
      },
      multisample: { count: Number(spec.sample_count || 1) }
    };
    if (spec.fragment_entry) {
      descriptor.fragment = {
        module: module,
        entryPoint: String(spec.fragment_entry),
        targets: [{ format: colorFormat }]
      };
      if (spec.blend === "additive") {
        descriptor.fragment.targets[0].blend = {
          color: { srcFactor: "one", dstFactor: "one", operation: "add" },
          alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" }
        };
      }
    }
    if (pipelineDepthFormat) {
      descriptor.depthStencil = {
        format: pipelineDepthFormat,
        depthWriteEnabled: spec.depth_write === true,
        depthCompare: String(spec.depth_compare || "less"),
        depthBias: Number(spec.depth_bias || 0),
        depthBiasClamp: Number(spec.depth_bias_clamp || 0),
        depthBiasSlopeScale: Number(spec.depth_bias_slope_scale || 0)
      };
    }
    return descriptor;
  }

  function prepare(options) {
    options = options || {};
    var artifacts = options.artifacts || {};
    var plan;
    try {
      plan = renderPlan(artifacts);
    } catch (error) {
      return Promise.reject(error);
    }
    startupMark("compiled-gpu:prepare:start", {
      pipelines: plan.pipelines.length,
      passes: plan.passes.length
    });
    var arena = artifacts.arena;
    if (!arena || !(arena.bytes instanceof Uint8Array)) {
      return Promise.reject(new Error("compiled retained scene WASM arena is unavailable"));
    }
    var parameters = artifacts.parameters;
    if (!parameters || !(parameters.bytes instanceof Uint8Array) ||
        !parameters.descriptor ||
        parameters.descriptor.schema !== "vektor-flow/render-parameter-arena" ||
        Number(parameters.descriptor.version) !== 1) {
      return Promise.reject(new Error("compiled retained scene render parameter arena is unavailable"));
    }
    var device = options.device;
    if (!device || !device.queue || typeof device.createBuffer !== "function" ||
        typeof device.createShaderModule !== "function") {
      return Promise.reject(new Error("compiled retained scene WebGPU device is unavailable"));
    }
    var usage = options.gpuBufferUsage ||
      (typeof GPUBufferUsage !== "undefined" ? GPUBufferUsage : null);
    if (!usage) {
      return Promise.reject(new Error("compiled retained scene GPUBufferUsage is unavailable"));
    }
    var byteLength = arena.bytes.byteLength;
    var alignedSize = byteLength > 0
      ? byteLength + ((4 - (byteLength % 4)) % 4)
      : 4;
    var arenaBuffer = device.createBuffer({
      label: "vkf-compiled-wasm-scene-arena",
      size: alignedSize,
      usage: usage.COPY_DST | usage.VERTEX | usage.INDEX | usage.STORAGE
    });
    if (byteLength > 0) {
      device.queue.writeBuffer(arenaBuffer, 0, arena.bytes);
    }
    startupMark("compiled-gpu:arena-uploaded", { bytes: byteLength });
    var parameterBuffers;
    try {
      parameterBuffers = createParameterBuffers(device, parameters, usage);
    } catch (error) {
      return Promise.reject(error);
    }
    var resourceBuffers;
    try {
      resourceBuffers = createResourceBuffers(device, plan, usage);
    } catch (error) {
      return Promise.reject(error);
    }
    if (resourceBuffers.has("platform_viewport")) {
      device.queue.writeBuffer(
        resourceBuffers.get("platform_viewport"),
        0,
        new Float32Array([
          Number(options.width || 1),
          Number(options.height || 1)
        ])
      );
    }
    try {
      uploadDeclaredControlRecords(device, plan, resourceBuffers);
    } catch (error) {
      return Promise.reject(error);
    }
    var targets;
    try {
      targets = createTargets(device, plan, options);
    } catch (error) {
      return Promise.reject(error);
    }
    var shaderModule = device.createShaderModule({
      label: "vkf-compiled-retained-scene-wgsl",
      code: String(artifacts.render.wgsl || "")
    });
    startupMark("compiled-gpu:shader-module-created", {
      bytes: String(artifacts.render.wgsl || "").length
    });
    var layout = vertexLayout(plan);
    var samplers;
    try {
      samplers = createSamplers(device, plan);
    } catch (error) {
      return Promise.reject(error);
    }
    var pipelines = new Map();
    startupMark("compiled-gpu:pipelines:start", { count: plan.pipelines.length });
    var pending = plan.pipelines.map(function (spec) {
      var pipelineStartedAt = typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now();
      function recordReady() {
        var readyAt = typeof performance !== "undefined" && performance.now
          ? performance.now()
          : Date.now();
        startupMark("compiled-gpu:pipeline:ready", {
          id: String(spec.id || ""),
          duration_ms: readyAt - pipelineStartedAt
        });
      }
      if (spec.compute_entry) {
        var computeDescriptor = {
          label: "vkf-compiled-" + String(spec.id || "compute"),
          layout: "auto",
          compute: {
            module: shaderModule,
            entryPoint: String(spec.compute_entry)
          }
        };
        var computeCreated = typeof device.createComputePipelineAsync === "function"
          ? device.createComputePipelineAsync(computeDescriptor)
          : Promise.resolve(device.createComputePipeline(computeDescriptor));
        return computeCreated.then(function (pipeline) {
          recordReady();
          pipelines.set(String(spec.id || ""), pipeline);
        });
      }
      var descriptor = pipelineDescriptor(
        shaderModule,
        options.format || "bgra8unorm",
        options.depthFormat || "",
        layout,
        spec
      );
      var created = typeof device.createRenderPipelineAsync === "function"
        ? device.createRenderPipelineAsync(descriptor)
        : Promise.resolve(device.createRenderPipeline(descriptor));
      return created.then(function (pipeline) {
        recordReady();
        pipelines.set(String(spec.id || ""), pipeline);
      });
    });
    return Promise.all(pending).then(function () {
      startupMark("compiled-gpu:pipelines:ready", { count: pipelines.size });
      return {
        device: device,
        plan: plan,
        arenaBytes: arena.bytes,
        arenaBuffer: arenaBuffer,
        parameterBytes: parameters.bytes,
        parameterDescriptor: parameters.descriptor,
        parameterBuffers: parameterBuffers,
        resourceBuffers: resourceBuffers,
        shaderModule: shaderModule,
        format: String(options.format || "bgra8unorm"),
        gpuBufferUsage: options.gpuBufferUsage ||
          (typeof GPUBufferUsage !== "undefined" ? GPUBufferUsage : null),
        gpuMapMode: options.gpuMapMode ||
          (typeof GPUMapMode !== "undefined" ? GPUMapMode : null),
        targets: targets,
        samplers: samplers,
        pipelines: pipelines,
        passes: plan.passes
      };
    });
  }

  function drawList(prepared, id) {
    var lists = prepared.parameterDescriptor && prepared.parameterDescriptor.draw_lists;
    for (var i = 0; Array.isArray(lists) && i < lists.length; i += 1) {
      if (String(lists[i].id || "") === String(id || "")) { return lists[i]; }
    }
    throw new Error("compiled retained scene draw list is unavailable: " + String(id || ""));
  }

  function targetView(prepared, id, arrayLayer, externalViews) {
    id = String(id || "");
    var target = prepared.targets.get(id);
    if (!target) {
      throw new Error("compiled retained scene target is unavailable: " + id);
    }
    if (target.kind === "external_color") {
      if (!externalViews.has(id)) {
        var texture = prepared.context.getCurrentTexture();
        externalViews.set(id, {
          texture: texture,
          view: texture.createView()
        });
      }
      return externalViews.get(id).view;
    }
    if (arrayLayer != null && target.arrayLayers > 1) {
      return target.texture.createView({
        dimension: "2d",
        baseArrayLayer: Number(arrayLayer),
        arrayLayerCount: 1
      });
    }
    return target.view;
  }

  function selectBoundTextureTarget(pass, draw) {
    var sources = pass && pass.reflection_sources;
    for (var i = 0; Array.isArray(sources) && i < sources.length; i += 1) {
      if (Number(sources[i].object_index) === Number(draw && draw.object_index)) {
        return String(sources[i].target || "");
      }
    }
    return "transparent_reflection_fallback";
  }

  function resolveBindingResource(prepared, pass, draw, entry, externalViews) {
    var source = String(entry.source || "");
    var type = String(entry.resource_type || "");
    if (source === "pass.reflection_sources_by_object") {
      source = selectBoundTextureTarget(pass, draw);
    } else if (source === "pass.reflection_source") {
      source = String(pass.reflection_source || "transparent_reflection_fallback");
    }
    if (source.indexOf("render_parameter_arena.") === 0) {
      var sectionName = source.slice("render_parameter_arena.".length);
      var section = prepared.parameterBuffers.get(sectionName);
      if (!section) { throw new Error("compiled retained scene parameter binding is unavailable: " + source); }
      return { buffer: section.buffer, offset: 0, size: section.byteLength };
    }
    if (source === "retained_scene_arena") {
      return { buffer: prepared.arenaBuffer, offset: 0, size: prepared.arenaBytes.byteLength };
    }
    if (prepared.resourceBuffers.has(source)) {
      var offset = Number(entry.offset || 0);
      var size = Number(entry.size || 0);
      if (pass.object_binding && draw &&
          Number(pass.object_binding.binding) === Number(entry.binding) &&
          String(pass.object_binding.source) === source) {
        var offsetKey = String(pass.object_binding.byte_offset_source || "").replace(/^draw\./, "");
        var lengthKey = String(pass.object_binding.byte_length_source || "").replace(/^draw\./, "");
        offset = Number(draw[offsetKey]);
        size = Number(draw[lengthKey]);
      }
      return { buffer: prepared.resourceBuffers.get(source), offset: offset, size: size };
    }
    if (prepared.samplers.has(source)) { return prepared.samplers.get(source); }
    if (type === "depth_texture_array") {
      var arrayTarget = prepared.targets.get(source);
      if (!arrayTarget || !arrayTarget.texture) {
        throw new Error(
          "compiled retained scene array texture is unavailable: " + source
        );
      }
      if (!arrayTarget.arrayView) {
        arrayTarget.arrayView = arrayTarget.texture.createView({
          dimension: "2d-array",
          baseArrayLayer: 0,
          arrayLayerCount: Number(arrayTarget.arrayLayers || 1)
        });
      }
      return arrayTarget.arrayView;
    }
    if (type.indexOf("texture") >= 0) {
      return targetView(prepared, source, null, externalViews);
    }
    throw new Error("compiled retained scene binding resource is unavailable: " + source);
  }

  function bindDeclaredGroups(prepared, encoderPass, pipeline, pass, draw, externalViews, cacheKey) {
    if (!prepared.bindGroupCache) { prepared.bindGroupCache = new Map(); }
    (Array.isArray(pass.bind_groups) ? pass.bind_groups : []).forEach(function (groupSpec) {
      var group = Number(groupSpec.group);
      var groupCacheKey = String(cacheKey || "") + ":" + String(group);
      var cached = prepared.bindGroupCache.get(groupCacheKey);
      if (cached) {
        encoderPass.setBindGroup(group, cached);
        return;
      }
      var entries = groupSpec.entries.map(function (entry) {
        return {
          binding: Number(entry.binding),
          resource: resolveBindingResource(prepared, pass, draw, entry, externalViews)
        };
      });
      var bindGroup = prepared.device.createBindGroup({
        label: "vkf-compiled-pass-group-" + String(group),
        layout: pipeline.getBindGroupLayout(group),
        entries: entries
      });
      prepared.bindGroupCache.set(groupCacheKey, bindGroup);
      encoderPass.setBindGroup(group, bindGroup);
    });
  }

  function renderPassDescriptor(prepared, pass, externalViews) {
    var descriptor = { label: "vkf-compiled-pass-" + String(pass.kind || "render") };
    descriptor.colorAttachments = [];
    if (pass.color) {
      descriptor.colorAttachments.push({
        view: targetView(prepared, pass.color.target, null, externalViews),
        resolveTarget: pass.color.resolve_target
          ? targetView(prepared, pass.color.resolve_target, null, externalViews)
          : undefined,
        loadOp: String(pass.color.load_op),
        storeOp: String(pass.color.store_op),
        clearValue: pass.color.clear_value
      });
    }
    if (pass.depth) {
      var depthReadOnly = pass.depth.read_only === true;
      descriptor.depthStencilAttachment = {
        view: targetView(
          prepared,
          pass.depth.target,
          Number(pass.depth.array_layer || 0),
          externalViews
        ),
        depthReadOnly: depthReadOnly
      };
      if (!depthReadOnly) {
        descriptor.depthStencilAttachment.depthLoadOp =
          String(pass.depth.load_op);
        descriptor.depthStencilAttachment.depthStoreOp =
          String(pass.depth.store_op);
        descriptor.depthStencilAttachment.depthClearValue =
          Number(pass.depth.clear_value);
      }
    }
    return descriptor;
  }

  function sameAttachment(left, right, field) {
    if (!left && !right) { return true; }
    if (!left || !right) { return false; }
    return String(left[field] == null ? "" : left[field]) ===
      String(right[field] == null ? "" : right[field]);
  }

  function canFuseRenderPass(base, next) {
    if (!base || !next || base.dispatch || next.dispatch) { return false; }
    if (!sameAttachment(base.color, next.color, "target") ||
        !sameAttachment(base.color, next.color, "resolve_target") ||
        !sameAttachment(base.depth, next.depth, "target") ||
        !sameAttachment(base.depth, next.depth, "array_layer")) {
      return false;
    }
    if (next.color && String(next.color.load_op || "") !== "load") { return false; }
    if (next.depth && String(next.depth.load_op || "") !== "load") { return false; }
    return !(base.depth && base.depth.read_only === true &&
      next.depth && next.depth.read_only !== true);
  }

  function encodeRenderPass(prepared, render, pass, passIndex, pipeline, externalViews) {
    render.setPipeline(pipeline);
    var targetId = pass.color && pass.color.target || pass.depth && pass.depth.target;
    var target = prepared.targets.get(String(targetId || ""));
    if (pass.viewport && pass.viewport.policy === "target" && target &&
        typeof render.setViewport === "function") {
      render.setViewport(0, 0, target.width, target.height, 0, 1);
    }
    if (pass.vertex_count != null) {
      bindDeclaredGroups(
        prepared, render, pipeline, pass, null, externalViews,
        "pass:" + String(passIndex) + ":direct"
      );
      render.draw(
        Number(pass.vertex_count),
        Number(pass.instance_count == null ? 1 : pass.instance_count),
        0,
        0
      );
      return;
    }
    var list = drawList(prepared, pass.draw_list_id);
    var excludedObjectIndices = new Set(
      Array.isArray(pass.excluded_object_indices)
        ? pass.excluded_object_indices.map(Number)
        : []
    );
    list.entries.forEach(function (draw, drawIndex) {
      if (excludedObjectIndices.has(Number(draw.object_index))) { return; }
      bindDeclaredGroups(
        prepared, render, pipeline, pass, draw, externalViews,
        "pass:" + String(passIndex) + ":draw:" + String(drawIndex)
      );
      render.setVertexBuffer(
        0,
        prepared.arenaBuffer,
        Number(draw.vertices.byte_offset),
        Number(draw.vertices.length) * 4
      );
      render.setIndexBuffer(
        prepared.arenaBuffer,
        String(draw.index_format || "uint32"),
        Number(draw.indices.byte_offset),
        Number(draw.indices.length) * 4
      );
      render.drawIndexed(Number(draw.indices.length), 1, 0, 0, 0);
    });
  }

  function flushChangedParameterSections(prepared, requestedSections) {
    if (requestedSections == null) { return []; }
    if (!Array.isArray(requestedSections)) {
      throw new Error("compiled retained scene changed parameter sections must be an array");
    }
    var changed = [];
    var seen = Object.create(null);
    for (var index = 0; index < requestedSections.length; index += 1) {
      var name = String(requestedSections[index] || "").trim();
      if (!name || seen[name]) { continue; }
      var section = prepared.parameterBuffers && prepared.parameterBuffers.get(name);
      if (!section || !section.buffer || !(section.bytes instanceof Uint8Array)) {
        throw new Error("compiled retained scene parameter section is unavailable: " + name);
      }
      prepared.device.queue.writeBuffer(section.buffer, 0, section.bytes);
      seen[name] = true;
      changed.push(name);
    }
    return changed;
  }

  function mayReuseStaticShadows(options, changedSections) {
    for (var index = 0; index < changedSections.length; index += 1) {
      if (changedSections[index] === "lights" || changedSections[index] === "objects") {
        return false;
      }
    }
    if (changedSections.length) {
      return changedSections.every(function (name) { return name === "camera"; });
    }
    return options.reuseStaticShadows === true;
  }

  function submitFrame(prepared, options) {
    options = options || {};
    var device = prepared && prepared.device;
    if (!device || typeof device.createCommandEncoder !== "function" ||
        !device.queue || typeof device.queue.submit !== "function") {
      throw new Error("compiled retained scene command submission is unavailable");
    }
    var changedParameterSections = flushChangedParameterSections(
      prepared,
      options.changedParameterSections
    );
    var reuseStaticShadows = mayReuseStaticShadows(options, changedParameterSections);
    var command = device.createCommandEncoder({ label: "vkf-compiled-frame" });
    var externalViews = new Map();
    if (!prepared.initialTargetsReady) {
      prepared.plan.targets.forEach(function (spec) {
        if (!Array.isArray(spec.initial_clear_value)) { return; }
        var clear = command.beginRenderPass({
          label: "vkf-compiled-initialize-" + String(spec.id),
          colorAttachments: [{
            view: targetView(prepared, spec.id, null, externalViews),
            loadOp: "clear",
            storeOp: "store",
            clearValue: spec.initial_clear_value
          }]
        });
        clear.end();
      });
      prepared.initialTargetsReady = true;
    }
    var executablePasses = [];
    prepared.plan.passes.forEach(function (pass, passIndex) {
      if (reuseStaticShadows && prepared.shadowMapsInitialized &&
          String(pass.kind || "") === "shadow_depth") {
        return;
      }
      executablePasses.push({ pass: pass, passIndex: passIndex });
    });
    for (var executableIndex = 0; executableIndex < executablePasses.length; executableIndex += 1) {
      var entry = executablePasses[executableIndex];
      var pass = entry.pass;
      var passIndex = entry.passIndex;
      var pipeline = prepared.pipelines.get(String(pass.pipeline || ""));
      if (!pipeline) {
        throw new Error("compiled retained scene pipeline is unavailable: " + String(pass.pipeline || ""));
      }
      if (pass.dispatch) {
        var compute = command.beginComputePass({
          label: "vkf-compiled-pass-" + String(pass.kind || "compute")
        });
        compute.setPipeline(pipeline);
        bindDeclaredGroups(
          prepared, compute, pipeline, pass, null, externalViews,
          "pass:" + String(passIndex) + ":compute"
        );
        compute.dispatchWorkgroups(
          Number(pass.dispatch.x),
          Number(pass.dispatch.y),
          Number(pass.dispatch.z)
        );
        compute.end();
        continue;
      }
      var render = command.beginRenderPass(renderPassDescriptor(prepared, pass, externalViews));
      var renderPassBase = pass;
      encodeRenderPass(prepared, render, pass, passIndex, pipeline, externalViews);
      while (executableIndex + 1 < executablePasses.length &&
          canFuseRenderPass(renderPassBase, executablePasses[executableIndex + 1].pass)) {
        executableIndex += 1;
        entry = executablePasses[executableIndex];
        pass = entry.pass;
        passIndex = entry.passIndex;
        pipeline = prepared.pipelines.get(String(pass.pipeline || ""));
        if (!pipeline) {
          throw new Error("compiled retained scene pipeline is unavailable: " + String(pass.pipeline || ""));
        }
        encodeRenderPass(prepared, render, pass, passIndex, pipeline, externalViews);
      }
      render.end();
    }
    if (options.capture) {
      var capture = options.capture;
      var captureTargetId = String(capture.target || "");
      if (!captureTargetId) {
        for (var targetIndex = 0;
             targetIndex < prepared.plan.targets.length; targetIndex += 1) {
          if (String(prepared.plan.targets[targetIndex].kind || "") ===
              "external_color") {
            captureTargetId = String(prepared.plan.targets[targetIndex].id || "");
            break;
          }
        }
      }
      if (!captureTargetId || !capture.buffer ||
          typeof command.copyTextureToBuffer !== "function") {
        throw new Error("compiled Frame.capture readback is unavailable");
      }
      targetView(prepared, captureTargetId, null, externalViews);
      var capturedExternal = externalViews.get(captureTargetId);
      if (!capturedExternal || !capturedExternal.texture) {
        throw new Error("compiled Frame.capture target is unavailable");
      }
      command.copyTextureToBuffer(
        { texture: capturedExternal.texture },
        {
          buffer: capture.buffer,
          bytesPerRow: Number(capture.bytesPerRow),
          rowsPerImage: Number(capture.height)
        },
        {
          width: Number(capture.width),
          height: Number(capture.height),
          depthOrArrayLayers: 1
        }
      );
    }
    var buffer = command.finish();
    device.queue.submit([buffer]);
    prepared.shadowMapsInitialized = true;
    return buffer;
  }

  function materializeCapturedRgba(bytes, width, height, bytesPerRow, format) {
    var image = new Int32Array(width * height * 4);
    var bgra = String(format || "").toLowerCase().indexOf("bgra") === 0;
    for (var y = 0; y < height; y += 1) {
      var row = y * bytesPerRow;
      for (var x = 0; x < width; x += 1) {
        var source = row + x * 4;
        var target = (y * width + x) * 4;
        image[target] = Number(bytes[source + (bgra ? 2 : 0)]) & 255;
        image[target + 1] = Number(bytes[source + 1]) & 255;
        image[target + 2] = Number(bytes[source + (bgra ? 0 : 2)]) & 255;
        image[target + 3] = Number(bytes[source + 3]) & 255;
      }
    }
    Object.defineProperty(image, "shape", {
      value: Object.freeze([height, width, 4]),
      enumerable: true
    });
    Object.defineProperty(image, "dtype", {
      value: "int",
      enumerable: true
    });
    return image;
  }

  function captureFrame(prepared) {
    var device = prepared && prepared.device;
    var canvas = prepared && prepared.canvas;
    var usage = prepared && prepared.gpuBufferUsage;
    var mapMode = prepared && prepared.gpuMapMode;
    var width = Number(canvas && canvas.width || 0);
    var height = Number(canvas && canvas.height || 0);
    if (!device || typeof device.createBuffer !== "function" ||
        !device.queue || typeof device.queue.onSubmittedWorkDone !== "function" ||
        !usage || !mapMode || !Number.isSafeInteger(width) || width <= 0 ||
        !Number.isSafeInteger(height) || height <= 0) {
      return Promise.reject(new Error(
        "compiled Frame.capture readback dependencies are unavailable"));
    }
    var unalignedBytesPerRow = width * 4;
    var bytesPerRow = Math.ceil(unalignedBytesPerRow / 256) * 256;
    var readback = device.createBuffer({
      label: "vkf-compiled-frame-capture-readback",
      size: bytesPerRow * height,
      usage: usage.COPY_DST | usage.MAP_READ
    });
    try {
      publicApi.submitFrame(prepared, {
        reuseStaticShadows: true,
        capture: {
          buffer: readback,
          bytesPerRow: bytesPerRow,
          width: width,
          height: height
        }
      });
    } catch (error) {
      if (readback && typeof readback.destroy === "function") {
        readback.destroy();
      }
      return Promise.reject(error);
    }
    return Promise.resolve(device.queue.onSubmittedWorkDone()).then(function () {
      return readback.mapAsync(mapMode.READ);
    }).then(function () {
      var bytes = new Uint8Array(readback.getMappedRange());
      return materializeCapturedRgba(
        bytes, width, height, bytesPerRow, prepared.format);
    }).finally(function () {
      if (readback && typeof readback.unmap === "function") { readback.unmap(); }
      if (readback && typeof readback.destroy === "function") { readback.destroy(); }
    });
  }

  function attachCameraControls(options) {
    options = options || {};
    var prepared = options.prepared;
    var canvas = options.canvas;
    var section = prepared && prepared.parameterBuffers && prepared.parameterBuffers.get("camera");
    if (!canvas || typeof canvas.addEventListener !== "function" || !section ||
        !section.bytes || !section.descriptor) {
      return null;
    }
    var camera = options.config && options.config.scene_ir && options.config.scene_ir.camera;
    var properties = camera && camera.properties || {};
    if (!camera || properties.controls_enabled === false ||
        String(properties.controls_mode || "orbit").toLowerCase() === "none") {
      return null;
    }
    var wasm = options.artifacts && options.artifacts.wasm;
    if (!wasm || typeof wasm.cameraControl !== "function") {
      throw new Error("compiled camera control export is unavailable");
    }
    var keys = { ArrowLeft: false, ArrowRight: false, ArrowUp: false, ArrowDown: false };
    var frameHandle = 0;
    var lastFrameTime = 0;
    var cameraFrameInFlight = false;
    var heldSubmissionPending = false;
    var disposed = false;
    var eventTarget = options.eventTarget || (typeof globalThis !== "undefined" ? globalThis : null);
    var requestFrame = options.requestAnimationFrame ||
      (eventTarget && typeof eventTarget.requestAnimationFrame === "function"
        ? eventTarget.requestAnimationFrame.bind(eventTarget)
        : function (callback) { return setTimeout(function () { callback(Date.now()); }, 16); });
    var cancelFrame = options.cancelAnimationFrame ||
      (eventTarget && typeof eventTarget.cancelAnimationFrame === "function"
        ? eventTarget.cancelAnimationFrame.bind(eventTarget)
        : clearTimeout);
    function releaseCameraFrame() {
      cameraFrameInFlight = false;
      if (heldSubmissionPending) {
        heldSubmissionPending = false;
        if (!disposed && anyKeyHeld()) { applyHeldKeys(); }
      }
    }

    function rejectCameraFrame() {
      cameraFrameInFlight = false;
      clearHeldKeys();
    }

    function trackCameraFrame() {
      var queue = prepared.device && prepared.device.queue;
      if (queue && typeof queue.onSubmittedWorkDone === "function") {
        cameraFrameInFlight = true;
        var completion;
        try {
          completion = queue.onSubmittedWorkDone();
        } catch (_) {
          rejectCameraFrame();
          return;
        }
        Promise.resolve(completion).then(
          releaseCameraFrame,
          rejectCameraFrame
        );
      }
    }

    function flushCamera() {
      prepared.device.queue.writeBuffer(section.buffer, 0, section.bytes);
      publicApi.submitFrame(prepared, { reuseStaticShadows: true });
      trackCameraFrame();
    }

    function submitCamera(horizontal, vertical, zoom) {
      if (disposed || cameraFrameInFlight) { return false; }
      wasm.cameraControl(horizontal, vertical, zoom);
      flushCamera();
      return true;
    }

    function applyHeldKeys() {
      var horizontal = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
      var vertical = (keys.ArrowUp ? 1 : 0) - (keys.ArrowDown ? 1 : 0);
      if (horizontal || vertical) {
        return submitCamera(horizontal, vertical, 0);
      }
      return false;
    }

    function anyKeyHeld() {
      return keys.ArrowLeft || keys.ArrowRight || keys.ArrowUp || keys.ArrowDown;
    }

    function clearHeldKeys() {
      keys.ArrowLeft = false;
      keys.ArrowRight = false;
      keys.ArrowUp = false;
      keys.ArrowDown = false;
      heldSubmissionPending = false;
      lastFrameTime = 0;
      if (frameHandle) { cancelFrame(frameHandle); frameHandle = 0; }
    }

    function heldFrame(timestamp) {
      frameHandle = 0;
      if (disposed || !anyKeyHeld()) { lastFrameTime = 0; return; }
      var now = Number(timestamp || 0) || Date.now();
      if (!applyHeldKeys() && cameraFrameInFlight) {
        heldSubmissionPending = true;
      }
      lastFrameTime = now;
      frameHandle = requestFrame(heldFrame);
    }

    function onWheel(event) {
      if (event && typeof event.preventDefault === "function") { event.preventDefault(); }
      var delta = Number(event && event.deltaY || 0);
      if (delta === 0) { return; }
      submitCamera(0, 0, delta > 0 ? 1 : -1);
    }

    function onKeyDown(event) {
      var key = String(event && event.key || "");
      if (!Object.prototype.hasOwnProperty.call(keys, key) || event && event.repeat === true) { return; }
      if (event && typeof event.preventDefault === "function") { event.preventDefault(); }
      if (keys[key]) { return; }
      keys[key] = true;
      if (!applyHeldKeys() && cameraFrameInFlight) {
        heldSubmissionPending = true;
      }
      if (!frameHandle) {
        lastFrameTime = 0;
        frameHandle = requestFrame(heldFrame);
      }
    }

    function onKeyUp(event) {
      var key = String(event && event.key || "");
      if (!Object.prototype.hasOwnProperty.call(keys, key)) { return; }
      if (event && typeof event.preventDefault === "function") { event.preventDefault(); }
      keys[key] = false;
      if (!anyKeyHeld()) {
        clearHeldKeys();
      }
    }

    function onBlur() {
      clearHeldKeys();
    }

    function focusCanvas() {
      if (typeof canvas.focus === "function") {
        try { canvas.focus({ preventScroll: true }); } catch (_) { canvas.focus(); }
      }
    }

    if (Number(canvas.tabIndex) < 0) { canvas.tabIndex = 0; }
    canvas.addEventListener("pointerenter", focusCanvas, { passive: true });
    canvas.addEventListener("pointerdown", focusCanvas, { passive: true });
    canvas.addEventListener("wheel", onWheel, { passive: false });
    if (eventTarget && typeof eventTarget.addEventListener === "function") {
      eventTarget.addEventListener("keydown", onKeyDown, true);
      eventTarget.addEventListener("keyup", onKeyUp, true);
      eventTarget.addEventListener("blur", onBlur, true);
    }
    var controller = {
      dispose: function () {
        disposed = true;
        clearHeldKeys();
        canvas.removeEventListener("pointerenter", focusCanvas, { passive: true });
        canvas.removeEventListener("pointerdown", focusCanvas, { passive: true });
        canvas.removeEventListener("wheel", onWheel, { passive: false });
        if (eventTarget && typeof eventTarget.removeEventListener === "function") {
          eventTarget.removeEventListener("keydown", onKeyDown, true);
          eventTarget.removeEventListener("keyup", onKeyUp, true);
          eventTarget.removeEventListener("blur", onBlur, true);
        }
      }
    };
    prepared.cameraControls = controller;
    return controller;
  }

  function offscreenCameraBenchmarkConfig() {
    var root = typeof globalThis !== "undefined" ? globalThis : null;
    var raw = root && root.__vfOffscreenCameraBenchmark;
    if (!raw || typeof raw !== "object") { return null; }
    var sampleCount = Math.max(1, Math.min(240, Math.floor(Number(raw.sampleCount) || 30)));
    var warmupCount = Math.max(0, Math.min(30, Math.floor(Number(raw.warmupCount) || 0)));
    return { sampleCount: sampleCount, warmupCount: warmupCount };
  }

  function nativeFrameMediaCaptureConfig() {
    var root = typeof globalThis !== "undefined" ? globalThis : null;
    var raw = root && root.__vfNativeFrameMediaCapture;
    if (!raw || typeof raw !== "object") { return null; }
    var states = Array.isArray(raw.states) ? raw.states.map(String) : [];
    if (states.length !== 2 || states[0] !== "camera-default" ||
        states[1] !== "camera-wheel-detail") {
      throw new Error("native frame media capture requires the two gallery camera states");
    }
    return { states: states };
  }

  function benchmarkNow() {
    return typeof performance !== "undefined" && performance &&
      typeof performance.now === "function" ? performance.now() : Date.now();
  }

  function benchmarkPercentile(samples, percentile) {
    if (!samples.length) { return 0; }
    var ordered = samples.slice().sort(function (left, right) { return left - right; });
    var index = Math.max(0, Math.ceil(percentile * ordered.length) - 1);
    return ordered[Math.min(index, ordered.length - 1)];
  }

  function postOffscreenCameraBenchmark(message) {
    var root = typeof globalThis !== "undefined" ? globalThis : null;
    var bridge = root && root.chrome && root.chrome.webview;
    if (bridge && typeof bridge.postMessage === "function") {
      bridge.postMessage(message);
    }
  }

  function capturedRgbaState(image, view) {
    var shape = image && image.shape;
    var height = Number(shape && shape[0] || 0);
    var width = Number(shape && shape[1] || 0);
    var expected = width * height * 4;
    if (!Number.isSafeInteger(width) || width <= 0 ||
        !Number.isSafeInteger(height) || height <= 0 ||
        !image || image.length !== expected) {
      throw new Error("native frame media capture dimensions are invalid");
    }
    var checksum = 0x811c9dc5;
    var chunks = [];
    var chunk = [];
    for (var offset = 0; offset < image.length; offset += 1) {
      var value = Number(image[offset]) & 255;
      checksum = Math.imul((checksum ^ value) >>> 0, 0x01000193) >>> 0;
      chunk.push(value);
      if (chunk.length === 32768 || offset + 1 === image.length) {
        chunks.push(String.fromCharCode.apply(null, chunk));
        chunk = [];
      }
    }
    return {
      view: view,
      width: width,
      height: height,
      rgba_base64: btoa(chunks.join("")),
      checksum: "fnv1a32:" + checksum.toString(16).padStart(8, "0")
    };
  }

  function runNativeFrameMediaCapture(prepared, options, config) {
    var wasm = options && options.artifacts && options.artifacts.wasm;
    var camera = prepared && prepared.parameterBuffers && prepared.parameterBuffers.get("camera");
    var queue = prepared && prepared.device && prepared.device.queue;
    if (!wasm || typeof wasm.cameraControl !== "function" || !camera || !camera.bytes ||
        !queue || typeof queue.writeBuffer !== "function" ||
        typeof queue.onSubmittedWorkDone !== "function") {
      return Promise.reject(new Error("native frame media capture dependencies are unavailable"));
    }
    var states = [];
    return Promise.resolve(publicApi.captureFrame(prepared)).then(function (image) {
      states.push(capturedRgbaState(image, config.states[0]));
      wasm.cameraControl(0, 0, -1);
      queue.writeBuffer(camera.buffer, 0, camera.bytes);
      publicApi.submitFrame(prepared, { reuseStaticShadows: true });
      return Promise.resolve(queue.onSubmittedWorkDone());
    }).then(function () {
      return publicApi.captureFrame(prepared);
    }).then(function (image) {
      states.push(capturedRgbaState(image, config.states[1]));
      return {
        type: "vf_native_frame_media_capture_v1",
        schema: "vektor-flow/native-frame-media-capture-v1",
        status: "ok",
        capture_api: "Frame.capture",
        boundary: "frame-internal",
        states: states
      };
    });
  }

  function capturedPixelEvidence(image) {
    var shape = image && image.shape;
    var height = Number(shape && shape[0] || 0);
    var width = Number(shape && shape[1] || 0);
    var expected = width * height * 4;
    if (!Number.isSafeInteger(width) || width <= 0 ||
        !Number.isSafeInteger(height) || height <= 0 ||
        !image || image.length !== expected) {
      throw new Error("compiled camera benchmark capture dimensions are invalid");
    }
    var channelMin = [255, 255, 255, 255];
    var channelMax = [0, 0, 0, 0];
    var background = [
      Number(image[0]) & 255,
      Number(image[1]) & 255,
      Number(image[2]) & 255,
      Number(image[3]) & 255
    ];
    var nonBackground = 0;
    var checksum = 0x811c9dc5;
    var tileColumns = Math.min(32, width);
    var tileRows = Math.min(18, height);
    var tilePixelCounts = new Array(tileColumns * tileRows).fill(0);
    var tileRgbSums = new Array(tileColumns * tileRows);
    for (var tile = 0; tile < tileRgbSums.length; tile += 1) {
      tileRgbSums[tile] = [0, 0, 0];
    }
    for (var offset = 0; offset < image.length; offset += 4) {
      var differs = false;
      var pixelIndex = offset / 4;
      var pixelX = pixelIndex % width;
      var pixelY = Math.floor(pixelIndex / width);
      var tileX = Math.min(tileColumns - 1,
        Math.floor(pixelX * tileColumns / width));
      var tileY = Math.min(tileRows - 1,
        Math.floor(pixelY * tileRows / height));
      var tileIndex = tileY * tileColumns + tileX;
      tilePixelCounts[tileIndex] += 1;
      for (var channel = 0; channel < 4; channel += 1) {
        var value = Number(image[offset + channel]) & 255;
        channelMin[channel] = Math.min(channelMin[channel], value);
        channelMax[channel] = Math.max(channelMax[channel], value);
        if (value !== background[channel]) { differs = true; }
        if (channel < 3) { tileRgbSums[tileIndex][channel] += value; }
        checksum = Math.imul((checksum ^ value) >>> 0, 0x01000193) >>> 0;
      }
      if (differs) { nonBackground += 1; }
    }
    return {
      width: width,
      height: height,
      channel_min: channelMin,
      channel_max: channelMax,
      background_rgba: background,
      non_background_pixel_count: nonBackground,
      checksum: "fnv1a32:" + checksum.toString(16).padStart(8, "0"),
      spatial_tiles: {
        columns: tileColumns,
        rows: tileRows,
        tiles: tileRgbSums.map(function (rgbSum, index) {
          return {
            pixel_count: tilePixelCounts[index],
            rgb_sum: rgbSum
          };
        })
      }
    };
  }

  function runOffscreenCameraBenchmark(prepared, options, config) {
    var wasm = options && options.artifacts && options.artifacts.wasm;
    var camera = prepared && prepared.parameterBuffers && prepared.parameterBuffers.get("camera");
    var queue = prepared && prepared.device && prepared.device.queue;
    if (!wasm || typeof wasm.cameraControl !== "function" || !camera || !camera.bytes ||
        !queue || typeof queue.writeBuffer !== "function" ||
        typeof queue.onSubmittedWorkDone !== "function") {
      return Promise.reject(new Error("compiled camera GPU benchmark dependencies are unavailable"));
    }
    var total = config.warmupCount + config.sampleCount;
    var samples = [];
    var captureEvidence = null;
    var sequence = Promise.resolve().then(function () {
      return publicApi.captureFrame(prepared);
    }).then(function (image) {
      captureEvidence = capturedPixelEvidence(image);
      if (captureEvidence.non_background_pixel_count === 0) {
        var error = new Error(
          "compiled camera benchmark capture is uniform or empty");
        error.captureEvidence = captureEvidence;
        throw error;
      }
    });
    for (var index = 0; index < total; index += 1) {
      (function (sampleIndex) {
        sequence = sequence.then(function () {
          var inputStarted = benchmarkNow();
          wasm.cameraControl(sampleIndex % 2 === 0 ? 1 : -1, 0, 0);
          queue.writeBuffer(camera.buffer, 0, camera.bytes);
          var submitStarted = benchmarkNow();
          publicApi.submitFrame(prepared, { reuseStaticShadows: true });
          var submitReturned = benchmarkNow();
          return Promise.resolve(queue.onSubmittedWorkDone()).then(function () {
            var queueDone = benchmarkNow();
            if (sampleIndex >= config.warmupCount) {
              samples.push({
                input_to_submit_ms: submitStarted - inputStarted,
                encode_submit_ms: submitReturned - submitStarted,
                submit_to_queue_done_ms: queueDone - submitStarted,
                input_to_queue_done_ms: queueDone - inputStarted
              });
            }
          });
        });
      })(index);
    }
    return sequence.then(function () {
      var inputToDone = samples.map(function (sample) { return sample.input_to_queue_done_ms; });
      var submitToDone = samples.map(function (sample) { return sample.submit_to_queue_done_ms; });
      return {
        type: "vf_offscreen_camera_benchmark_v1",
        schema: "vektor-flow/compiled-camera-gpu-benchmark-v1",
        status: "ok",
        resolution: {
          width: Number(prepared.canvas && prepared.canvas.width || 0),
          height: Number(prepared.canvas && prepared.canvas.height || 0)
        },
        sample_count: config.sampleCount,
        warmup_count: config.warmupCount,
        capture: captureEvidence,
        p50_input_to_queue_done_ms: benchmarkPercentile(inputToDone, 0.50),
        p95_input_to_queue_done_ms: benchmarkPercentile(inputToDone, 0.95),
        p50_submit_to_queue_done_ms: benchmarkPercentile(submitToDone, 0.50),
        p95_submit_to_queue_done_ms: benchmarkPercentile(submitToDone, 0.95),
        samples: samples
      };
    });
  }

  function mount(options) {
    options = options || {};
    var canvas = options.canvas;
    var platform = options.navigator ||
      (typeof navigator !== "undefined" ? navigator : null);
    var gpu = platform && platform.gpu;
    if (!canvas || typeof canvas.getContext !== "function") {
      return Promise.reject(new Error("compiled retained scene canvas is unavailable"));
    }
    if (!gpu || typeof gpu.requestAdapter !== "function") {
      return Promise.reject(new Error("compiled retained scene WebGPU platform is unavailable"));
    }
    var context = canvas.getContext("webgpu");
    if (!context || typeof context.configure !== "function") {
      return Promise.reject(new Error("compiled retained scene WebGPU canvas context is unavailable"));
    }
    return prime(options).then(function(device) {
      var format = typeof gpu.getPreferredCanvasFormat === "function"
        ? gpu.getPreferredCanvasFormat()
        : "bgra8unorm";
      var textureUsage = options.gpuTextureUsage ||
        (typeof GPUTextureUsage !== "undefined" ? GPUTextureUsage : null);
      if (!textureUsage) {
        throw new Error("compiled retained scene GPUTextureUsage is unavailable");
      }
      context.configure({
        device: device,
        format: format,
        alphaMode: "premultiplied",
        usage: textureUsage.RENDER_ATTACHMENT | textureUsage.COPY_SRC
      });
      var prepareOptions = Object.assign({}, options, {
        canvas: canvas,
        context: context,
        device: device,
        format: format,
        width: Number(canvas.width || 1),
        height: Number(canvas.height || 1)
      });
      return publicApi.prepare(prepareOptions).then(function(prepared) {
        prepared.canvas = canvas;
        prepared.context = context;
        prepared.device = device;
        prepared.frameId = String(options.config && options.config.scene_ir &&
          options.config.scene_ir.frame &&
          options.config.scene_ir.frame.frame_id || "");
        var validatesFirstFrame =
          typeof device.pushErrorScope === "function" &&
          typeof device.popErrorScope === "function";
        if (validatesFirstFrame) { device.pushErrorScope("validation"); }
        try {
          publicApi.submitFrame(prepared);
        } catch (error) {
          if (validatesFirstFrame) {
            Promise.resolve(device.popErrorScope()).catch(function () {});
          }
          throw error;
        }
        publicApi.attachCameraControls({
          prepared: prepared,
          canvas: canvas,
          artifacts: options.artifacts,
          config: options.config
        });
        if (typeof options.onSubmitted === "function") { options.onSubmitted(); }
        var validation = validatesFirstFrame
          ? Promise.resolve(device.popErrorScope())
          : Promise.resolve(null);
        var completed = device.queue && typeof device.queue.onSubmittedWorkDone === "function"
          ? device.queue.onSubmittedWorkDone()
          : Promise.resolve();
        return Promise.all([validation, completed]).then(function (results) {
          var validationError = results[0];
          if (validationError) {
            throw new Error(
              "compiled WebGPU first frame validation failed: " +
              String(validationError.message || validationError)
            );
          }
          prepared.presented = true;
          if (typeof options.onPresented === "function") { options.onPresented(); }
          var mediaCapture = nativeFrameMediaCaptureConfig();
          if (mediaCapture) {
            return runNativeFrameMediaCapture(prepared, options, mediaCapture).then(
              function (evidence) {
                postOffscreenCameraBenchmark(evidence);
                return prepared;
              },
              function (error) {
                postOffscreenCameraBenchmark({
                  type: "vf_native_frame_media_capture_v1",
                  schema: "vektor-flow/native-frame-media-capture-v1",
                  status: "error",
                  error: String(error && error.message || error)
                });
                return prepared;
              }
            );
          }
          var benchmark = offscreenCameraBenchmarkConfig();
          if (!benchmark) { return prepared; }
          return runOffscreenCameraBenchmark(prepared, options, benchmark).then(
            function (evidence) {
              postOffscreenCameraBenchmark(evidence);
              return prepared;
            },
            function (error) {
              var failure = {
                type: "vf_offscreen_camera_benchmark_v1",
                schema: "vektor-flow/compiled-camera-gpu-benchmark-v1",
                status: "error",
                error: String(error && error.message || error)
              };
              if (error && error.captureEvidence) {
                failure.capture = error.captureEvidence;
              }
              postOffscreenCameraBenchmark(failure);
              return prepared;
            }
          );
        });
      });
    });
  }

  function prime(options) {
    options = options || {};
    var platform = options.navigator ||
      (typeof navigator !== "undefined" ? navigator : null);
    var gpu = platform && platform.gpu;
    if (!gpu || typeof gpu.requestAdapter !== "function") {
      return Promise.reject(new Error("compiled retained scene WebGPU platform is unavailable"));
    }
    var cached = deviceAcquisitions && deviceAcquisitions.get(gpu);
    if (cached) { return cached; }
    startupMark("compiled-gpu:adapter-request:start");
    var acquisition = gpu.requestAdapter({ powerPreference: "high-performance" }).then(function(adapter) {
      if (!adapter || typeof adapter.requestDevice !== "function") {
        throw new Error("compiled retained scene WebGPU adapter is unavailable");
      }
      startupMark("compiled-gpu:adapter-request:ready");
      startupMark("compiled-gpu:device-request:start");
      return adapter.requestDevice();
    }).then(function(device) {
      startupMark("compiled-gpu:device-request:ready");
      return device;
    }).catch(function(error) {
      if (deviceAcquisitions) { deviceAcquisitions.delete(gpu); }
      throw error;
    });
    if (deviceAcquisitions) { deviceAcquisitions.set(gpu, acquisition); }
    return acquisition;
  }

  publicApi = {
    schema: PLAN_SCHEMA,
    prime: prime,
    prepare: prepare,
    mount: mount,
    attachCameraControls: attachCameraControls,
    captureFrame: captureFrame,
    submitFrame: submitFrame
  };
  return publicApi;
});
