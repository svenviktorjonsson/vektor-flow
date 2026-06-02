const assert = require("node:assert/strict");
const shared = require("../../web/vf-ui/vf-shared-runtime.js");
const vkfUi = require("../../web/vf-ui/vf-vkf-ui-runtime.js");
const wasmAdapterModule = require("../../web/vf-ui/vf-vkf-ui-wasm-kernel-adapter.js");
const wasmFactoryModule = require("../../web/vf-ui/vf-vkf-ui-wasm-module-factory.js");

const WASM_EXPORTS = wasmFactoryModule.EXPORT_NAMES;

function encodeU32(value, bytes) {
  value >>>= 0;
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (value !== 0);
}

function encodeI32(value, bytes) {
  value |= 0;
  let more = true;
  while (more) {
    let byte = value & 0x7f;
    value >>= 7;
    const signBit = (byte & 0x40) !== 0;
    more = !((value === 0 && !signBit) || (value === -1 && signBit));
    if (more) {
      byte |= 0x80;
    }
    bytes.push(byte);
  }
}

function encodeString(text, bytes) {
  const utf8 = new TextEncoder().encode(text);
  encodeU32(utf8.length, bytes);
  for (let i = 0; i < utf8.length; i += 1) {
    bytes.push(utf8[i]);
  }
}

function makeSection(id, content, bytes) {
  bytes.push(id);
  encodeU32(content.length, bytes);
  for (let i = 0; i < content.length; i += 1) {
    bytes.push(content[i]);
  }
}

function buildCompiledScalarRuntimeModuleBytes(gain) {
  const bytes = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

  const typeSection = [];
  encodeU32(2, typeSection);
  typeSection.push(0x60); encodeU32(0, typeSection); encodeU32(0, typeSection);
  typeSection.push(0x60); encodeU32(0, typeSection); encodeU32(1, typeSection); typeSection.push(0x7f);
  makeSection(1, typeSection, bytes);

  const functionSection = [];
  encodeU32(7, functionSection);
  encodeU32(0, functionSection); // init
  encodeU32(0, functionSection); // update
  encodeU32(0, functionSection); // shutdown
  encodeU32(1, functionSection); // state_ptr
  encodeU32(1, functionSection); // state_size
  encodeU32(1, functionSection); // input_ptr
  encodeU32(1, functionSection); // input_size
  makeSection(3, functionSection, bytes);

  const memorySection = [];
  encodeU32(1, memorySection);
  memorySection.push(0x00);
  encodeU32(1, memorySection);
  makeSection(5, memorySection, bytes);

  const exportSection = [];
  encodeU32(8, exportSection);
  encodeString("memory", exportSection); exportSection.push(0x02); encodeU32(0, exportSection);
  ["vkf_init", "vkf_update", "vkf_shutdown", "vkf_state_ptr", "vkf_state_size", "vkf_input_ptr", "vkf_input_size"].forEach((name, index) => {
    encodeString(name, exportSection);
    exportSection.push(0x00);
    encodeU32(index, exportSection);
  });
  makeSection(7, exportSection, bytes);

  function bodyBlock(opcodes) {
    const body = [];
    encodeU32(body.length ? 0 : 0, body);
    opcodes.forEach((byte) => body.push(byte));
    body.push(0x0b);
    return body;
  }

  const codeSection = [];
  encodeU32(7, codeSection);

  const initBody = [];
  encodeU32(0, initBody);
  initBody.push(0x41); encodeI32(0, initBody);
  initBody.push(0x41); encodeI32(0, initBody);
  initBody.push(0x36); encodeU32(2, initBody); encodeU32(0, initBody);
  initBody.push(0x41); encodeI32(4, initBody);
  initBody.push(0x41); encodeI32(0, initBody);
  initBody.push(0x36); encodeU32(2, initBody); encodeU32(0, initBody);
  initBody.push(0x0b);
  encodeU32(initBody.length, codeSection); initBody.forEach((b) => codeSection.push(b));

  const updateBody = [];
  encodeU32(0, updateBody);
  updateBody.push(0x41); encodeI32(0, updateBody);
  updateBody.push(0x41); encodeI32(0, updateBody);
  updateBody.push(0x28); encodeU32(2, updateBody); encodeU32(0, updateBody);
  updateBody.push(0x41); encodeI32(4, updateBody);
  updateBody.push(0x28); encodeU32(2, updateBody); encodeU32(0, updateBody);
  updateBody.push(0x6a);
  updateBody.push(0x41); encodeI32(gain, updateBody);
  updateBody.push(0x6a);
  updateBody.push(0x36); encodeU32(2, updateBody); encodeU32(0, updateBody);
  updateBody.push(0x0b);
  encodeU32(updateBody.length, codeSection); updateBody.forEach((b) => codeSection.push(b));

  const noopBody = [0x00, 0x0b];
  encodeU32(noopBody.length, codeSection); noopBody.forEach((b) => codeSection.push(b));

  function i32ConstBody(value) {
    const body = [];
    encodeU32(0, body);
    body.push(0x41); encodeI32(value, body);
    body.push(0x0b);
    return body;
  }
  [0, 4, 4, 4].forEach((value) => {
    const body = i32ConstBody(value);
    encodeU32(body.length, codeSection);
    body.forEach((b) => codeSection.push(b));
  });

  makeSection(10, codeSection, bytes);
  return new Uint8Array(bytes);
}

function buildCompiledAxisVectorRuntimeModuleBytes(gain) {
  const bytes = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

  const typeSection = [];
  encodeU32(2, typeSection);
  typeSection.push(0x60); encodeU32(0, typeSection); encodeU32(0, typeSection);
  typeSection.push(0x60); encodeU32(0, typeSection); encodeU32(1, typeSection); typeSection.push(0x7f);
  makeSection(1, typeSection, bytes);

  const functionSection = [];
  encodeU32(7, functionSection);
  encodeU32(0, functionSection);
  encodeU32(0, functionSection);
  encodeU32(0, functionSection);
  encodeU32(1, functionSection);
  encodeU32(1, functionSection);
  encodeU32(1, functionSection);
  encodeU32(1, functionSection);
  makeSection(3, functionSection, bytes);

  const memorySection = [];
  encodeU32(1, memorySection);
  memorySection.push(0x00);
  encodeU32(1, memorySection);
  makeSection(5, memorySection, bytes);

  const exportSection = [];
  encodeU32(8, exportSection);
  encodeString("memory", exportSection); exportSection.push(0x02); encodeU32(0, exportSection);
  ["vkf_init", "vkf_update", "vkf_shutdown", "vkf_state_ptr", "vkf_state_size", "vkf_input_ptr", "vkf_input_size"].forEach((name, index) => {
    encodeString(name, exportSection);
    exportSection.push(0x00);
    encodeU32(index, exportSection);
  });
  makeSection(7, exportSection, bytes);

  const codeSection = [];
  encodeU32(7, codeSection);

  const initBody = [];
  encodeU32(0, initBody);
  gain.forEach((value, index) => {
    initBody.push(0x41); encodeI32(index * 4, initBody);
    initBody.push(0x41); encodeI32(value, initBody);
    initBody.push(0x36); encodeU32(2, initBody); encodeU32(0, initBody);
  });
  initBody.push(0x0b);
  encodeU32(initBody.length, codeSection); initBody.forEach((b) => codeSection.push(b));

  const updateBody = [];
  encodeU32(0, updateBody);
  gain.forEach((value, index) => {
    const offset = index * 4;
    updateBody.push(0x41); encodeI32(offset, updateBody);
    updateBody.push(0x41); encodeI32(offset, updateBody);
    updateBody.push(0x28); encodeU32(2, updateBody); encodeU32(0, updateBody);
    updateBody.push(0x41); encodeI32(offset, updateBody);
    updateBody.push(0x28); encodeU32(2, updateBody); encodeU32(12, updateBody);
    updateBody.push(0x6a);
    updateBody.push(0x41); encodeI32(value, updateBody);
    updateBody.push(0x6a);
    updateBody.push(0x36); encodeU32(2, updateBody); encodeU32(0, updateBody);
  });
  updateBody.push(0x0b);
  encodeU32(updateBody.length, codeSection); updateBody.forEach((b) => codeSection.push(b));

  const noopBody = [0x00, 0x0b];
  encodeU32(noopBody.length, codeSection); noopBody.forEach((b) => codeSection.push(b));

  function i32ConstBody(value) {
    const body = [];
    encodeU32(0, body);
    body.push(0x41); encodeI32(value, body);
    body.push(0x0b);
    return body;
  }
  [0, gain.length * 4, gain.length * 4, gain.length * 4].forEach((value) => {
    const body = i32ConstBody(value);
    encodeU32(body.length, codeSection);
    body.forEach((b) => codeSection.push(b));
  });

  makeSection(10, codeSection, bytes);
  return new Uint8Array(bytes);
}

function buildCompiledMixedRuntimeModuleBytes(gain) {
  const bytes = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

  const typeSection = [];
  encodeU32(2, typeSection);
  typeSection.push(0x60); encodeU32(0, typeSection); encodeU32(0, typeSection);
  typeSection.push(0x60); encodeU32(0, typeSection); encodeU32(1, typeSection); typeSection.push(0x7f);
  makeSection(1, typeSection, bytes);

  const functionSection = [];
  encodeU32(7, functionSection);
  [0, 0, 0, 1, 1, 1, 1].forEach((v) => encodeU32(v, functionSection));
  makeSection(3, functionSection, bytes);

  const memorySection = [];
  encodeU32(1, memorySection);
  memorySection.push(0x00);
  encodeU32(1, memorySection);
  makeSection(5, memorySection, bytes);

  const exportSection = [];
  encodeU32(8, exportSection);
  encodeString("memory", exportSection); exportSection.push(0x02); encodeU32(0, exportSection);
  ["vkf_init", "vkf_update", "vkf_shutdown", "vkf_state_ptr", "vkf_state_size", "vkf_input_ptr", "vkf_input_size"].forEach((name, index) => {
    encodeString(name, exportSection);
    exportSection.push(0x00);
    encodeU32(index, exportSection);
  });
  makeSection(7, exportSection, bytes);

  const codeSection = [];
  encodeU32(7, codeSection);

  const initBody = [];
  encodeU32(0, initBody);
  [0, 4, 8, 12, 16, 20, 24, 28].forEach((offset) => {
    initBody.push(0x41); encodeI32(offset, initBody);
    initBody.push(0x41); encodeI32(0, initBody);
    initBody.push(0x36); encodeU32(2, initBody); encodeU32(0, initBody);
  });
  initBody.push(0x0b);
  encodeU32(initBody.length, codeSection); initBody.forEach((b) => codeSection.push(b));

  const updateBody = [];
  encodeU32(0, updateBody);
  updateBody.push(0x41); encodeI32(0, updateBody);
  updateBody.push(0x41); encodeI32(0, updateBody);
  updateBody.push(0x28); encodeU32(2, updateBody); encodeU32(0, updateBody);
  updateBody.push(0x41); encodeI32(16, updateBody);
  updateBody.push(0x28); encodeU32(2, updateBody); encodeU32(0, updateBody);
  updateBody.push(0x6a);
  updateBody.push(0x36); encodeU32(2, updateBody); encodeU32(0, updateBody);
  [4, 8, 12].forEach((offset, index) => {
    updateBody.push(0x41); encodeI32(offset, updateBody);
    updateBody.push(0x41); encodeI32(offset, updateBody);
    updateBody.push(0x28); encodeU32(2, updateBody); encodeU32(0, updateBody);
    updateBody.push(0x41); encodeI32(20 + (index * 4), updateBody);
    updateBody.push(0x28); encodeU32(2, updateBody); encodeU32(0, updateBody);
    updateBody.push(0x6a);
    updateBody.push(0x41); encodeI32(gain[index], updateBody);
    updateBody.push(0x6a);
    updateBody.push(0x36); encodeU32(2, updateBody); encodeU32(0, updateBody);
  });
  updateBody.push(0x0b);
  encodeU32(updateBody.length, codeSection); updateBody.forEach((b) => codeSection.push(b));

  const noopBody = [0x00, 0x0b];
  encodeU32(noopBody.length, codeSection); noopBody.forEach((b) => codeSection.push(b));

  function i32ConstBody(value) {
    const body = [];
    encodeU32(0, body);
    body.push(0x41); encodeI32(value, body);
    body.push(0x0b);
    return body;
  }
  [0, 16, 16, 16].forEach((value) => {
    const body = i32ConstBody(value);
    encodeU32(body.length, codeSection);
    body.forEach((b) => codeSection.push(b));
  });

  makeSection(10, codeSection, bytes);
  return new Uint8Array(bytes);
}

