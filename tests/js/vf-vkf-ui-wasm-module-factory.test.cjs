const assert = require("node:assert/strict");
const factory = require("../../web/vf-ui/vf-vkf-ui-wasm-module-factory.js");
const registry = require("../../web/vf-ui/vf-compiled-ui-module-registry.js");
const wasmAdapterModule = require("../../web/vf-ui/vf-vkf-ui-wasm-kernel-adapter.js");
const kernelAdapterModule = require("../../web/vf-ui/vf-vkf-ui-kernel-adapter.js");
const kernelModule = require("../../web/vf-ui/vf-vkf-ui-kernel.js");
const shared = require("../../web/vf-ui/vf-shared-runtime.js");
const vkfUi = require("../../web/vf-ui/vf-vkf-ui-runtime.js");

{
  const fullDemoId = factory.BUILTIN_WASM_FACTORY_IDS.fullDemo;
  const rectDemoId = registry.BUILTIN_MODULE_IDS.rectDemo;
  const rectDemoLib = registry.BUILTIN_NATIVE_LIBRARIES.rectDemo;
  const builtins = registry.listBuiltinCompiledUiModules();
  assert.deepEqual(builtins, [{
    name: rectDemoId,
    nativeLibrary: rectDemoLib,
    wasmFactory: fullDemoId
  }]);
  assert.deepEqual(registry.getBuiltinCompiledUiModule(rectDemoId), builtins[0]);
  assert.equal(registry.resolveBuiltinCompiledUiWasmFactory("missing"), null);
  assert.deepEqual(
    {
      name: registry.resolveBuiltinCompiledUiWasmFactory(rectDemoId).name,
      wasmFactory: registry.resolveBuiltinCompiledUiWasmFactory(rectDemoId).wasmFactory
    },
    {
      name: rectDemoId,
      wasmFactory: fullDemoId
    }
  );

  const wasm = registry.instantiateBuiltinCompiledUiWasmModule(rectDemoId);
  assert.ok(wasm.memory instanceof WebAssembly.Memory);
  const adapter = wasmAdapterModule.createWasmKernelAdapter({
    memory: wasm.memory,
    exports: wasm.instance.exports,
    fallbackKernel: kernelAdapterModule.createJsKernelAdapter({
      moveVertexToLocalCursor(state) {
        return {
          x: state.coords.x.slice(),
          y: state.coords.y.slice(),
          z: state.coords.z.slice()
        };
      }
    })
  });

  const arena = shared.createTransformArena(4);
  const geometryArena = shared.createGeometryArena(16);
  const eventArena = shared.createEventArena(2);
  const runtime = vkfUi.createVkfUiRuntime({ arena, geometryArena, eventArena, kernelAdapter: adapter });
  const panel = runtime.ui.display.frame();
  runtime.ui.display.add_frame(panel, [0, 0, 1, 1]);

  const mesh = panel.add({
    x: [-1, 0, 1],
    y: [0, 1, 0],
    bounds: [100, 100, 100, 100]
  });
  mesh.add_vertices([]);
  mesh.add_edges([[0, 1], [1, 2], [2, 0]]);
  mesh.add_faces([[0, 1, 2]]);

  const hit = panel.pick([150, 150]);
  assert.equal(hit.object, mesh);
  assert.equal(hit.hover.vertex_id, 1);

  const movable = panel.add({
    x: [1],
    y: [2],
    z: [0],
    bounds: [100, 100, 100, 100]
  });
  movable.add_vertices([0]);
  movable.move_vertex({ vertex: 0, local_cursor: [7, 9] });
  assert.deepEqual(movable.coords.x, [7]);
  assert.deepEqual(movable.coords.y, [9]);

  const editable = panel.add({
    x: [1, 3],
    y: [2, 4],
    z: [0, 0],
    bounds: [100, 100, 100, 100]
  });
  editable.add_edges([[0, 1]]);
  editable.translate_edge({ edge: [0, 1], local_trans: [5, -2] });
  assert.deepEqual(editable.coords.x, [6, 8]);
  assert.deepEqual(editable.coords.y, [0, 2]);

  const transformMesh = panel.add({
    x: [-1, 1, 1, -1],
    y: [-1, -1, 1, 1],
    bounds: [100, 100, 100, 100]
  });
  transformMesh.add_vertices([0, 1, 2, 3]);
  transformMesh.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]]);

  const origin = transformMesh.world_inner_point(transformMesh.origin).slice(0, 2);
  const anchor = transformMesh.world_point(0).slice(0, 2);
  const rotateCursor = [anchor[0] + 14, anchor[1] - 8];
  const anchorVec = [anchor[0] - origin[0], anchor[1] - origin[1]];
  const rotateVec = [rotateCursor[0] - origin[0], rotateCursor[1] - origin[1]];
  transformMesh.rotate_scale_at_vertex({
    vertex: 0,
    origo: origin,
    angle: Math.atan2(rotateVec[1], rotateVec[0]) - Math.atan2(anchorVec[1], anchorVec[0]),
    scale: Math.hypot(rotateVec[0], rotateVec[1]) / Math.hypot(anchorVec[0], anchorVec[1])
  });
  assert.ok(Math.abs(transformMesh.world_point(0)[0] - rotateCursor[0]) <= 1e-6);
  assert.ok(Math.abs(transformMesh.world_point(0)[1] - rotateCursor[1]) <= 1e-6);

  const edgeA = transformMesh._parent_point_from_inner([-1, -1, 0]).slice(0, 2);
  const edgeB = transformMesh._parent_point_from_inner([1, -1, 0]).slice(0, 2);
  const ex = edgeB[0] - edgeA[0];
  const ey = edgeB[1] - edgeA[1];
  const len = Math.sqrt(ex * ex + ey * ey);
  const normal = [-ey / len, ex / len];
  const edgeAnchor = transformMesh._parent_point_from_inner([0, -1, 0]).slice(0, 2);
  const edgeCursor = [edgeAnchor[0] + normal[0] * 10, edgeAnchor[1] + normal[1] * 10];
  const origin2 = transformMesh.world_inner_point(transformMesh.origin).slice(0, 2);
  const normalAnchor = (edgeAnchor[0] - origin2[0]) * normal[0] + (edgeAnchor[1] - origin2[1]) * normal[1];
  const scale = ((edgeCursor[0] - origin2[0]) * normal[0] + (edgeCursor[1] - origin2[1]) * normal[1]) / normalAnchor;
  transformMesh.scale_edge({ edge: 0, origo: origin2, scale });
  assert.ok(Math.abs(transformMesh._parent_point_from_inner([0, -1, 0])[0] - edgeCursor[0]) <= 1e-6);
  assert.ok(Math.abs(transformMesh._parent_point_from_inner([0, -1, 0])[1] - edgeCursor[1]) <= 1e-6);
}

