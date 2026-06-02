(function(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.VfCompiledRuntimeBridge = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  "use strict";

  function cloneFields(fields) {
    return Array.isArray(fields) ? fields.map(function(field) {
      var clone = {
        name: field.name,
        offset: Number(field.offset) || 0,
        type: field.type || "num"
      };
      if (field.storage != null) {
        clone.storage = field.storage;
      }
      if (field.axis_key != null) {
        clone.axis_key = field.axis_key;
      }
      if (field.axis_length != null) {
        clone.axis_length = Number(field.axis_length || 0);
      }
      return clone;
    }) : [];
  }

  function cloneBindings(bindings) {
    return Array.isArray(bindings) ? bindings.map(function(binding) {
      var clone = {
        name: binding.name,
        kind: binding.kind
      };
      if (binding.axis_key != null) {
        clone.axis_key = binding.axis_key;
      }
      if (binding.ptr_export != null) {
        clone.ptr_export = binding.ptr_export;
      }
      if (binding.len_export != null) {
        clone.len_export = binding.len_export;
      }
      if (binding.value_export != null) {
        clone.value_export = binding.value_export;
      }
      if (Array.isArray(binding.values)) {
        clone.values = binding.values.slice();
      }
      if (binding.value != null) {
        clone.value = binding.value;
      }
      return clone;
    }) : [];
  }

  function isAxisVectorField(field) {
    return (field.axis_length | 0) > 0 || (typeof field.type === "string" && field.type.indexOf("axis<") === 0);
  }

  function isFloatField(field) {
    return (field && (
      field.storage === "f64" ||
      field.storage === "f32" ||
      field.type === "f64" ||
      field.type === "f32" ||
      (typeof field.type === "string" && (field.type.indexOf("list<f64>") >= 0 || field.type.indexOf("list<f32>") >= 0))
    )) || false;
  }

  function fieldWordBytes(field) {
    if (field && field.storage === "f32") {
      return 4;
    }
    return isFloatField(field) ? 8 : 4;
  }

  function readStructuredFields(dataView, baseOffset, fields) {
    var result = {};
    for (var i = 0; i < fields.length; i += 1) {
      if (isAxisVectorField(fields[i])) {
        result[fields[i].name] = readAxisVector(dataView, baseOffset + fields[i].offset, Number(fields[i].axis_length) || 0, fields[i]);
      } else {
        result[fields[i].name] = isFloatField(fields[i])
          ? ((fields[i].storage === "f32" || fields[i].type === "f32")
              ? dataView.getFloat32(baseOffset + fields[i].offset, true)
              : dataView.getFloat64(baseOffset + fields[i].offset, true))
          : dataView.getInt32(baseOffset + fields[i].offset, true);
      }
    }
    return result;
  }

  function writeStructuredFields(dataView, baseOffset, fields, values) {
    values = values || {};
    for (var i = 0; i < fields.length; i += 1) {
      if (isAxisVectorField(fields[i])) {
        writeAxisVector(dataView, baseOffset + fields[i].offset, Number(fields[i].axis_length) || 0, values[fields[i].name], fields[i]);
      } else {
        if (isFloatField(fields[i])) {
          if (fields[i].storage === "f32" || fields[i].type === "f32") {
            dataView.setFloat32(baseOffset + fields[i].offset, Number(values[fields[i].name] || 0), true);
          } else {
            dataView.setFloat64(baseOffset + fields[i].offset, Number(values[fields[i].name] || 0), true);
          }
        } else {
          dataView.setInt32(baseOffset + fields[i].offset, Number(values[fields[i].name] || 0), true);
        }
      }
    }
  }

  function scalarFields(name) {
    return [{ name: name || "value", offset: 0, type: "num" }];
  }

  function structuredByteLength(fields) {
    if (!fields.length) {
      return 4;
    }
    var last = fields[fields.length - 1];
    return last.offset + ((isAxisVectorField(last) ? (Number(last.axis_length) || 0) : 1) * fieldWordBytes(last));
  }

  function axisVectorValues(values) {
    return Array.isArray(values) ? values : ((values && values.values) || []);
  }

  function readAxisVector(dataView, baseOffset, length, field) {
    var values = [];
    var stride = fieldWordBytes(field || {});
    for (var i = 0; i < length; i += 1) {
      if (isFloatField(field || {})) {
        values.push((field && (field.storage === "f32" || field.type === "f32"))
          ? dataView.getFloat32(baseOffset + (i * stride), true)
          : dataView.getFloat64(baseOffset + (i * stride), true));
      } else {
        values.push(dataView.getInt32(baseOffset + (i * stride), true));
      }
    }
    return { values: values };
  }

  function writeAxisVector(dataView, baseOffset, length, values, field) {
    var vectorValues = axisVectorValues(values);
    var stride = fieldWordBytes(field || {});
    for (var i = 0; i < length; i += 1) {
      if (isFloatField(field || {})) {
        if (field && (field.storage === "f32" || field.type === "f32")) {
          dataView.setFloat32(baseOffset + (i * stride), Number(vectorValues[i] || 0), true);
        } else {
          dataView.setFloat64(baseOffset + (i * stride), Number(vectorValues[i] || 0), true);
        }
      } else {
        dataView.setInt32(baseOffset + (i * stride), Number(vectorValues[i] || 0), true);
      }
    }
  }

  function readBindingValue(dataView, exportsObject, binding) {
    if (!binding || !binding.kind) {
      throw new Error("compiled runtime binding metadata is incomplete");
    }
    if (binding.kind === "i32") {
      return Number(exportsObject[binding.value_export]());
    }
    if (binding.kind === "f64") {
      return Number(exportsObject[binding.value_export]());
    }
    if (binding.kind === "string") {
      var stringPtr = Number(exportsObject[binding.ptr_export]());
      var stringLen = Number(exportsObject[binding.len_export]());
      var bytes = new Uint8Array(exportsObject.memory.buffer, stringPtr, stringLen);
      return new TextDecoder("utf-8").decode(bytes);
    }
    if (binding.kind === "axis_i32_array") {
      var i32Ptr = Number(exportsObject[binding.ptr_export]());
      var i32Len = Number(exportsObject[binding.len_export]());
      var i32Values = [];
      for (var i = 0; i < i32Len; i += 1) {
        i32Values.push(dataView.getInt32(i32Ptr + (i * 4), true));
      }
      return { axisKey: binding.axis_key || null, values: i32Values };
    }
    if (binding.kind === "axis_f64_array") {
      var f64Ptr = Number(exportsObject[binding.ptr_export]());
      var f64Len = Number(exportsObject[binding.len_export]());
      var f64Values = [];
      for (var j = 0; j < f64Len; j += 1) {
        f64Values.push(dataView.getFloat64(f64Ptr + (j * 8), true));
      }
      return { axisKey: binding.axis_key || null, values: f64Values };
    }
    throw new Error("unsupported compiled runtime binding kind " + binding.kind);
  }

  function instantiateWasmRuntime(options) {
    options = options || {};
    var manifest = options.manifest || {};
    var runtimeSurface = manifest.runtime_surface || {};
    var bytes = options.bytes;
    if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) {
      throw new Error("instantiateWasmRuntime requires wasm bytes");
    }
    var imports = options.imports || {};
    var module = new WebAssembly.Module(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    var instance = new WebAssembly.Instance(module, imports);
    var exportsObject = instance.exports;
    if (!exportsObject.memory || !(exportsObject.memory.buffer instanceof ArrayBuffer)) {
      throw new Error("compiled wasm runtime must export memory");
    }
    var updateMode = runtimeSurface.update_mode || "scalar";
    var stateAxisKey = runtimeSurface.state_axis_key || null;
    var stateAxisLength = Number(runtimeSurface.state_axis_length || 0);
    var inputAxisKey = runtimeSurface.input_axis_key || null;
    var inputAxisLength = Number(runtimeSurface.input_axis_length || 0);
    var stateFields = cloneFields(runtimeSurface.state_fields);
    var inputFields = cloneFields(runtimeSurface.input_fields);
    if (!stateFields.length) {
      stateFields = scalarFields("value");
    }
    if (!inputFields.length) {
      inputFields = scalarFields("value");
    }
    var statePtrExport = runtimeSurface.state_ptr_export || "vkf_state_ptr";
    var stateSizeExport = runtimeSurface.state_size_export || "vkf_state_size";
    var inputPtrExport = runtimeSurface.input_ptr_export || "vkf_input_ptr";
    var inputSizeExport = runtimeSurface.input_size_export || "vkf_input_size";
    var initExport = runtimeSurface.init_export || "vkf_init";
    var updateExport = runtimeSurface.update_export || "vkf_update";
    var shutdownExport = runtimeSurface.shutdown_export || "vkf_shutdown";
    var bindingMetas = cloneBindings(runtimeSurface.bindings);

    function dataView() {
      return new DataView(exportsObject.memory.buffer);
    }

    function statePtr() {
      return Number(exportsObject[statePtrExport]());
    }

    function inputPtr() {
      return Number(exportsObject[inputPtrExport]());
    }

    return {
      manifest: manifest,
      module: module,
      instance: instance,
      exports: exportsObject,
      init: function() {
        if (typeof exportsObject[initExport] === "function") {
          exportsObject[initExport]();
        }
      },
      update: function() {
        if (typeof exportsObject[updateExport] !== "function") {
          throw new Error("compiled wasm runtime missing update export");
        }
        exportsObject[updateExport]();
      },
      shutdown: function() {
        if (typeof exportsObject[shutdownExport] === "function") {
          exportsObject[shutdownExport]();
        }
      },
      stateLayout: function() {
        return {
          ptr: statePtr(),
          size: Number(exportsObject[stateSizeExport]()),
          fields: cloneFields(stateFields),
          axisKey: stateAxisKey,
          axisLength: stateAxisLength
        };
      },
      inputLayout: function() {
        return {
          ptr: inputPtr(),
          size: Number(exportsObject[inputSizeExport]()),
          fields: cloneFields(inputFields),
          axisKey: inputAxisKey,
          axisLength: inputAxisLength
        };
      },
      bindingsLayout: function() {
        return cloneBindings(bindingMetas);
      },
      readBinding: function(name) {
        for (var i = 0; i < bindingMetas.length; i += 1) {
          if (bindingMetas[i].name === name) {
            return readBindingValue(dataView(), exportsObject, bindingMetas[i]);
          }
        }
        throw new Error("unknown compiled runtime binding " + name);
      },
      readBindings: function() {
        var view = dataView();
        var result = {};
        for (var i = 0; i < bindingMetas.length; i += 1) {
          result[bindingMetas[i].name] = readBindingValue(view, exportsObject, bindingMetas[i]);
        }
        return result;
      },
      readState: function() {
        if ((updateMode === "axis_vector_scalar" || updateMode === "axis_vector_vector") && stateAxisLength > 0) {
          return readAxisVector(dataView(), statePtr(), stateAxisLength, stateFields[0] || { type: "num" });
        }
        return readStructuredFields(dataView(), statePtr(), stateFields);
      },
      writeState: function(values) {
        if ((updateMode === "axis_vector_scalar" || updateMode === "axis_vector_vector") && stateAxisLength > 0) {
          writeAxisVector(dataView(), statePtr(), stateAxisLength, values, stateFields[0] || { type: "num" });
          return;
        }
        writeStructuredFields(dataView(), statePtr(), stateFields, values);
      },
      readInput: function() {
        if (updateMode === "axis_vector_vector" && inputAxisLength > 0) {
          return readAxisVector(dataView(), inputPtr(), inputAxisLength, inputFields[0] || { type: "num" });
        }
        return readStructuredFields(dataView(), inputPtr(), inputFields);
      },
      writeInput: function(values) {
        if (updateMode === "axis_vector_vector" && inputAxisLength > 0) {
          writeAxisVector(dataView(), inputPtr(), inputAxisLength, values, inputFields[0] || { type: "num" });
          return;
        }
        writeStructuredFields(dataView(), inputPtr(), inputFields, values);
      }
    };
  }

  function createWebGpuRuntimeSpec(options) {
    options = options || {};
    var manifest = options.manifest || {};
    var runtimeSurface = manifest.runtime_surface || {};
    var wgsl = String(options.wgsl || "");
    if (!wgsl) {
      throw new Error("createWebGpuRuntimeSpec requires wgsl source");
    }
    var stateFields = cloneFields(runtimeSurface.state_fields);
    var inputFields = cloneFields(runtimeSurface.input_fields);
    var updateMode = runtimeSurface.update_mode || "scalar";
    var stateAxisKey = runtimeSurface.state_axis_key || null;
    var stateAxisLength = Number(runtimeSurface.state_axis_length || 0);
    var inputAxisKey = runtimeSurface.input_axis_key || null;
    var inputAxisLength = Number(runtimeSurface.input_axis_length || 0);
    if (!stateFields.length) {
      stateFields = scalarFields("value");
    }
    if (!inputFields.length) {
      inputFields = scalarFields("value");
    }
    var bindingMetas = cloneBindings(runtimeSurface.bindings);
    return {
      manifest: manifest,
      wgsl: wgsl,
      entryPoint: manifest.shader_entry || "vkf_update",
      stateBinding: Number(runtimeSurface.state_binding || 0),
      inputBinding: Number(runtimeSurface.input_binding || 1),
      updateMode: updateMode,
      stateAxisKey: stateAxisKey,
      stateAxisLength: stateAxisLength,
      inputAxisKey: inputAxisKey,
      inputAxisLength: inputAxisLength,
      stateFields: stateFields,
      inputFields: inputFields,
      bindings: bindingMetas,
      readBinding: function(name) {
        for (var i = 0; i < bindingMetas.length; i += 1) {
          if (bindingMetas[i].name === name) {
            var binding = bindingMetas[i];
            if (binding.kind === "axis_i32_array" || binding.kind === "axis_f64_array") {
              return {
                axisKey: binding.axis_key || null,
                values: Array.isArray(binding.values) ? binding.values.slice() : []
              };
            }
            if (binding.kind === "i32_const" || binding.kind === "f64_const") {
              return binding.value;
            }
            throw new Error("unsupported compiled webgpu binding kind " + binding.kind);
          }
        }
        throw new Error("unknown compiled webgpu binding " + name);
      },
      encodeState: function(values) {
        if ((updateMode === "axis_vector_scalar" || updateMode === "axis_vector_vector") && stateAxisLength > 0) {
          var vectorValues = axisVectorValues(values);
          var stateAxisField = stateFields[0] || { type: "num" };
          var axisStride = fieldWordBytes(stateAxisField);
          var axisBuffer = new ArrayBuffer(stateAxisLength * axisStride);
          var axisView = new DataView(axisBuffer);
          for (var i = 0; i < stateAxisLength; i += 1) {
            if (isFloatField(stateAxisField)) {
              if (stateAxisField.storage === "f32" || stateAxisField.type === "f32") {
                axisView.setFloat32(i * axisStride, Number(vectorValues[i] || 0), true);
              } else {
                axisView.setFloat64(i * axisStride, Number(vectorValues[i] || 0), true);
              }
            } else {
              axisView.setInt32(i * axisStride, Number(vectorValues[i] || 0), true);
            }
          }
          return new Uint8Array(axisBuffer);
        }
        var byteLength = structuredByteLength(stateFields);
        var buffer = new ArrayBuffer(byteLength);
        writeStructuredFields(new DataView(buffer), 0, stateFields, values);
        return new Uint8Array(buffer);
      },
      encodeInput: function(values) {
        if (updateMode === "axis_vector_vector" && inputAxisLength > 0) {
          var inputVectorValues = axisVectorValues(values);
          var inputAxisField = inputFields[0] || { type: "num" };
          var inputAxisStride = fieldWordBytes(inputAxisField);
          var axisInputBuffer = new ArrayBuffer(inputAxisLength * inputAxisStride);
          var axisInputView = new DataView(axisInputBuffer);
          for (var j = 0; j < inputAxisLength; j += 1) {
            if (isFloatField(inputAxisField)) {
              if (inputAxisField.storage === "f32" || inputAxisField.type === "f32") {
                axisInputView.setFloat32(j * inputAxisStride, Number(inputVectorValues[j] || 0), true);
              } else {
                axisInputView.setFloat64(j * inputAxisStride, Number(inputVectorValues[j] || 0), true);
              }
            } else {
              axisInputView.setInt32(j * inputAxisStride, Number(inputVectorValues[j] || 0), true);
            }
          }
          return new Uint8Array(axisInputBuffer);
        }
        var byteLength = structuredByteLength(inputFields);
        var buffer = new ArrayBuffer(byteLength);
        writeStructuredFields(new DataView(buffer), 0, inputFields, values);
        return new Uint8Array(buffer);
      }
    };
  }

  function createWasmRuntimeController(options) {
    options = options || {};
    var runtime = options.runtime || instantiateWasmRuntime(options);
    var readSample = typeof options.readSample === "function" ? options.readSample : function() { return {}; };
    var mapInput = typeof options.mapInput === "function" ? options.mapInput : function(sample) { return sample || {}; };
    var applyState = typeof options.applyState === "function" ? options.applyState : function() {};
    var mapInitialState = typeof options.mapInitialState === "function" ? options.mapInitialState : function(state) { return state || {}; };

    return {
      runtime: runtime,
      init: function(initialState) {
        runtime.init();
        if (initialState != null) {
          runtime.writeState(mapInitialState(initialState));
          applyState(runtime.readState(), initialState);
        }
      },
      step: function(sample) {
        var nextSample = sample == null ? readSample() : sample;
        var input = mapInput(nextSample);
        runtime.writeInput(input);
        runtime.update();
        var state = runtime.readState();
        applyState(state, nextSample);
        return {
          sample: nextSample,
          input: input,
          state: state
        };
      },
      shutdown: function() {
        runtime.shutdown();
      },
      readState: function() {
        return runtime.readState();
      },
      writeState: function(values) {
        runtime.writeState(values);
        applyState(runtime.readState(), null);
      }
    };
  }

  return {
    instantiateWasmRuntime: instantiateWasmRuntime,
    createWebGpuRuntimeSpec: createWebGpuRuntimeSpec,
    createWasmRuntimeController: createWasmRuntimeController
  };
});