function buildCompiledFloatBufferRuntimeModuleBytes(stateSize, inputSize) {
  const bytes = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

  const typeSection = [];
  encodeU32(2, typeSection);
  typeSection.push(0x60); encodeU32(0, typeSection); encodeU32(0, typeSection);
  typeSection.push(0x60); encodeU32(0, typeSection); encodeU32(1, typeSection); typeSection.push(0x7f);
  makeSection(1, typeSection, bytes);

  const functionSection = [];
  encodeU32(7, functionSection);
  [0, 0, 0, 1, 1, 1, 1].forEach((value) => encodeU32(value, functionSection));
  makeSection(3, functionSection, bytes);

  const memorySection = [];
  encodeU32(1, memorySection);
  memorySection.push(0x00);
  encodeU32(1, memorySection);
  makeSection(5, memorySection, bytes);

  const exportSection = [];
  encodeU32(8, exportSection);
  encodeString("memory", exportSection); exportSection.push(0x02); encodeU32(0, exportSection);
  ["vkf_init", "vkf_update", "vkf_shutdown", "vkf_state_ptr", "vkf_state_size", "vkf_input_ptr", "vkf_input_size"].forEach((name, index) => {
    encodeString(name, exportSection);
    exportSection.push(0x00);
    encodeU32(index, exportSection);
  });
  makeSection(7, exportSection, bytes);

  const codeSection = [];
  encodeU32(7, codeSection);
  for (let i = 0; i < 3; i += 1) {
    const noopBody = [0x00, 0x0b];
    encodeU32(noopBody.length, codeSection);
    noopBody.forEach((b) => codeSection.push(b));
  }
  function i32ConstBody(value) {
    const body = [];
    encodeU32(0, body);
    body.push(0x41); encodeI32(value, body);
    body.push(0x0b);
    return body;
  }
  [0, stateSize, stateSize, inputSize].forEach((value) => {
    const body = i32ConstBody(value);
    encodeU32(body.length, codeSection);
    body.forEach((b) => codeSection.push(b));
  });
  makeSection(10, codeSection, bytes);
  return new Uint8Array(bytes);
}

function buildCompiledVertexRuntimeModuleBytes() {
  const bytes = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  function localI32ConstBody(value) {
    const body = [];
    encodeU32(0, body);
    body.push(0x41);
    encodeI32(value, body);
    body.push(0x0b);
    return body;
  }

  const typeSection = [];
  encodeU32(2, typeSection);
  typeSection.push(0x60); encodeU32(0, typeSection); encodeU32(0, typeSection);
  typeSection.push(0x60); encodeU32(0, typeSection); encodeU32(1, typeSection); typeSection.push(0x7f);
  makeSection(1, typeSection, bytes);

  const functionSection = [];
  encodeU32(7, functionSection);
  [0, 0, 0, 1, 1, 1, 1].forEach((value) => encodeU32(value, functionSection));
  makeSection(3, functionSection, bytes);

  const memorySection = [];
  encodeU32(1, memorySection);
  memorySection.push(0x00);
  encodeU32(1, memorySection);
  makeSection(5, memorySection, bytes);

  const exportSection = [];
  encodeU32(8, exportSection);
  encodeString("memory", exportSection); exportSection.push(0x02); encodeU32(0, exportSection);
  ["vkf_init", "vkf_update", "vkf_shutdown", "vkf_state_ptr", "vkf_state_size", "vkf_input_ptr", "vkf_input_size"].forEach((name, index) => {
    encodeString(name, exportSection);
    exportSection.push(0x00);
    encodeU32(index, exportSection);
  });
  makeSection(7, exportSection, bytes);

  const codeSection = [];
  encodeU32(7, codeSection);

  const initBody = [];
  encodeU32(0, initBody);
  [0, 4, 8, 12, 16, 20].forEach((offset) => {
    initBody.push(0x41); encodeI32(offset, initBody);
    initBody.push(0x41); encodeI32(0, initBody);
    initBody.push(0x36); encodeU32(2, initBody); encodeU32(0, initBody);
  });
  initBody.push(0x0b);
  encodeU32(initBody.length, codeSection); initBody.forEach((b) => codeSection.push(b));

  const updateBody = [];
  encodeU32(0, updateBody);
  updateBody.push(0x41); encodeI32(0, updateBody);
  updateBody.push(0x41); encodeI32(8, updateBody);
  updateBody.push(0x28); encodeU32(2, updateBody); encodeU32(0, updateBody);
  updateBody.push(0x41); encodeI32(16, updateBody);
  updateBody.push(0x28); encodeU32(2, updateBody); encodeU32(0, updateBody);
  updateBody.push(0x6b);
  updateBody.push(0x36); encodeU32(2, updateBody); encodeU32(0, updateBody);
  updateBody.push(0x41); encodeI32(4, updateBody);
  updateBody.push(0x41); encodeI32(12, updateBody);
  updateBody.push(0x28); encodeU32(2, updateBody); encodeU32(0, updateBody);
  updateBody.push(0x41); encodeI32(20, updateBody);
  updateBody.push(0x28); encodeU32(2, updateBody); encodeU32(0, updateBody);
  updateBody.push(0x6b);
  updateBody.push(0x36); encodeU32(2, updateBody); encodeU32(0, updateBody);
  updateBody.push(0x0b);
  encodeU32(updateBody.length, codeSection); updateBody.forEach((b) => codeSection.push(b));

  const noopBody = [0x00, 0x0b];
  encodeU32(noopBody.length, codeSection); noopBody.forEach((b) => codeSection.push(b));

  [0, 8, 8, 16].forEach((value) => {
    const body = localI32ConstBody(value);
    encodeU32(body.length, codeSection);
    body.forEach((b) => codeSection.push(b));
  });

  makeSection(10, codeSection, bytes);
  return new Uint8Array(bytes);
}

function assertApproxPoint(actual, expected, epsilon = 1e-6) {
  assert.ok(Math.abs(actual[0] - expected[0]) <= epsilon, `${actual[0]} ~= ${expected[0]}`);
  assert.ok(Math.abs(actual[1] - expected[1]) <= epsilon, `${actual[1]} ~= ${expected[1]}`);
}

{
  const wasm = wasmFactoryModule.instantiateRotateScaleModule();
  const kernelAdapter = wasmAdapterModule.createWasmKernelAdapter({
    memory: wasm.memory,
    exports: wasm.instance.exports
  });
  const arena = shared.createTransformArena(4);
  const eventArena = shared.createEventArena(4);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena, kernelAdapter });
  const panel = runtime.ui.display.frame();
  runtime.ui.display.add_frame(panel, [0, 0, 1, 1]);

  const mesh = panel.add({
    x: [-1, 1, 0],
    y: [-1, -1, 1],
    bounds: [100, 120, 80, 70]
  });
  mesh.add_vertices([0, 1, 2]);
  mesh.add_edges([[0, 1], [1, 2], [2, 0]]);

  const before = mesh.world_points().map((p) => p.slice());
  const origin = mesh.world_inner_point(mesh.origin).slice(0, 2);
  const anchor = mesh.world_point(0).slice(0, 2);
  const cursor = [anchor[0] + 22, anchor[1] - 14];
  const anchorVec = [anchor[0] - origin[0], anchor[1] - origin[1]];
  const cursorVec = [cursor[0] - origin[0], cursor[1] - origin[1]];

  mesh.rotate_scale_at_vertex({
    vertex: 0,
    origo: origin,
    angle: Math.atan2(cursorVec[1], cursorVec[0]) - Math.atan2(anchorVec[1], anchorVec[0]),
    scale: Math.hypot(cursorVec[0], cursorVec[1]) / Math.hypot(anchorVec[0], anchorVec[1])
  });

  assert.notDeepEqual(mesh.world_points(), before);
  assertApproxPoint(mesh.world_point(0).slice(0, 2), cursor);
}

{
  const wasm = wasmFactoryModule.instantiateScaleEdgeModule();
  const kernelAdapter = wasmAdapterModule.createWasmKernelAdapter({
    memory: wasm.memory,
    exports: wasm.instance.exports
  });
  const arena = shared.createTransformArena(4);
  const eventArena = shared.createEventArena(4);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena, kernelAdapter });
  const panel = runtime.ui.display.frame();
  runtime.ui.display.add_frame(panel, [0, 0, 1, 1]);

  const mesh = panel.add({
    x: [-1, 1, 1, -1],
    y: [-1, -1, 1, 1],
    bounds: [100, 120, 80, 70]
  });
  mesh.add_vertices([0, 1, 2, 3]);
  mesh.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]]);

  const edgeA = mesh._parent_point_from_inner([-1, -1, 0]).slice(0, 2);
  const edgeB = mesh._parent_point_from_inner([1, -1, 0]).slice(0, 2);
  const ex = edgeB[0] - edgeA[0];
  const ey = edgeB[1] - edgeA[1];
  const len = Math.sqrt(ex * ex + ey * ey);
  const normal = [-ey / len, ex / len];
  const edgeAnchor = mesh._parent_point_from_inner([0, -1, 0]).slice(0, 2);
  const cursor = [edgeAnchor[0] + normal[0] * 18, edgeAnchor[1] + normal[1] * 18];
  const origin = mesh.world_inner_point(mesh.origin).slice(0, 2);
  const normalAnchor = (edgeAnchor[0] - origin[0]) * normal[0] + (edgeAnchor[1] - origin[1]) * normal[1];
  const scale = ((cursor[0] - origin[0]) * normal[0] + (cursor[1] - origin[1]) * normal[1]) / normalAnchor;

  mesh.scale_edge({
    edge: 0,
    origo: origin,
    scale
  });

  assertApproxPoint(mesh._parent_point_from_inner([0, -1, 0]).slice(0, 2), cursor);
}