{
  const wasm = factory.instantiateRotateScaleModule();
  const adapter = wasmAdapterModule.createWasmKernelAdapter({
    memory: wasm.memory,
    exports: wasm.instance.exports,
    fallbackKernel: kernelAdapterModule.createJsKernelAdapter()
  });
  const state = {
    matrix: [1.25, -0.5, 0.75, 1.5],
    offset: [12, -3],
    angle: Math.PI / 6,
    scale: 1.4,
    origo: [4, 9]
  };
  const actual = adapter.rotateScaleTransform(state);
  const expected = kernelModule.rotateScaleTransform(state);
  for (let i = 0; i < 4; i += 1) {
    assert.ok(Math.abs(actual.matrix[i] - expected.matrix[i]) <= 1e-9);
  }
  for (let i = 0; i < 2; i += 1) {
    assert.ok(Math.abs(actual.offset[i] - expected.offset[i]) <= 1e-9);
  }
}

{
  const wasm = factory.instantiateScaleEdgeModule();
  const adapter = wasmAdapterModule.createWasmKernelAdapter({
    memory: wasm.memory,
    exports: wasm.instance.exports,
    fallbackKernel: kernelAdapterModule.createJsKernelAdapter()
  });
  const state = {
    matrix: [1.25, -0.5, 0.75, 1.5],
    offset: [12, -3],
    edgeA: [1, 2],
    edgeB: [5, 5],
    scale: 1.8,
    origo: [4, 9]
  };
  const actual = adapter.scaleEdgeTransform(state);
  const expected = kernelModule.scaleEdgeTransform(state);
  for (let i = 0; i < 4; i += 1) {
    assert.ok(Math.abs(actual.matrix[i] - expected.matrix[i]) <= 1e-9);
  }
  for (let i = 0; i < 2; i += 1) {
    assert.ok(Math.abs(actual.offset[i] - expected.offset[i]) <= 1e-9);
  }
}

