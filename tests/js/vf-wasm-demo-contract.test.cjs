const assert = require("node:assert/strict");
const shared = require("../../web/vf-ui/vf-shared-runtime.js");
const wasmDemo = require("../../web/vf-ui/vf-wasm-demo-contract.js");

{
  const arena = shared.createTransformArena(3);
  const calls = [];
  const demo = {
    init(api) {
      calls.push({ name: "init", api });
      api.transforms.setTranslate2D(1, 2, 3);
      return 7;
    },
    update(input, api) {
      calls.push({ name: "update", input, api });
      api.transforms.setAnchoredTranslate2D(
        1,
        input.pointerX,
        input.pointerY,
        input.pointerAnchorX,
        input.pointerAnchorY
      );
      return input.sequence;
    }
  };

  const contract = wasmDemo.createWasmDemoContract({ demo, arena });

  assert.equal(contract.init(), 7);
  assert.equal(calls[0].api.transforms.capacity, 3);
  assert.equal(arena.mat4[1 * shared.MAT4_F32 + 12], 2);
  assert.equal(arena.mat4[1 * shared.MAT4_F32 + 13], 3);

  const result = contract.update(
    wasmDemo.createInputSnapshot({
      sequence: 42,
      timeMs: 1000,
      pointerX: 20,
      pointerY: 30,
      pointerAnchorX: 5,
      pointerAnchorY: 7,
      pointerDown: true,
      buttons: 1,
      keyMask: 4
    })
  );

  assert.equal(result, 42);
  assert.equal(calls[1].input.sequence, 42);
  assert.equal(calls[1].input.timeMs, 1000);
  assert.equal(calls[1].input.pointerDown, 1);
  assert.equal(calls[1].input.buttons, 1);
  assert.equal(calls[1].input.keyMask, 4);
  assert.equal(arena.mat4[1 * shared.MAT4_F32 + 12], 15);
  assert.equal(arena.mat4[1 * shared.MAT4_F32 + 13], 23);
}

{
  const arena = shared.createTransformArena(1);
  const snapshots = [];
  const demo = {
    exports: {
      init(api) {
        assert.equal(api.transforms.capacity, 1);
      },
      update(input) {
        snapshots.push(input);
      }
    }
  };

  const originalStringify = JSON.stringify;
  const originalParse = JSON.parse;
  JSON.stringify = function () {
    throw new Error("JSON.stringify must not be used on the UI hot path");
  };
  JSON.parse = function () {
    throw new Error("JSON.parse must not be used on the UI hot path");
  };

  try {
    const contract = wasmDemo.createWasmDemoContract({ demo, arena });
    contract.init();
    contract.update(
      wasmDemo.createInputSnapshot({
        sequence: 1,
        timeMs: 16.7,
        pointerX: 8,
        pointerY: 13,
        pointerDown: false
      })
    );
  } finally {
    JSON.stringify = originalStringify;
    JSON.parse = originalParse;
  }

  assert.equal(snapshots.length, 1);
  assert.deepEqual(Object.keys(snapshots[0]), wasmDemo.INPUT_SNAPSHOT_FIELDS);
}

{
  const arena = shared.createTransformArena(1);
  const eventBuffer = new SharedArrayBuffer(128);
  const eventReader = {
    buffer: eventBuffer,
    f64: new Float64Array(eventBuffer, 0, 8),
    i32: new Int32Array(eventBuffer, 64, 8),
    latestSample() {
      return {
        cursorPx: [44.5, 55.25],
        pointerDown: true,
        buttons: 3,
        keyMask: 9,
        sequence: 77,
        timeMs: 123.5,
        pointerAnchorPx: [4, 5]
      };
    }
  };
  const eventArena = {
    readerViewCalls: 0,
    readerView() {
      this.readerViewCalls += 1;
      return eventReader;
    }
  };
  const calls = [];
  const demo = {
    exports: {
      init(api) {
        calls.push({ name: "init", api });
        assert.equal(api.events.buffer, eventBuffer);
        assert.equal(api.events.f64, eventReader.f64);
        assert.equal(api.events.i32, eventReader.i32);
      },
      update(input, api) {
        calls.push({ name: "update", input, api });
        assert.equal(api.events, eventReader);
      }
    }
  };

  const originalStringify = JSON.stringify;
  const originalParse = JSON.parse;
  JSON.stringify = function () {
    throw new Error("JSON.stringify must not be used on the UI hot path");
  };
  JSON.parse = function () {
    throw new Error("JSON.parse must not be used on the UI hot path");
  };

  try {
    const contract = wasmDemo.createWasmDemoContract({ demo, arena, eventArena });
    contract.init();
    contract.update();
  } finally {
    JSON.stringify = originalStringify;
    JSON.parse = originalParse;
  }

  assert.equal(eventArena.readerViewCalls, 1);
  assert.equal(calls[1].input.sequence, 77);
  assert.equal(calls[1].input.timeMs, 123.5);
  assert.equal(calls[1].input.pointerX, 44.5);
  assert.equal(calls[1].input.pointerY, 55.25);
  assert.equal(calls[1].input.pointerAnchorX, 4);
  assert.equal(calls[1].input.pointerAnchorY, 5);
  assert.equal(calls[1].input.pointerDown, 1);
  assert.equal(calls[1].input.buttons, 3);
  assert.equal(calls[1].input.keyMask, 9);
}

assert.throws(
  () => wasmDemo.createWasmDemoContract({ demo: { init() {} }, arena: shared.createTransformArena(1) }),
  /update/
);

console.log("vf-wasm-demo-contract tests passed");