{
  const wasm = wasmFactoryModule.instantiateTransformModule();
  const kernelAdapter = wasmAdapterModule.createWasmKernelAdapter({
    memory: wasm.memory,
    exports: wasm.instance.exports
  });
  const arena = shared.createTransformArena(4);
  const eventArena = shared.createEventArena(4);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena, kernelAdapter });
  const panel = runtime.ui.display.frame();
  runtime.ui.display.add_frame(panel, [0, 0, 1, 1]);

  const mesh = panel.add({
    x: [-1, 1, 1, -1],
    y: [-1, -1, 1, 1],
    bounds: [100, 120, 80, 70]
  });
  mesh.add_vertices([0, 1, 2, 3]);
  mesh.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]]);

  const origin = mesh.world_inner_point(mesh.origin).slice(0, 2);
  const anchor = mesh.world_point(0).slice(0, 2);
  const rotateCursor = [anchor[0] + 16, anchor[1] - 10];
  const anchorVec = [anchor[0] - origin[0], anchor[1] - origin[1]];
  const rotateVec = [rotateCursor[0] - origin[0], rotateCursor[1] - origin[1]];
  mesh.rotate_scale_at_vertex({
    vertex: 0,
    origo: origin,
    angle: Math.atan2(rotateVec[1], rotateVec[0]) - Math.atan2(anchorVec[1], anchorVec[0]),
    scale: Math.hypot(rotateVec[0], rotateVec[1]) / Math.hypot(anchorVec[0], anchorVec[1])
  });
  assertApproxPoint(mesh.world_point(0).slice(0, 2), rotateCursor);

  const edgeA = mesh._parent_point_from_inner([-1, -1, 0]).slice(0, 2);
  const edgeB = mesh._parent_point_from_inner([1, -1, 0]).slice(0, 2);
  const ex = edgeB[0] - edgeA[0];
  const ey = edgeB[1] - edgeA[1];
  const len = Math.sqrt(ex * ex + ey * ey);
  const normal = [-ey / len, ex / len];
  const edgeAnchor = mesh._parent_point_from_inner([0, -1, 0]).slice(0, 2);
  const edgeCursor = [edgeAnchor[0] + normal[0] * 14, edgeAnchor[1] + normal[1] * 14];
  const origin2 = mesh.world_inner_point(mesh.origin).slice(0, 2);
  const normalAnchor = (edgeAnchor[0] - origin2[0]) * normal[0] + (edgeAnchor[1] - origin2[1]) * normal[1];
  const scale = ((edgeCursor[0] - origin2[0]) * normal[0] + (edgeCursor[1] - origin2[1]) * normal[1]) / normalAnchor;
  mesh.scale_edge({
    edge: 0,
    origo: origin2,
    scale
  });
  assertApproxPoint(mesh._parent_point_from_inner([0, -1, 0]).slice(0, 2), edgeCursor);
}

{
  const arena = shared.createTransformArena(4);
  const eventArena = shared.createEventArena(4);
  const runtime = vkfUi.createVkfUiRuntime({
    arena,
    eventArena,
    compiledKernelModule: "rect-demo"
  });
  const panel = runtime.ui.display.frame();
  runtime.ui.display.add_frame(panel, [0, 0, 1, 1]);

  const mesh = panel.add({
    x: [-1, 1, 1, -1],
    y: [-1, -1, 1, 1],
    bounds: [100, 120, 80, 70]
  });
  mesh.add_vertices([0, 1, 2, 3]);
  mesh.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]]);

  const origin = mesh.world_inner_point(mesh.origin).slice(0, 2);
  const anchor = mesh.world_point(0).slice(0, 2);
  const cursor = [anchor[0] + 18, anchor[1] - 12];
  const anchorVec = [anchor[0] - origin[0], anchor[1] - origin[1]];
  const cursorVec = [cursor[0] - origin[0], cursor[1] - origin[1]];

  mesh.rotate_scale_at_vertex({
    vertex: 0,
    origo: origin,
    angle: Math.atan2(cursorVec[1], cursorVec[0]) - Math.atan2(anchorVec[1], anchorVec[0]),
    scale: Math.hypot(cursorVec[0], cursorVec[1]) / Math.hypot(anchorVec[0], anchorVec[1])
  });

  assertApproxPoint(mesh.world_point(0).slice(0, 2), cursor);
}

{
  const arena = shared.createTransformArena(2);
  const eventArena = shared.createEventArena(2);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena });
  const adapter = runtime.ui.compiled.create_builtin_wasm_kernel_adapter({ module: "rect-demo" });
  const next = adapter.rotateScaleTransform({
    matrix: [1, 0, 0, 1],
    offset: [10, 20],
    angle: Math.PI / 4,
    scale: 2,
    origo: [0, 0]
  });
  assert.equal(Array.isArray(next.matrix), true);
  assert.equal(Array.isArray(next.offset), true);
}

{
  const arena = shared.createTransformArena(2);
  const eventArena = shared.createEventArena(4);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena, width: 1280, height: 720 });
  const ui = runtime.ui;
  assert.equal(ui.display.width, 1280);
  assert.equal(ui.display.height, 720);
  ui.keyboard.set_mask(5);
  assert.deepEqual(ui.keyboard.modifiers, {
    ctrl: true,
    shift: false,
    alt: true,
    meta: false
  });
  ui.display.set_size({ width: 960, height: 540 });
  assert.equal(ui.display.width, 960);
  assert.equal(ui.display.height, 540);

  const panel = ui.display.frame({ title: "VKF rect" });
  ui.display.add_frame(panel, [0.18, 0.18, 0.42, 0.34]);
  const rect = panel.add_rect([120, 96, 180, 118], {
    color: [0.2, 0.82, 0.49, 1.0]
  });

  eventArena.writeInputSample({
    sequence: 1,
    cursorPx: [150, 116],
    pointerAnchorPx: [120, 96],
    localCursor: [0.5, 0.25],
    localAnchor: [0.1, -0.25],
    pointerDown: true,
    buttons: 1,
    hover: { object: rect.id }
  });

  const originalStringify = JSON.stringify;
  const originalParse = JSON.parse;
  JSON.stringify = function () {
    throw new Error("JSON.stringify must not be used by the VKF UI hot path");
  };
  JSON.parse = function () {
    throw new Error("JSON.parse must not be used by the VKF UI hot path");
  };

  try {
    const e = ui.events.get();
    const target = panel.get(e.hover);
  assert.equal(e.event, ui.MOUSE_DRAG);
  assert.equal(e.hover.object_id, rect.id);
  assert.equal(e.hover.mask, vkfUi.HOVER_OBJECT);
    assert.equal(e.hover.kind, vkfUi.HOVER_OBJECT);
    assert.deepEqual(e.trans, [30, 20]);
    assert.deepEqual(e.local_cursor, [0.5, 0.25]);
    assert.deepEqual(e.local_anchor, [0.1, -0.25]);
    assert.deepEqual(e.local_trans, [0.4, 0.5]);
    assert.equal(e.key_mask, 0);
    assert.equal(target, rect);
    target.translate({ trans: e.trans });
  } finally {
    JSON.stringify = originalStringify;
    JSON.parse = originalParse;
  }

  assert.equal(arena.mat4[rect.slot * shared.MAT4_F32 + 12], 150);
  assert.equal(arena.mat4[rect.slot * shared.MAT4_F32 + 13], 116);
  assert.deepEqual(arena.dirtyRange(), { version: 2, min: 0, max: 0 });
}

{
  const arena = shared.createTransformArena(4);
  const eventArena = shared.createEventArena(4);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena });
  const ui = runtime.ui;
  const panel = ui.display.frame();
  ui.display.add_frame(panel, [0, 0, 1, 1]);

  const parent = panel.add_rect([100, 80, 220, 140], { color: [1, 0, 0, 1] });
  const child = parent.add_rect([40, 30, 100, 70], { color: [0, 1, 0, 1] });
  const leaf = child.add_rect([18, 14, 36, 24], { color: [0, 0, 1, 1] });

  assert.deepEqual(parent.world_rect(), { x: 100, y: 80, w: 220, h: 140 });
  assert.deepEqual(child.world_rect(), { x: 140, y: 110, w: 100, h: 70 });
  assert.deepEqual(leaf.world_rect(), { x: 158, y: 124, w: 36, h: 24 });

  parent.translate({ trans: [10, 20] });

  assert.deepEqual(parent.world_rect(), { x: 110, y: 100, w: 220, h: 140 });
  assert.deepEqual(child.world_rect(), { x: 150, y: 130, w: 100, h: 70 });
  assert.deepEqual(leaf.world_rect(), { x: 168, y: 144, w: 36, h: 24 });
  assert.equal(arena.mat4[parent.slot * shared.MAT4_F32 + 12], 110);
  assert.equal(arena.mat4[child.slot * shared.MAT4_F32 + 12], 150);
  assert.equal(arena.mat4[leaf.slot * shared.MAT4_F32 + 12], 168);
  assert.equal(panel.pick([170, 150]), leaf);
  assert.equal(panel.get({ object_id: child.id }), child);
}

{
  const arena = shared.createTransformArena(1);
  const eventArena = shared.createEventArena(1);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena });
  runtime.ui.cursor.set_mode("open_hand");
  assert.equal(runtime.ui.cursor.mode, "open_hand");
}

{
  const arena = shared.createTransformArena(3);
  const eventArena = shared.createEventArena(1);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena });
  const panel = runtime.ui.display.frame();
  runtime.ui.display.add_frame(panel, [0, 0, 1, 1]);

  const mesh = panel.add({
    x: [0, 1, 0, 0],
    y: [0, 0, 1, 0],
    z: [0, 0, 0, 1]
  });

  mesh.add_vertices([0, 1, 2, 3]);
  mesh.add_edges([[0, 1], [1, 2], [2, 0]]);
  mesh.add_faces([[0, 1, 2]]);
  mesh.add_volumes([[0, 1, 2]]);
  mesh.add_volumes([[0, 1, 2, 3]]);

  assert.deepEqual(mesh.coords.x, [0, 1, 0, 0]);
  assert.deepEqual(mesh.vertices, [0, 1, 2, 3]);
  assert.deepEqual(mesh.edges, [[0, 1], [1, 2], [2, 0]]);
  assert.deepEqual(mesh.faces, [[0, 1, 2]]);
  assert.deepEqual(mesh.volumes, [[0, 1, 2, 3]]);
  assert.equal(mesh.volume_policy, "filled");
  assert.equal(panel.get({ object_id: mesh.id }), mesh);
}

{
  const arena = shared.createTransformArena(4);
  const eventArena = shared.createEventArena(4);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena });
  const ui = runtime.ui;
  const panel = ui.display.frame();
  ui.display.add_frame(panel, [0, 0, 1, 1]);

  const mesh = panel.add({
    x: [0, 10, 20],
    y: [0, 0, 0],
    normalized: false
  });
  mesh.add_vertices([0, 1, 2]);
  mesh.add_edges([[0, 1], [1, 2]]);
  assert.equal(ui.selection, undefined);
  eventArena.writeInputSample({
    hover: { object: mesh.id, vertex: 1 }
  });
  const e = ui.events.get();
  assert.equal(e.hover.object_id, mesh.id);
  assert.equal(e.hover.vertex_id, 1);
  assert.equal(e.hover.kind, vkfUi.HOVER_VERTEX);
  const target = panel.get(e.hover);
  target.move_vertex({ vertex: e.hover.vertex_id, local_trans: [2, 3] });
  assert.deepEqual(mesh.coords.x, [0, 12, 20]);
  assert.deepEqual(mesh.coords.y, [0, 3, 0]);
}