{
  const wasm = factory.instantiateTransformModule();
  const adapter = wasmAdapterModule.createWasmKernelAdapter({
    memory: wasm.memory,
    exports: wasm.instance.exports,
    fallbackKernel: kernelAdapterModule.createJsKernelAdapter()
  });

  const rotateState = {
    matrix: [1.25, -0.5, 0.75, 1.5],
    offset: [12, -3],
    angle: Math.PI / 6,
    scale: 1.4,
    origo: [4, 9]
  };
  const rotateActual = adapter.rotateScaleTransform(rotateState);
  const rotateExpected = kernelModule.rotateScaleTransform(rotateState);
  for (let i = 0; i < 4; i += 1) {
    assert.ok(Math.abs(rotateActual.matrix[i] - rotateExpected.matrix[i]) <= 1e-9);
  }
  for (let i = 0; i < 2; i += 1) {
    assert.ok(Math.abs(rotateActual.offset[i] - rotateExpected.offset[i]) <= 1e-9);
  }

  const scaleState = {
    matrix: [1.25, -0.5, 0.75, 1.5],
    offset: [12, -3],
    edgeA: [1, 2],
    edgeB: [5, 5],
    scale: 1.8,
    origo: [4, 9]
  };
  const scaleActual = adapter.scaleEdgeTransform(scaleState);
  const scaleExpected = kernelModule.scaleEdgeTransform(scaleState);
  for (let i = 0; i < 4; i += 1) {
    assert.ok(Math.abs(scaleActual.matrix[i] - scaleExpected.matrix[i]) <= 1e-9);
  }
  for (let i = 0; i < 2; i += 1) {
    assert.ok(Math.abs(scaleActual.offset[i] - scaleExpected.offset[i]) <= 1e-9);
  }
}

{
  const wasm = factory.instantiateMoveVertexModule();
  const adapter = wasmAdapterModule.createWasmKernelAdapter({
    memory: wasm.memory,
    exports: wasm.instance.exports,
    fallbackKernel: kernelAdapterModule.createJsKernelAdapter()
  });

  const arena = shared.createTransformArena(2);
  const geometryArena = shared.createGeometryArena(8);
  const eventArena = shared.createEventArena(2);
  const runtime = vkfUi.createVkfUiRuntime({ arena, geometryArena, eventArena, kernelAdapter: adapter });
  const panel = runtime.ui.display.frame();
  runtime.ui.display.add_frame(panel, [0, 0, 1, 1]);

  const mesh = panel.add({
    x: [0],
    y: [0],
    z: [0],
    bounds: [100, 100, 100, 100]
  });
  mesh.add_vertices([0]);
  mesh.move_vertex({ vertex: 0, local_cursor: [7, 9] });
  assert.deepEqual(mesh.coords.x, [7]);
  assert.deepEqual(mesh.coords.y, [9]);
  assert.deepEqual(geometryArena.vertex(mesh.geometry_offset + 0), [7, 9, 0]);
}

{
  const wasm = factory.instantiateTranslateEdgeModule();
  const adapter = wasmAdapterModule.createWasmKernelAdapter({
    memory: wasm.memory,
    exports: wasm.instance.exports,
    fallbackKernel: kernelAdapterModule.createJsKernelAdapter()
  });

  const arena = shared.createTransformArena(2);
  const geometryArena = shared.createGeometryArena(8);
  const eventArena = shared.createEventArena(2);
  const runtime = vkfUi.createVkfUiRuntime({ arena, geometryArena, eventArena, kernelAdapter: adapter });
  const panel = runtime.ui.display.frame();
  runtime.ui.display.add_frame(panel, [0, 0, 1, 1]);

  const mesh = panel.add({
    x: [1, 3],
    y: [2, 4],
    z: [0, 0],
    bounds: [100, 100, 100, 100]
  });
  mesh.add_vertices([0, 1]);
  mesh.add_edges([[0, 1]]);
  mesh.translate_edge({ edge: [0, 1], local_trans: [5, -2] });
  assert.deepEqual(mesh.coords.x, [6, 8]);
  assert.deepEqual(mesh.coords.y, [0, 2]);
  assert.deepEqual(geometryArena.vertex(mesh.geometry_offset + 0), [6, 0, 0]);
  assert.deepEqual(geometryArena.vertex(mesh.geometry_offset + 1), [8, 2, 0]);
}

console.log("vf-vkf-ui-wasm-module-factory tests passed");