{
  const arena = shared.createTransformArena(4);
  const geometryArena = shared.createGeometryArena(16);
  const eventArena = shared.createEventArena(4);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena, geometryArena });
  const panel = runtime.ui.display.frame();
  runtime.ui.display.add_frame(panel, [0, 0, 1, 1]);

  const mesh = panel.add(
    {
      x: [-1, 1, 0],
      y: [-1, -1, 1],
      bounds: [100, 120, 80, 70]
    },
    {
      face_color: [0.8, 0.5, 0.2, 1],
      edge_color: [0.1, 0.9, 0.9, 1],
      vertex_color: [1, 0.2, 0.7, 1],
      volume_color: [0.4, 0.4, 1, 1],
      vertex_radius: 10,
      edge_radius: 6
    }
  );
  mesh.add_vertices([0, 1, 2]);
  mesh.add_edges([[0, 1], [1, 2], [2, 0]]);
  mesh.add_faces([[0, 1, 2]]);
  assert.equal(mesh.geometry_offset, 0);
  assert.deepEqual(geometryArena.vertex(mesh.geometry_offset + 0), [-1, -1, 0]);
  assert.deepEqual(geometryArena.vertex(mesh.geometry_offset + 1), [1, -1, 0]);
  geometryArena.consumeDirtyRange();

  assert.equal(mesh.vertex_radius, 10);
  assert.equal(mesh.edge_radius, 6);
  assert.equal(mesh.vertex_pick_radius, 10);
  assert.equal(mesh.edge_pick_radius, 6);
  assert.deepEqual(mesh.face_color, [0.8, 0.5, 0.2, 1]);
  assert.deepEqual(mesh.edge_color, [0.1, 0.9, 0.9, 1]);
  assert.deepEqual(mesh.vertex_color, [1, 0.2, 0.7, 1]);
  assert.deepEqual(mesh.volume_color, [0.4, 0.4, 1, 1]);
  assert.deepEqual(mesh.visible_volume_surfaces(), {
    policy: "filled",
    surfaces: "first_last_per_dimension"
  });
  assert.deepEqual(mesh.initial_bounds, { x: -1, y: -1, w: 2, h: 2 });
  const defaultOverlay = panel.add({ x: [240, 260], y: [220, 240], normalized: false });
  assert.equal(defaultOverlay.vertex_radius, 4);
  assert.equal(defaultOverlay.edge_radius, 2);
  assert.equal(defaultOverlay.vertex_pick_radius, 5);
  assert.equal(defaultOverlay.edge_pick_radius, 5);
  defaultOverlay.set_overlay({ vertex_width: 7, edge_width: 3 });
  assert.equal(defaultOverlay.vertex_radius, 7);
  assert.equal(defaultOverlay.edge_radius, 3);
  assert.equal(defaultOverlay.vertex_pick_radius, 7);
  assert.equal(defaultOverlay.edge_pick_radius, 5);
  defaultOverlay.set_overlay({ edge_pick_radius: 9 });
  assert.equal(defaultOverlay.edge_pick_radius, 9);
  defaultOverlay.add_vertices([0, 1]);
  defaultOverlay.add_edges([[0, 1]]);
  assert.equal(panel.pick([240, 224]).hover.vertex_id, 0);
  assert.equal(panel.pick([250, 225]).hover.edge_id, 0);
  assert.deepEqual(mesh.world_point(1), [180, 190, 0]);
  assert.deepEqual(panel.pick([100, 190]).hover, {
    object_id: mesh.id,
    vertex_id: 0,
    edge_id: -1,
    face_id: -1,
    mask: 9,
    kind: vkfUi.HOVER_VERTEX
  });
  assert.deepEqual(panel.pick([140, 190]).hover, {
    object_id: mesh.id,
    vertex_id: -1,
    edge_id: 0,
    face_id: -1,
    mask: 5,
    kind: vkfUi.HOVER_EDGE
  });
  assert.deepEqual(panel.pick([140, 160]).hover, {
    object_id: mesh.id,
    vertex_id: -1,
    edge_id: -1,
    face_id: 0,
    mask: 3,
    kind: vkfUi.HOVER_FACE
  });

  const dataBeforeTransform = {
    x: mesh.coords.x.slice(),
    y: mesh.coords.y.slice(),
    z: mesh.coords.z.slice()
  };
  const beforeVertex = mesh.world_points().map((p) => p.slice());
  const originBeforeVertex = mesh.world_inner_point(mesh.origin).slice(0, 2);
  const offsetBeforeVertex = mesh.offset.slice();
  const anchor = mesh.world_point(0);
  const cursor = [anchor[0] + 18, anchor[1] - 12];
  const originForRotate = mesh.world_inner_point(mesh.origin);
  const anchorVec0 = [anchor[0] - originForRotate[0], anchor[1] - originForRotate[1]];
  const cursorVec = [cursor[0] - originForRotate[0], cursor[1] - originForRotate[1]];
  mesh.rotate_scale_at_vertex({
    vertex: 0,
    origo: originForRotate.slice(0, 2),
    angle: Math.atan2(cursorVec[1], cursorVec[0]) - Math.atan2(anchorVec0[1], anchorVec0[0]),
    scale: Math.hypot(cursorVec[0], cursorVec[1]) / Math.hypot(anchorVec0[0], anchorVec0[1])
  });
  assert.notDeepEqual(mesh.world_points(), beforeVertex);
  assert.deepEqual(mesh.offset, offsetBeforeVertex);
  assert.deepEqual(mesh.world_inner_point(mesh.origin).slice(0, 2).map(Math.round), originBeforeVertex.map(Math.round));
  assert.deepEqual(mesh.world_point(0).slice(0, 2).map(Math.round), cursor);
  assert.deepEqual(mesh.coords, dataBeforeTransform);

  const beforeEdge = mesh.world_points().map((p) => p.slice());
  const originBeforeEdge = mesh.world_inner_point(mesh.origin).slice(0, 2);
  const offsetBeforeEdge = mesh.offset.slice();
  const edgeA = mesh._parent_point_from_inner([-1, -1, 0]).slice(0, 2);
  const edgeB = mesh._parent_point_from_inner([1, -1, 0]).slice(0, 2);
  const edgeEx = edgeB[0] - edgeA[0];
  const edgeEy = edgeB[1] - edgeA[1];
  const edgeLen = Math.sqrt(edgeEx * edgeEx + edgeEy * edgeEy);
  const edgeNormal = [-edgeEy / edgeLen, edgeEx / edgeLen];
  const edgeAnchor = mesh._parent_point_from_inner([0, -1, 0]).slice(0, 2);
  const edgeCursor = [edgeAnchor[0] + edgeNormal[0] * 18, edgeAnchor[1] + edgeNormal[1] * 18];
  const originForScale = mesh.world_inner_point(mesh.origin).slice(0, 2);
  const normalAnchor = (edgeAnchor[0] - originForScale[0]) * edgeNormal[0] + (edgeAnchor[1] - originForScale[1]) * edgeNormal[1];
  const scaleEdge = ((edgeCursor[0] - originForScale[0]) * edgeNormal[0] + (edgeCursor[1] - originForScale[1]) * edgeNormal[1]) / normalAnchor;
  mesh.scale_edge({
    edge: 0,
    origo: originForScale,
    scale: scaleEdge
  });
  assert.notDeepEqual(mesh.world_points(), beforeEdge);
  assertApproxPoint(mesh._parent_point_from_inner([0, -1, 0]).slice(0, 2), edgeCursor);
  assert.deepEqual(mesh.coords, dataBeforeTransform);

  const originBeforeTranslate = mesh.world_inner_point(mesh.origin).slice(0, 2);
  mesh.translate({ trans: [7, -4] });
  assert.deepEqual(mesh.world_inner_point(mesh.origin).slice(0, 2).map(Math.round), [
    Math.round(originBeforeTranslate[0] + 7),
    Math.round(originBeforeTranslate[1] - 4)
  ]);
  assert.deepEqual(mesh.coords, dataBeforeTransform);
  geometryArena.consumeDirtyRange();

  const coordsBeforeVertexEdit = {
    x: mesh.coords.x.slice(),
    y: mesh.coords.y.slice(),
    z: mesh.coords.z.slice()
  };
  const transformOffsetBeforeVertexEdit = mesh.offset.slice();
  const geometryVersionBeforeVertexEdit = mesh.geometry_version;
  const editCursor = [mesh._parent_point_from_inner([-1, -1, 0])[0] + 12, mesh._parent_point_from_inner([-1, -1, 0])[1] + 6];
  mesh.move_vertex({ vertex: 0, local_cursor: editCursor });
  assert.equal(mesh.geometry_version, geometryVersionBeforeVertexEdit + 1);
  assert.deepEqual(mesh.offset, transformOffsetBeforeVertexEdit);
  assert.notDeepEqual(mesh.coords.x, coordsBeforeVertexEdit.x);
  assert.notDeepEqual(mesh.coords.y, coordsBeforeVertexEdit.y);
  assertApproxPoint(mesh._parent_point_from_inner([mesh.coords.x[0], mesh.coords.y[0], mesh.coords.z[0]]).slice(0, 2), editCursor);
  assert.deepEqual(mesh.edges, [[0, 1], [1, 2], [2, 0]]);
  assert.deepEqual(mesh.faces, [[0, 1, 2]]);
  let geometryDirty = geometryArena.copyDirtyVertices();
  assert.equal(geometryDirty.range.min, mesh.geometry_offset + 0);
  assert.equal(geometryDirty.range.max, mesh.geometry_offset + 0);
  assert.deepEqual(Array.from(geometryDirty.data), [mesh.coords.x[0], mesh.coords.y[0], mesh.coords.z[0]]);

  const edgeCoordsBefore = {
    x0: mesh.coords.x[0],
    y0: mesh.coords.y[0],
    x1: mesh.coords.x[1],
    y1: mesh.coords.y[1],
    x2: mesh.coords.x[2],
    y2: mesh.coords.y[2]
  };
  const geometryVersionBeforeEdgeEdit = mesh.geometry_version;
  const edgeMove = [9, -7];
  const edge0Before = mesh._parent_point_from_inner([mesh.coords.x[0], mesh.coords.y[0], mesh.coords.z[0]]).slice(0, 2);
  const edge1Before = mesh._parent_point_from_inner([mesh.coords.x[1], mesh.coords.y[1], mesh.coords.z[1]]).slice(0, 2);
  mesh.translate_edge({ edge: 0, local_trans: edgeMove });
  assert.equal(mesh.geometry_version, geometryVersionBeforeEdgeEdit + 1);
  assert.deepEqual(mesh.offset, transformOffsetBeforeVertexEdit);
  assertApproxPoint(mesh._parent_point_from_inner([mesh.coords.x[0], mesh.coords.y[0], mesh.coords.z[0]]).slice(0, 2), [edge0Before[0] + edgeMove[0], edge0Before[1] + edgeMove[1]]);
  assertApproxPoint(mesh._parent_point_from_inner([mesh.coords.x[1], mesh.coords.y[1], mesh.coords.z[1]]).slice(0, 2), [edge1Before[0] + edgeMove[0], edge1Before[1] + edgeMove[1]]);
  assert.notEqual(mesh.coords.x[0], edgeCoordsBefore.x0);
  assert.notEqual(mesh.coords.y[0], edgeCoordsBefore.y0);
  assert.notEqual(mesh.coords.x[1], edgeCoordsBefore.x1);
  assert.notEqual(mesh.coords.y[1], edgeCoordsBefore.y1);
  assert.equal(mesh.coords.x[2], edgeCoordsBefore.x2);
  assert.equal(mesh.coords.y[2], edgeCoordsBefore.y2);
  assert.deepEqual(mesh.edges, [[0, 1], [1, 2], [2, 0]]);
  assert.deepEqual(mesh.faces, [[0, 1, 2]]);
  geometryDirty = geometryArena.copyDirtyVertices();
  assert.equal(geometryDirty.range.min, mesh.geometry_offset + 0);
  assert.equal(geometryDirty.range.max, mesh.geometry_offset + 1);
  assert.deepEqual(Array.from(geometryDirty.data), [
    mesh.coords.x[0], mesh.coords.y[0], mesh.coords.z[0],
    mesh.coords.x[1], mesh.coords.y[1], mesh.coords.z[1]
  ]);

  const childMesh = mesh.add({
    x: [-0.5, 0.5, 0],
    y: [-0.5, -0.4, 0.5],
    face_color: [1, 1, 1, 1],
    edge_color: [1, 1, 1, 1],
    vertex_color: [1, 1, 1, 1],
    vertex_radius: 4,
    edge_radius: 4
  });
  childMesh.add_vertices([0, 1, 2]);
  childMesh.add_edges([[0, 1], [1, 2], [2, 0]]);
  childMesh.add_faces([[0, 1, 2]]);
  assert.deepEqual(childMesh.offset.slice(0, 2), [0, 0]);
  const expectedChildPoint = mesh.world_inner_point([-0.5, -0.5, 0]).slice(0, 2);
  assert.deepEqual(childMesh.world_point(0).slice(0, 2).map(Math.round), expectedChildPoint.map(Math.round));
  const childBefore = childMesh.world_point(0).slice(0, 2);
  mesh.translate({ trans: [11, 13] });
  assert.deepEqual(childMesh.world_point(0).slice(0, 2).map(Math.round), [
    Math.round(childBefore[0] + 11),
    Math.round(childBefore[1] + 13)
  ]);
  const childMatOffset = childMesh.slot * shared.MAT4_F32;
  const childOriginWorld = childMesh.world_inner_point([0, 0, 0]).slice(0, 2);
  assert.deepEqual([
    Math.round(arena.mat4[childMatOffset + 12]),
    Math.round(arena.mat4[childMatOffset + 13])
  ], childOriginWorld.map(Math.round));
}

{
  const arena = shared.createTransformArena(4);
  const eventArena = shared.createEventArena(4);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena });
  const panel = runtime.ui.display.frame();
  runtime.ui.display.add_frame(panel, [0, 0, 1, 1]);

  const mesh = panel.add(
    {
      x: [0, 1, 2],
      y: [0, 1, 0],
      edge_style: "dashed",
      edge_unit_length: 12,
      vertex_style: "disc",
      vertex_radius_vector: [2, 3],
      vertex_radius_2: 8,
      edge_width_vector: [4],
      edge_width_2: 10
    },
    {
      vertex_radius: 6,
      edge_width: 5,
      vertex_radius_1: 7,
      edge_width_1: 9
    }
  );
  mesh.add_vertices([0, 1, 2]);
  mesh.add_edges([[0, 1], [1, 2], [2, 0]]);

  assert.equal(mesh.edge_style, "dashed");
  assert.equal(mesh.edge_unit_length, 12);
  assert.equal(mesh.vertex_style, "disc");
  assert.deepEqual(mesh.vertex_radius_values, [2, 7, 8]);
  assert.deepEqual(mesh.edge_width_values, [4, 9, 10]);
  assert.equal(mesh.vertex_radius_at(0), 2);
  assert.equal(mesh.vertex_radius_at(1), 7);
  assert.equal(mesh.vertex_radius_at(2), 8);
  assert.equal(mesh.vertex_radius_at(99), 6);
  assert.equal(mesh.edge_width_at(0), 4);
  assert.equal(mesh.edge_width_at(1), 9);
  assert.equal(mesh.edge_width_at(2), 10);
  assert.equal(mesh.edge_width_at(99), 5);
  assert.equal(mesh.edge_radius_at(1), 9);

  mesh.set_overlay({
    edge_style: "solid",
    edge_unit_length: 3,
    vertex_style: "square",
    vertex_radius_vector: [11],
    vertex_radius_2: 13,
    edge_width_vector: [14],
    edge_width_2: 16
  });
  assert.equal(mesh.edge_style, "solid");
  assert.equal(mesh.edge_unit_length, 3);
  assert.equal(mesh.vertex_style, "square");
  assert.deepEqual(mesh.vertex_radius_values, [11, undefined, 13]);
  assert.deepEqual(mesh.edge_width_values, [14, undefined, 16]);
  assert.equal(mesh.vertex_radius_at(1), 6);
  assert.equal(mesh.vertex_radius_at(2), 13);
  assert.equal(mesh.edge_width_at(1), 5);
  assert.equal(mesh.edge_width_at(2), 16);
}

{
  const arena = shared.createTransformArena(6);
  const eventArena = shared.createEventArena(4);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena });
  const panel = runtime.ui.display.frame();
  runtime.ui.display.add_frame(panel, [0, 0, 1, 1]);

  const system = panel.add({
    x: [1, 2, 3],
    y: [4, 5, 6],
    z: [7, 8, 9],
    pos_i: [[1, 4, 7], [2, 5, 8], [3, 6, 9]],
    temp_i: [0.1, 0.2, 0.3],
    base_color_i: [[0, 0, 1, 1], [0, 1, 0, 1], [1, 0, 0, 1]],
    hit_i: [false, true, false],
    normalized: false
  });

  system.add_simplices({
    edges: [[0, 1], [1, 2]],
    faces: [[0, 1, 2]]
  });
  assert.deepEqual(system.vertices, [0, 1, 2]);
  assert.deepEqual(system.edges, [[0, 1], [1, 2]]);
  assert.deepEqual(system.faces, [[0, 1, 2]]);
  assert.deepEqual(system.prop("pos_i"), [[1, 4, 7], [2, 5, 8], [3, 6, 9]]);
  assert.deepEqual(system.prop("temp_i"), [0.1, 0.2, 0.3]);
  assert.deepEqual(system.prop("hit_i"), [false, true, false]);

  system.set_prop("hit_phase_i", [0, 0.5, 0]);
  assert.deepEqual(system.prop("hit_phase_i"), [0, 0.5, 0]);

  system.add_projection({
    pos: "pos_i",
    color: "base_color_i",
    temp: "temp_i"
  });
  assert.deepEqual(system.projections[0], {
    pos: "pos_i",
    color: "base_color_i",
    temp: "temp_i"
  });

  system.add_embedding({
    pos: "pos",
    color: "color",
    visible: "hit_i"
  });
  assert.deepEqual(system.embeddings[0], {
    pos: "pos",
    color: "color",
    visible: "hit_i"
  });
  assert.throws(
    () => system.add_embedding({ temperature: "temp_i" }),
    /canonical render attr/
  );
}

{
  const arena = shared.createTransformArena(8);
  const eventArena = shared.createEventArena(4);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena });
  const panel = runtime.ui.display.frame();
  runtime.ui.display.add_frame(panel, [0, 0, 1, 1]);

  const root = panel.add({
    x: [-1, 1, 1, -1],
    y: [-1, -1, 1, 1],
    bounds: [100, 80, 200, 160],
    origin: [0, 0, 0]
  });
  root.add_vertices([0, 1, 2, 3]);
  root.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]]);
  root.add_faces([[0, 1, 2, 3]]);
  const rootOrigin = root.world_inner_point(root.origin);
  const rootVertexStart = root.world_point(1);
  const rootCursor = [320, 250];
  const rootStart = [rootVertexStart[0] - rootOrigin[0], rootVertexStart[1] - rootOrigin[1]];
  const rootCurrent = [rootCursor[0] - rootOrigin[0], rootCursor[1] - rootOrigin[1]];
  root.rotate_scale_at_vertex({
    vertex: 1,
    origo: rootOrigin.slice(0, 2),
    angle: Math.atan2(rootCurrent[1], rootCurrent[0]) - Math.atan2(rootStart[1], rootStart[0]),
    scale: Math.hypot(rootCurrent[0], rootCurrent[1]) / Math.hypot(rootStart[0], rootStart[1])
  });

  const child = root.add({
    x: [-0.5, 0.5, 0.5, -0.5],
    y: [-0.5, -0.5, 0.5, 0.5],
    origin: [0, 0, 0]
  });
  child.add_vertices([0, 1, 2, 3]);
  child.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]]);
  child.add_faces([[0, 1, 2, 3]]);

  const vertexBefore = child._parent_point_from_inner([0.5, -0.5, 0]).slice(0, 2);
  const vertexCursor = [vertexBefore[0] + 0.2, vertexBefore[1] - 0.35];
  const childVertexRef = child._parent_point_from_inner([0.5, -0.5, 0]);
  const childOrigin = child._parent_point_from_inner(child.origin);
  const childStart = [childVertexRef[0] - childOrigin[0], childVertexRef[1] - childOrigin[1]];
  const childCurrent = [vertexCursor[0] - childOrigin[0], vertexCursor[1] - childOrigin[1]];
  child.rotate_scale_at_vertex({
    vertex: 1,
    origo: childOrigin.slice(0, 2),
    angle: Math.atan2(childCurrent[1], childCurrent[0]) - Math.atan2(childStart[1], childStart[0]),
    scale: Math.hypot(childCurrent[0], childCurrent[1]) / Math.hypot(childStart[0], childStart[1])
  });
  assertApproxPoint(child._parent_point_from_inner([0.5, -0.5, 0]).slice(0, 2), vertexCursor);

  const rightEdgeA = child._parent_point_from_inner([0.5, -0.5, 0]).slice(0, 2);
  const rightEdgeB = child._parent_point_from_inner([0.5, 0.5, 0]).slice(0, 2);
  const rightEx = rightEdgeB[0] - rightEdgeA[0];
  const rightEy = rightEdgeB[1] - rightEdgeA[1];
  const rightLen = Math.sqrt(rightEx * rightEx + rightEy * rightEy);
  const rightNormal = [rightEy / rightLen, -rightEx / rightLen];
  const rightEdgeAnchor = child._parent_point_from_inner([0.5, 0, 0]).slice(0, 2);
  const rightEdgeCursor = [rightEdgeAnchor[0] + rightNormal[0] * 0.22, rightEdgeAnchor[1] + rightNormal[1] * 0.22];
  const rightOrigin = child._parent_point_from_inner(child.origin).slice(0, 2);
  const rightNormalAnchor = (rightEdgeAnchor[0] - rightOrigin[0]) * rightNormal[0] + (rightEdgeAnchor[1] - rightOrigin[1]) * rightNormal[1];
  const rightScale = ((rightEdgeCursor[0] - rightOrigin[0]) * rightNormal[0] + (rightEdgeCursor[1] - rightOrigin[1]) * rightNormal[1]) / rightNormalAnchor;
  child.scale_edge({
    edge: 1,
    origo: rightOrigin,
    scale: rightScale
  });
  assertApproxPoint(child._parent_point_from_inner([0.5, 0, 0]).slice(0, 2), rightEdgeCursor);

  const bottomEdgeA = child._parent_point_from_inner([-0.5, -0.5, 0]).slice(0, 2);
  const bottomEdgeB = child._parent_point_from_inner([0.5, -0.5, 0]).slice(0, 2);
  const bottomEx = bottomEdgeB[0] - bottomEdgeA[0];
  const bottomEy = bottomEdgeB[1] - bottomEdgeA[1];
  const bottomLen = Math.sqrt(bottomEx * bottomEx + bottomEy * bottomEy);
  const bottomNormal = [-bottomEy / bottomLen, bottomEx / bottomLen];
  const bottomEdgeAnchor = child._parent_point_from_inner([0, -0.5, 0]).slice(0, 2);
  const bottomEdgeCursor = [bottomEdgeAnchor[0] + bottomNormal[0] * 0.18, bottomEdgeAnchor[1] + bottomNormal[1] * 0.18];
  const bottomOrigin = child._parent_point_from_inner(child.origin).slice(0, 2);
  const bottomNormalAnchor = (bottomEdgeAnchor[0] - bottomOrigin[0]) * bottomNormal[0] + (bottomEdgeAnchor[1] - bottomOrigin[1]) * bottomNormal[1];
  const bottomScale = ((bottomEdgeCursor[0] - bottomOrigin[0]) * bottomNormal[0] + (bottomEdgeCursor[1] - bottomOrigin[1]) * bottomNormal[1]) / bottomNormalAnchor;
  child.scale_edge({
    edge: 0,
    origo: bottomOrigin,
    scale: bottomScale
  });
  assertApproxPoint(child._parent_point_from_inner([0, -0.5, 0]).slice(0, 2), bottomEdgeCursor);
}

{
  const arena = shared.createTransformArena(4);
  const eventArena = shared.createEventArena(4);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena });
  const panel = runtime.ui.display.frame();
  runtime.ui.display.add_frame(panel, [0, 0, 1, 1]);

  const mesh = panel.add({
    x: [-1, 1, 1, -1],
    y: [-1, -1, 1, 1],
    bounds: [100, 100, 100, 100],
    origin: [0, 0, 0]
  });
  mesh.add_vertices([0, 1, 2, 3]);
  mesh.add_edges([[0, 1], [1, 2], [2, 3], [3, 0]]);
  mesh.add_faces([[0, 1, 2, 3]]);

  const bottomBefore = mesh._parent_point_from_inner([0, -1, 0]).slice(0, 2);
  const origin = mesh._parent_point_from_inner([0, 0, 0]).slice(0, 2);
  const bottomDist = [bottomBefore[0] - origin[0], bottomBefore[1] - origin[1]];
  const flippedCursor = [origin[0] - bottomDist[0] * 0.6, origin[1] - bottomDist[1] * 0.6];
  const flipNormal = [bottomBefore[0] - origin[0], bottomBefore[1] - origin[1]];
  const normalLen = Math.sqrt(flipNormal[0] * flipNormal[0] + flipNormal[1] * flipNormal[1]) || 1;
  const flipNormalUnit = [flipNormal[0] / normalLen, flipNormal[1] / normalLen];
  const normalBase = flipNormal[0] * flipNormalUnit[0] + flipNormal[1] * flipNormalUnit[1];
  const normalFlipped = (flippedCursor[0] - origin[0]) * flipNormalUnit[0] + (flippedCursor[1] - origin[1]) * flipNormalUnit[1];
  mesh.scale_edge({
    edge: 0,
    origo: origin,
    scale: normalFlipped / normalBase
  });
  const bottomAfter = mesh._parent_point_from_inner([0, -1, 0]).slice(0, 2);
  assertApproxPoint(bottomAfter, flippedCursor);
  assert.ok(
    (bottomBefore[1] - origin[1]) * (bottomAfter[1] - origin[1]) < 0,
    "edge crossed to the opposite side of the origin"
  );
}

{
  const memory = { buffer: new ArrayBuffer(64 * Float64Array.BYTES_PER_ELEMENT) };
  const calls = [];
  const kernelAdapter = wasmAdapterModule.createWasmKernelAdapter({
    memory,
    exports: {
      [WASM_EXPORTS.moveVertexToLocalCursor](state) {
        calls.push(["moveVertex", state.vertex, state.localCursor.slice()]);
        return {
          x: [-2, 3, 1],
          y: [-1, 2, 4],
          z: [0, 0, 0]
        };
      },
      [WASM_EXPORTS.pickVertexIndex](ptr) {
        const view = new Float64Array(memory.buffer);
        calls.push(["pickVertex", ptr, view[2]]);
        view[3 + Number(view[2]) * 3] = 1;
      }
    }
  });

  const arena = shared.createTransformArena(4);
  const geometryArena = shared.createGeometryArena(16);
  const eventArena = shared.createEventArena(4);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena, geometryArena, kernelAdapter });
  const panel = runtime.ui.display.frame();
  runtime.ui.display.add_frame(panel, [0, 0, 1, 1]);

  const mesh = panel.add({
    x: [-1, 0, 1],
    y: [0, 1, 0],
    bounds: [100, 100, 100, 100]
  });
  mesh.add_vertices([0, 1, 2]);
  mesh.add_edges([[0, 1], [1, 2]]);
  mesh.add_faces([[0, 1, 2]]);

  const picked = panel.pick([150, 150]);
  assert.equal(picked.object, mesh);
  assert.equal(picked.hover.vertex_id, 1);

  mesh.move_vertex({ vertex: 1, local_cursor: [3, 2] });
  assert.deepEqual(mesh.coords.x, [-2, 3, 1]);
  assert.deepEqual(mesh.coords.y, [-1, 2, 4]);
  assert.deepEqual(geometryArena.vertex(mesh.geometry_offset + 1), [3, 2, 0]);
  assert.deepEqual(calls, [
    ["pickVertex", 0, 3],
    ["moveVertex", 1, [3, 2]]
  ]);
}

{
  const arena = shared.createTransformArena(1);
  const eventArena = shared.createEventArena(1);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena });
  const compiled = runtime.ui.compiled.load_wasm_runtime({
    manifest: {
      runtime_surface: {
        state_ptr_export: "vkf_state_ptr",
        state_size_export: "vkf_state_size",
        input_ptr_export: "vkf_input_ptr",
        input_size_export: "vkf_input_size",
        init_export: "vkf_init",
        update_export: "vkf_update",
        shutdown_export: "vkf_shutdown",
        state_fields: [{ name: "value", offset: 0, type: "num" }],
        input_fields: [{ name: "value", offset: 0, type: "num" }]
      }
    },
    bytes: buildCompiledScalarRuntimeModuleBytes(3)
  });
  compiled.init();
  compiled.writeState({ value: 10 });
  compiled.writeInput({ value: 5 });
  compiled.update();
  assert.deepEqual(compiled.readState(), { value: 18 });
  assert.deepEqual(compiled.stateLayout().fields, [{ name: "value", offset: 0, type: "num" }]);
  assert.deepEqual(compiled.inputLayout().fields, [{ name: "value", offset: 0, type: "num" }]);
}

{
  const arena = shared.createTransformArena(1);
  const eventArena = shared.createEventArena(1);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena });
  const compiled = runtime.ui.compiled.load_wasm_runtime({
    manifest: {
      runtime_surface: {
        update_mode: "axis_vector_vector",
        state_ptr_export: "vkf_state_ptr",
        state_size_export: "vkf_state_size",
        input_ptr_export: "vkf_input_ptr",
        input_size_export: "vkf_input_size",
        init_export: "vkf_init",
        update_export: "vkf_update",
        shutdown_export: "vkf_shutdown",
        state_axis_key: "u",
        state_axis_length: 3,
        input_axis_key: "u",
        input_axis_length: 3
      }
    },
    bytes: buildCompiledAxisVectorRuntimeModuleBytes([1, 2, 3])
  });
  compiled.init();
  assert.deepEqual(compiled.readState(), { values: [1, 2, 3] });
  compiled.writeState({ values: [10, 20, 30] });
  compiled.writeInput({ values: [5, 6, 7] });
  compiled.update();
  assert.deepEqual(compiled.readState(), { values: [16, 28, 40] });
  assert.deepEqual(compiled.readInput(), { values: [5, 6, 7] });
  assert.equal(compiled.stateLayout().axisKey, "u");
  assert.equal(compiled.stateLayout().axisLength, 3);
  assert.equal(compiled.inputLayout().axisKey, "u");
  assert.equal(compiled.inputLayout().axisLength, 3);
}

{
  const arena = shared.createTransformArena(1);
  const eventArena = shared.createEventArena(1);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena });
  const compiled = runtime.ui.compiled.load_wasm_runtime({
    manifest: {
      runtime_surface: {
        update_mode: "record",
        state_ptr_export: "vkf_state_ptr",
        state_size_export: "vkf_state_size",
        input_ptr_export: "vkf_input_ptr",
        input_size_export: "vkf_input_size",
        init_export: "vkf_init",
        update_export: "vkf_update",
        shutdown_export: "vkf_shutdown",
        state_fields: [
          { name: "count", offset: 0, type: "num" },
          { name: "values", offset: 4, type: "axis<u>:list<num>", axis_key: "u", axis_length: 3 }
        ],
        input_fields: [
          { name: "delta", offset: 0, type: "num" },
          { name: "offsets", offset: 4, type: "axis<u>:list<num>", axis_key: "u", axis_length: 3 }
        ]
      }
    },
    bytes: buildCompiledMixedRuntimeModuleBytes([1, 2, 3])
  });
  compiled.init();
  compiled.writeState({ count: 10, values: { values: [100, 200, 300] } });
  compiled.writeInput({ delta: 5, offsets: { values: [7, 8, 9] } });
  compiled.update();
  assert.deepEqual(compiled.readState(), { count: 15, values: { values: [108, 210, 312] } });
  assert.deepEqual(compiled.readInput(), { delta: 5, offsets: { values: [7, 8, 9] } });
}

{
  const arena = shared.createTransformArena(1);
  const eventArena = shared.createEventArena(1);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena });
  const compiled = runtime.ui.compiled.load_wasm_runtime({
    manifest: {
      runtime_surface: {
        update_mode: "record",
        state_ptr_export: "vkf_state_ptr",
        state_size_export: "vkf_state_size",
        input_ptr_export: "vkf_input_ptr",
        input_size_export: "vkf_input_size",
        init_export: "vkf_init",
        update_export: "vkf_update",
        shutdown_export: "vkf_shutdown",
        state_fields: [
          { name: "phase", offset: 0, type: "f64", storage: "f64" },
          { name: "wave", offset: 8, type: "axis<u>:list<f64>", storage: "f64", axis_key: "u", axis_length: 3 }
        ],
        input_fields: [
          { name: "delta", offset: 0, type: "f64", storage: "f64" },
          { name: "offsets", offset: 8, type: "axis<u>:list<f64>", storage: "f64", axis_key: "u", axis_length: 3 }
        ]
      }
    },
    bytes: buildCompiledFloatBufferRuntimeModuleBytes(32, 32)
  });
  compiled.writeState({ phase: 0.25, wave: { values: [0.0, 0.5, 1.0] } });
  compiled.writeInput({ delta: 1.25, offsets: { values: [1.5, 2.5, 3.5] } });
  assert.deepEqual(compiled.readState(), { phase: 0.25, wave: { values: [0.0, 0.5, 1.0] } });
  assert.deepEqual(compiled.readInput(), { delta: 1.25, offsets: { values: [1.5, 2.5, 3.5] } });
}

{
  const arena = shared.createTransformArena(1);
  const eventArena = shared.createEventArena(1);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena });
  const spec = runtime.ui.compiled.create_webgpu_runtime_spec({
    manifest: {
      shader_entry: "vkf_update",
      runtime_surface: {
        state_binding: 0,
        input_binding: 1,
        state_fields: [
          { name: "count", offset: 0, type: "num" },
          { name: "total", offset: 4, type: "num" }
        ],
        input_fields: [
          { name: "delta", offset: 0, type: "num" },
          { name: "bias", offset: 4, type: "num" }
        ]
      }
    },
    wgsl: "@compute @workgroup_size(1)\nfn vkf_update() {}"
  });
  assert.equal(spec.entryPoint, "vkf_update");
  assert.equal(spec.stateBinding, 0);
  assert.equal(spec.inputBinding, 1);
  assert.deepEqual(Array.from(spec.encodeState({ count: 10, total: 100 })), [10, 0, 0, 0, 100, 0, 0, 0]);
  assert.deepEqual(Array.from(spec.encodeInput({ delta: 5, bias: 7 })), [5, 0, 0, 0, 7, 0, 0, 0]);
}

{
  const arena = shared.createTransformArena(1);
  const eventArena = shared.createEventArena(1);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena });
  const spec = runtime.ui.compiled.create_webgpu_runtime_spec({
    manifest: {
      shader_entry: "vkf_update",
      runtime_surface: {
        state_binding: 0,
        input_binding: 1,
        state_fields: [
          { name: "phase", offset: 0, type: "f64", storage: "f64" },
          { name: "wave", offset: 8, type: "axis<u>:list<f64>", storage: "f64", axis_key: "u", axis_length: 3 }
        ],
        input_fields: [
          { name: "delta", offset: 0, type: "f64", storage: "f64" },
          { name: "offsets", offset: 8, type: "axis<u>:list<f64>", storage: "f64", axis_key: "u", axis_length: 3 }
        ]
      }
    },
    wgsl: "@compute @workgroup_size(1)\nfn vkf_update() {}"
  });
  assert.deepEqual(Array.from(new Float64Array(spec.encodeState({ phase: 0.25, wave: { values: [0.0, 0.5, 1.0] } }).buffer)), [0.25, 0.0, 0.5, 1.0]);
  assert.deepEqual(Array.from(new Float64Array(spec.encodeInput({ delta: 1.25, offsets: { values: [1.5, 2.5, 3.5] } }).buffer)), [1.25, 1.5, 2.5, 3.5]);
}

{
  const arena = shared.createTransformArena(1);
  const eventArena = shared.createEventArena(1);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena });
  const target = { x: 0, y: 0 };
  const controller = runtime.ui.compiled.attach_wasm_runtime_controller({
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
          { name: "y", offset: 4, type: "num" }
        ],
        input_fields: [
          { name: "pointer_x", offset: 0, type: "num" },
          { name: "pointer_y", offset: 4, type: "num" },
          { name: "anchor_x", offset: 8, type: "num" },
          { name: "anchor_y", offset: 12, type: "num" }
        ]
      }
    },
    bytes: (() => {
      const bytes = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
      function encodeU32(value, out) {
        value >>>= 0;
        do {
          let byte = value & 0x7f;
          value >>>= 7;
          if (value !== 0) byte |= 0x80;
          out.push(byte);
        } while (value !== 0);
      }
      function encodeI32(value, out) {
        value |= 0;
        let more = true;
        while (more) {
          let byte = value & 0x7f;
          value >>= 7;
          const signBit = (byte & 0x40) !== 0;
          more = !((value === 0 && !signBit) || (value === -1 && signBit));
          if (more) byte |= 0x80;
          out.push(byte);
        }
      }
      function encodeString(text, out) {
        const utf8 = new TextEncoder().encode(text);
        encodeU32(utf8.length, out);
        for (let i = 0; i < utf8.length; i += 1) out.push(utf8[i]);
      }
      function section(id, content) {
        bytes.push(id);
        encodeU32(content.length, bytes);
        content.forEach((b) => bytes.push(b));
      }
      const typeSection = [];
      encodeU32(2, typeSection);
      typeSection.push(0x60); encodeU32(0, typeSection); encodeU32(0, typeSection);
      typeSection.push(0x60); encodeU32(0, typeSection); encodeU32(1, typeSection); typeSection.push(0x7f);
      section(1, typeSection);
      const functionSection = [];
      encodeU32(7, functionSection);
      [0, 0, 0, 1, 1, 1, 1].forEach((v) => encodeU32(v, functionSection));
      section(3, functionSection);
      const memorySection = [];
      encodeU32(1, memorySection); memorySection.push(0x00); encodeU32(1, memorySection);
      section(5, memorySection);
      const exportSection = [];
      encodeU32(8, exportSection);
      encodeString("memory", exportSection); exportSection.push(0x02); encodeU32(0, exportSection);
      ["vkf_init", "vkf_update", "vkf_shutdown", "vkf_state_ptr", "vkf_state_size", "vkf_input_ptr", "vkf_input_size"].forEach((name, index) => {
        encodeString(name, exportSection); exportSection.push(0x00); encodeU32(index, exportSection);
      });
      section(7, exportSection);
      const codeSection = [];
      encodeU32(7, codeSection);
      const initBody = [];
      encodeU32(0, initBody);
      [0, 4, 8, 12, 16, 20].forEach((offset) => {
        initBody.push(0x41); encodeI32(offset, initBody);
        initBody.push(0x41); encodeI32(0, initBody);
        initBody.push(0x36); encodeU32(2, initBody); encodeU32(0, initBody);
      });
      initBody.push(0x0b);
      encodeU32(initBody.length, codeSection); initBody.forEach((b) => codeSection.push(b));
      const updateBody = [];
      encodeU32(0, updateBody);
      updateBody.push(0x41); encodeI32(0, updateBody);
      updateBody.push(0x41); encodeI32(8, updateBody);
      updateBody.push(0x28); encodeU32(2, updateBody); encodeU32(0, updateBody);
      updateBody.push(0x41); encodeI32(16, updateBody);
      updateBody.push(0x28); encodeU32(2, updateBody); encodeU32(0, updateBody);
      updateBody.push(0x6b);
      updateBody.push(0x36); encodeU32(2, updateBody); encodeU32(0, updateBody);
      updateBody.push(0x41); encodeI32(4, updateBody);
      updateBody.push(0x41); encodeI32(12, updateBody);
      updateBody.push(0x28); encodeU32(2, updateBody); encodeU32(0, updateBody);
      updateBody.push(0x41); encodeI32(20, updateBody);
      updateBody.push(0x28); encodeU32(2, updateBody); encodeU32(0, updateBody);
      updateBody.push(0x6b);
      updateBody.push(0x36); encodeU32(2, updateBody); encodeU32(0, updateBody);
      updateBody.push(0x0b);
      encodeU32(updateBody.length, codeSection); updateBody.forEach((b) => codeSection.push(b));
      [0x00, 0x0b].forEach((b, i, arr) => {
        if (i === 0) {
          encodeU32(arr.length, codeSection);
        }
        codeSection.push(b);
      });
      [0, 8, 8, 16].forEach((value) => {
        const body = [];
        encodeU32(0, body);
        body.push(0x41); encodeI32(value, body);
        body.push(0x0b);
        encodeU32(body.length, codeSection);
        body.forEach((b) => codeSection.push(b));
      });
      section(10, codeSection);
      return new Uint8Array(bytes);
    })(),
    readSample() {
      return eventArena.readerView().latestSample();
    },
    mapInput(sample) {
      return {
        pointer_x: sample.cursorPx[0],
        pointer_y: sample.cursorPx[1],
        anchor_x: sample.pointerAnchorPx[0],
        anchor_y: sample.pointerAnchorPx[1]
      };
    },
    applyState(state) {
      target.x = state.x;
      target.y = state.y;
      arena.setTranslate2D(0, state.x, state.y);
    }
  });
  controller.init({ x: 80, y: 70 });
  eventArena.writeInputSample({
    cursorPx: [144, 167],
    pointerAnchorPx: [12, 18],
    pointerDown: true,
    buttons: 1
  });
  const stepped = controller.step();
  assert.deepEqual(stepped.input, { pointer_x: 144, pointer_y: 167, anchor_x: 12, anchor_y: 18 });
  assert.deepEqual(stepped.state, { x: 132, y: 149 });
  assert.deepEqual(target, { x: 132, y: 149 });
  assert.equal(arena.mat4[12], 132);
  assert.equal(arena.mat4[13], 149);
}

{
  const arena = shared.createTransformArena(4);
  const geometryArena = shared.createGeometryArena(16);
  const eventArena = shared.createEventArena(1);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena, geometryArena });
  const panel = runtime.ui.display.frame();
  runtime.ui.display.add_frame(panel, [0, 0, 1, 1]);
  const mesh = panel.add({
    x: [0, 1, 2],
    y: [0, 0, 0],
    z: [0, 0, 0],
    vertex_radius: 4,
    vertex_pick_radius: 6,
    edge_pick_radius: 6,
    normalized: false
  });
  mesh.add_vertices([0, 1, 2]);
  mesh.add_edges([[0, 1], [1, 2]]);
  const applyMeshState = runtime.ui.compiled.create_mesh_state_applier(mesh, {
    xFields: [null, "x1", null],
    yFields: [null, "y1", null]
  });
  const controller = runtime.ui.compiled.attach_wasm_runtime_controller({
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
          { name: "x1", offset: 0, type: "num" },
          { name: "y1", offset: 4, type: "num" }
        ],
        input_fields: [
          { name: "pointer_x", offset: 0, type: "num" },
          { name: "pointer_y", offset: 4, type: "num" },
          { name: "anchor_x", offset: 8, type: "num" },
          { name: "anchor_y", offset: 12, type: "num" }
        ]
      }
    },
    bytes: buildCompiledVertexRuntimeModuleBytes(),
    readSample() {
      return eventArena.readerView().latestSample();
    },
    mapInput(sample) {
      return {
        pointer_x: sample.cursorPx[0],
        pointer_y: sample.cursorPx[1],
        anchor_x: sample.pointerAnchorPx[0],
        anchor_y: sample.pointerAnchorPx[1]
      };
    },
    applyState: applyMeshState
  });
  controller.init({ x1: 1, y1: 0 });
  eventArena.writeInputSample({
    cursorPx: [9, 7],
    pointerAnchorPx: [2, 3],
    pointerDown: true,
    buttons: 1
  });
  const stepped = controller.step();
  assert.deepEqual(stepped.state, { x1: 7, y1: 4 });
  assert.equal(mesh.coords.x[1], 7);
  assert.equal(mesh.coords.y[1], 4);
  assert.deepEqual(geometryArena.vertex(mesh.geometry_offset + 1), [7, 4, 0]);
  assert.equal(panel.pick([7, 4]).hover.vertex_id, 1);
}

{
  const arena = shared.createTransformArena(4);
  const geometryArena = shared.createGeometryArena(16);
  const eventArena = shared.createEventArena(1);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena, geometryArena });
  const panel = runtime.ui.display.frame();
  runtime.ui.display.add_frame(panel, [0, 0, 1, 1]);
  const mesh = panel.add({
    x: [1, 3, 9],
    y: [2, 4, 8],
    z: [0, 0, 0],
    vertex_radius: 4,
    vertex_pick_radius: 6,
    edge_pick_radius: 6,
    normalized: false
  });
  mesh.add_vertices([0, 1, 2]);
  mesh.add_edges([[0, 1], [1, 2]]);
  const applyEdgeState = runtime.ui.compiled.create_edge_state_applier(mesh, 0, {
    xFields: ["x0", "x1"],
    yFields: ["y0", "y1"]
  });
  const controller = runtime.ui.compiled.attach_wasm_runtime_controller({
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
          { name: "x0", offset: 0, type: "num" },
          { name: "y0", offset: 4, type: "num" },
          { name: "x1", offset: 8, type: "num" },
          { name: "y1", offset: 12, type: "num" }
        ],
        input_fields: [
          { name: "pointer_x", offset: 0, type: "num" },
          { name: "pointer_y", offset: 4, type: "num" },
          { name: "anchor_x", offset: 8, type: "num" },
          { name: "anchor_y", offset: 12, type: "num" }
        ]
      }
    },
    bytes: (() => {
      const bytes = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
      function localEncodeU32(value, out) {
        value >>>= 0;
        do {
          let byte = value & 0x7f;
          value >>>= 7;
          if (value !== 0) byte |= 0x80;
          out.push(byte);
        } while (value !== 0);
      }
      function localEncodeI32(value, out) {
        value |= 0;
        let more = true;
        while (more) {
          let byte = value & 0x7f;
          value >>= 7;
          const signBit = (byte & 0x40) !== 0;
          more = !((value === 0 && !signBit) || (value === -1 && signBit));
          if (more) byte |= 0x80;
          out.push(byte);
        }
      }
      function localEncodeString(text, out) {
        const utf8 = new TextEncoder().encode(text);
        localEncodeU32(utf8.length, out);
        for (let i = 0; i < utf8.length; i += 1) out.push(utf8[i]);
      }
      function localSection(id, content) {
        bytes.push(id);
        localEncodeU32(content.length, bytes);
        content.forEach((b) => bytes.push(b));
      }
      function localConstBody(value) {
        const body = [];
        localEncodeU32(0, body);
        body.push(0x41); localEncodeI32(value, body);
        body.push(0x0b);
        return body;
      }
      const typeSection = [];
      localEncodeU32(2, typeSection);
      typeSection.push(0x60); localEncodeU32(0, typeSection); localEncodeU32(0, typeSection);
      typeSection.push(0x60); localEncodeU32(0, typeSection); localEncodeU32(1, typeSection); typeSection.push(0x7f);
      localSection(1, typeSection);
      const functionSection = [];
      localEncodeU32(7, functionSection);
      [0, 0, 0, 1, 1, 1, 1].forEach((value) => localEncodeU32(value, functionSection));
      localSection(3, functionSection);
      const memorySection = [];
      localEncodeU32(1, memorySection); memorySection.push(0x00); localEncodeU32(1, memorySection);
      localSection(5, memorySection);
      const exportSection = [];
      localEncodeU32(8, exportSection);
      localEncodeString("memory", exportSection); exportSection.push(0x02); localEncodeU32(0, exportSection);
      ["vkf_init", "vkf_update", "vkf_shutdown", "vkf_state_ptr", "vkf_state_size", "vkf_input_ptr", "vkf_input_size"].forEach((name, index) => {
        localEncodeString(name, exportSection); exportSection.push(0x00); localEncodeU32(index, exportSection);
      });
      localSection(7, exportSection);
      const codeSection = [];
      localEncodeU32(7, codeSection);
      const initBody = [];
      localEncodeU32(0, initBody);
      [0, 4, 8, 12, 16, 20, 24, 28].forEach((offset) => {
        initBody.push(0x41); localEncodeI32(offset, initBody);
        initBody.push(0x41); localEncodeI32(0, initBody);
        initBody.push(0x36); localEncodeU32(2, initBody); localEncodeU32(0, initBody);
      });
      initBody.push(0x0b);
      localEncodeU32(initBody.length, codeSection); initBody.forEach((b) => codeSection.push(b));
      const updateBody = [];
      localEncodeU32(0, updateBody);
      [[0, 16, 24], [4, 20, 28], [8, 16, 24], [12, 20, 28]].forEach(([stateOffset, pointerOffset, anchorOffset]) => {
        updateBody.push(0x41); localEncodeI32(stateOffset, updateBody);
        updateBody.push(0x41); localEncodeI32(pointerOffset, updateBody);
        updateBody.push(0x28); localEncodeU32(2, updateBody); localEncodeU32(0, updateBody);
        updateBody.push(0x41); localEncodeI32(anchorOffset, updateBody);
        updateBody.push(0x28); localEncodeU32(2, updateBody); localEncodeU32(0, updateBody);
        updateBody.push(0x6b);
        updateBody.push(0x36); localEncodeU32(2, updateBody); localEncodeU32(0, updateBody);
      });
      updateBody.push(0x0b);
      localEncodeU32(updateBody.length, codeSection); updateBody.forEach((b) => codeSection.push(b));
      const noopBody = [0x00, 0x0b];
      localEncodeU32(noopBody.length, codeSection); noopBody.forEach((b) => codeSection.push(b));
      [0, 16, 16, 16].forEach((value) => {
        const body = localConstBody(value);
        localEncodeU32(body.length, codeSection);
        body.forEach((b) => codeSection.push(b));
      });
      localSection(10, codeSection);
      return new Uint8Array(bytes);
    })(),
    readSample() {
      return eventArena.readerView().latestSample();
    },
    mapInput(sample) {
      return {
        pointer_x: sample.cursorPx[0],
        pointer_y: sample.cursorPx[1],
        anchor_x: sample.pointerAnchorPx[0],
        anchor_y: sample.pointerAnchorPx[1]
      };
    },
    applyState: applyEdgeState
  });
  controller.init({ x0: 1, y0: 2, x1: 3, y1: 4 });
  eventArena.writeInputSample({
    cursorPx: [11, 13],
    pointerAnchorPx: [5, 6],
    pointerDown: true,
    buttons: 1
  });
  const stepped = controller.step();
  assert.deepEqual(stepped.state, { x0: 6, y0: 7, x1: 6, y1: 7 });
  assert.deepEqual([mesh.coords.x[0], mesh.coords.y[0]], [6, 7]);
  assert.deepEqual([mesh.coords.x[1], mesh.coords.y[1]], [6, 7]);
  assert.deepEqual(geometryArena.vertex(mesh.geometry_offset + 0), [6, 7, 0]);
  assert.deepEqual(geometryArena.vertex(mesh.geometry_offset + 1), [6, 7, 0]);
}

{
  const arena = shared.createTransformArena(4);
  const eventArena = shared.createEventArena(1);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena });
  const panel = runtime.ui.display.frame();
  runtime.ui.display.add_frame(panel, [0, 0, 1, 1]);
  const mesh = panel.add({
    x: [0, 1],
    y: [0, 0],
    z: [0, 0],
    normalized: false
  });
  mesh.add_vertices([0, 1]);
  mesh.add_edges([[0, 1]]);
  const applyTransformState = runtime.ui.compiled.create_transform_state_applier(mesh, {
    matrixFields: ["m00", "m01", "m10", "m11"],
    offsetFields: ["ox", "oy"]
  });
  const controller = runtime.ui.compiled.attach_wasm_runtime_controller({
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
          { name: "m00", offset: 0, type: "num" },
          { name: "m01", offset: 4, type: "num" },
          { name: "m10", offset: 8, type: "num" },
          { name: "m11", offset: 12, type: "num" },
          { name: "ox", offset: 16, type: "num" },
          { name: "oy", offset: 20, type: "num" }
        ],
        input_fields: [
          { name: "pointer_x", offset: 0, type: "num" },
          { name: "pointer_y", offset: 4, type: "num" },
          { name: "anchor_x", offset: 8, type: "num" },
          { name: "anchor_y", offset: 12, type: "num" }
        ]
      }
    },
    bytes: (() => {
      const bytes = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
      function localEncodeU32(value, out) {
        value >>>= 0;
        do {
          let byte = value & 0x7f;
          value >>>= 7;
          if (value !== 0) byte |= 0x80;
          out.push(byte);
        } while (value !== 0);
      }
      function localEncodeI32(value, out) {
        value |= 0;
        let more = true;
        while (more) {
          let byte = value & 0x7f;
          value >>= 7;
          const signBit = (byte & 0x40) !== 0;
          more = !((value === 0 && !signBit) || (value === -1 && signBit));
          if (more) byte |= 0x80;
          out.push(byte);
        }
      }
      function localEncodeString(text, out) {
        const utf8 = new TextEncoder().encode(text);
        localEncodeU32(utf8.length, out);
        for (let i = 0; i < utf8.length; i += 1) out.push(utf8[i]);
      }
      function localSection(id, content) {
        bytes.push(id);
        localEncodeU32(content.length, bytes);
        content.forEach((b) => bytes.push(b));
      }
      function localConstBody(value) {
        const body = [];
        localEncodeU32(0, body);
        body.push(0x41); localEncodeI32(value, body);
        body.push(0x0b);
        return body;
      }
      const typeSection = [];
      localEncodeU32(2, typeSection);
      typeSection.push(0x60); localEncodeU32(0, typeSection); localEncodeU32(0, typeSection);
      typeSection.push(0x60); localEncodeU32(0, typeSection); localEncodeU32(1, typeSection); typeSection.push(0x7f);
      localSection(1, typeSection);
      const functionSection = [];
      localEncodeU32(7, functionSection);
      [0, 0, 0, 1, 1, 1, 1].forEach((value) => localEncodeU32(value, functionSection));
      localSection(3, functionSection);
      const memorySection = [];
      localEncodeU32(1, memorySection); memorySection.push(0x00); localEncodeU32(1, memorySection);
      localSection(5, memorySection);
      const exportSection = [];
      localEncodeU32(8, exportSection);
      localEncodeString("memory", exportSection); exportSection.push(0x02); localEncodeU32(0, exportSection);
      ["vkf_init", "vkf_update", "vkf_shutdown", "vkf_state_ptr", "vkf_state_size", "vkf_input_ptr", "vkf_input_size"].forEach((name, index) => {
        localEncodeString(name, exportSection); exportSection.push(0x00); localEncodeU32(index, exportSection);
      });
      localSection(7, exportSection);
      const codeSection = [];
      localEncodeU32(7, codeSection);
      const initBody = [];
      localEncodeU32(0, initBody);
      [0, 4, 8, 12, 16, 20, 24, 28].forEach((offset) => {
        initBody.push(0x41); localEncodeI32(offset, initBody);
        initBody.push(0x41); localEncodeI32(0, initBody);
        initBody.push(0x36); localEncodeU32(2, initBody); localEncodeU32(0, initBody);
      });
      initBody.push(0x0b);
      localEncodeU32(initBody.length, codeSection); initBody.forEach((b) => codeSection.push(b));
      const updateBody = [];
      localEncodeU32(0, updateBody);
      // ox = pointer_x - anchor_x
      updateBody.push(0x41); localEncodeI32(16, updateBody);
      updateBody.push(0x41); localEncodeI32(24, updateBody);
      updateBody.push(0x28); localEncodeU32(2, updateBody); localEncodeU32(0, updateBody);
      updateBody.push(0x41); localEncodeI32(32, updateBody);
      updateBody.push(0x28); localEncodeU32(2, updateBody); localEncodeU32(0, updateBody);
      updateBody.push(0x6b);
      updateBody.push(0x36); localEncodeU32(2, updateBody); localEncodeU32(0, updateBody);
      // oy = pointer_y - anchor_y
      updateBody.push(0x41); localEncodeI32(20, updateBody);
      updateBody.push(0x41); localEncodeI32(28, updateBody);
      updateBody.push(0x28); localEncodeU32(2, updateBody); localEncodeU32(0, updateBody);
      updateBody.push(0x41); localEncodeI32(36, updateBody);
      updateBody.push(0x28); localEncodeU32(2, updateBody); localEncodeU32(0, updateBody);
      updateBody.push(0x6b);
      updateBody.push(0x36); localEncodeU32(2, updateBody); localEncodeU32(0, updateBody);
      updateBody.push(0x0b);
      localEncodeU32(updateBody.length, codeSection); updateBody.forEach((b) => codeSection.push(b));
      const noopBody = [0x00, 0x0b];
      localEncodeU32(noopBody.length, codeSection); noopBody.forEach((b) => codeSection.push(b));
      [0, 24, 24, 16].forEach((value) => {
        const body = localConstBody(value);
        localEncodeU32(body.length, codeSection);
        body.forEach((b) => codeSection.push(b));
      });
      localSection(10, codeSection);
      return new Uint8Array(bytes);
    })(),
    readSample() {
      return eventArena.readerView().latestSample();
    },
    mapInput(sample) {
      return {
        pointer_x: sample.cursorPx[0],
        pointer_y: sample.cursorPx[1],
        anchor_x: sample.pointerAnchorPx[0],
        anchor_y: sample.pointerAnchorPx[1]
      };
    },
    applyState: applyTransformState
  });
  controller.init({ m00: 2, m01: 0, m10: 0, m11: 3, ox: 0, oy: 0 });
  assert.deepEqual(mesh.world_point(1), [2, 0, 0]);
  eventArena.writeInputSample({
    cursorPx: [14, 15],
    pointerAnchorPx: [4, 6],
    pointerDown: true,
    buttons: 1
  });
  const stepped = controller.step();
  assert.deepEqual(stepped.state, { m00: 2, m01: 0, m10: 0, m11: 3, ox: 10, oy: 9 });
  assert.deepEqual(mesh.world_point(1), [12, 9, 0]);
  assert.equal(arena.mat4[mesh.slot * shared.MAT4_F32 + 12], 10);
  assert.equal(arena.mat4[mesh.slot * shared.MAT4_F32 + 13], 9);
}

{
  const arena = shared.createTransformArena(6);
  const eventArena = shared.createEventArena(1);
  const runtime = vkfUi.createVkfUiRuntime({ arena, eventArena });
  const panel = runtime.ui.display.frame();
  runtime.ui.display.add_frame(panel, [0, 0, 1, 1]);
  const rectA = panel.add_rect([10, 20, 30, 40], { color: [1, 0, 0, 1] });
  const rectB = panel.add_rect([50, 60, 20, 10], { color: [0, 1, 0, 1] });
  const applyRects = runtime.ui.compiled.compose_state_appliers([
    runtime.ui.compiled.create_rect_state_applier(rectA, {
      offsetFields: ["x0", "y0"],
      sizeFields: ["w0", "h0"]
    }),
    runtime.ui.compiled.create_rect_state_applier(rectB, {
      offsetFields: ["x1", "y1"]
    })
  ]);
  applyRects({
    x0: 110,
    y0: 120,
    w0: 130,
    h0: 140,
    x1: 150,
    y1: 160
  });
  assert.deepEqual(rectA.world_rect(), { x: 110, y: 120, w: 130, h: 140 });
  assert.deepEqual(rectB.world_rect(), { x: 150, y: 160, w: 20, h: 10 });
  assert.equal(arena.mat4[rectA.slot * shared.MAT4_F32 + 12], 110);
  assert.equal(arena.mat4[rectA.slot * shared.MAT4_F32 + 13], 120);
  assert.equal(arena.mat4[rectB.slot * shared.MAT4_F32 + 12], 150);
  assert.equal(arena.mat4[rectB.slot * shared.MAT4_F32 + 13], 160);
}

console.log("vf-vkf-ui-runtime tests passed");

