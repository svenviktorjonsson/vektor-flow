(function (global) {
  "use strict";

  var HEADER_I32 = 16;
  var MAT4_F32 = 16;
  var HEADER_BYTES = HEADER_I32 * Int32Array.BYTES_PER_ELEMENT;

  var H_CAPACITY = 0;
  var H_DIRTY_VERSION = 1;
  var H_DIRTY_MIN = 2;
  var H_DIRTY_MAX = 3;

  function requireSharedArrayBuffer() {
    if (typeof SharedArrayBuffer === "undefined") {
      throw new Error("SharedArrayBuffer is required for the VKF shared UI runtime");
    }
  }

  function identityMat4(out, offset) {
    for (var i = 0; i < MAT4_F32; i++) {
      out[offset + i] = 0;
    }
    out[offset + 0] = 1;
    out[offset + 5] = 1;
    out[offset + 10] = 1;
    out[offset + 15] = 1;
  }

  function markDirty(header, slot) {
    var min = Atomics.load(header, H_DIRTY_MIN);
    var max = Atomics.load(header, H_DIRTY_MAX);
    if (min < 0 || slot < min) {
      Atomics.store(header, H_DIRTY_MIN, slot);
    }
    if (max < 0 || slot > max) {
      Atomics.store(header, H_DIRTY_MAX, slot);
    }
    Atomics.add(header, H_DIRTY_VERSION, 1);
  }

  function assertSlot(arena, slot) {
    var cap = arena.capacity();
    if (slot < 0 || slot >= cap) {
      throw new RangeError("transform slot out of range: " + slot);
    }
  }

  function createTransformArena(capacity) {
    requireSharedArrayBuffer();
    var cap = Math.max(1, capacity | 0);
    var bytes = HEADER_BYTES + cap * MAT4_F32 * Float32Array.BYTES_PER_ELEMENT;
    var buffer = new SharedArrayBuffer(bytes);
    var header = new Int32Array(buffer, 0, HEADER_I32);
    var mat4 = new Float32Array(buffer, HEADER_BYTES, cap * MAT4_F32);
    Atomics.store(header, H_CAPACITY, cap);
    Atomics.store(header, H_DIRTY_VERSION, 0);
    Atomics.store(header, H_DIRTY_MIN, -1);
    Atomics.store(header, H_DIRTY_MAX, -1);
    for (var slot = 0; slot < cap; slot++) {
      identityMat4(mat4, slot * MAT4_F32);
    }
    return new TransformArena(buffer, header, mat4);
  }

  function TransformArena(buffer, header, mat4) {
    this.buffer = buffer;
    this.header = header;
    this.mat4 = mat4;
  }

  TransformArena.prototype.capacity = function () {
    return Atomics.load(this.header, H_CAPACITY);
  };

  TransformArena.prototype.setMat4 = function (slot, values) {
    assertSlot(this, slot);
    if (!values || values.length < MAT4_F32) {
      throw new TypeError("setMat4 expects 16 numeric values");
    }
    var offset = slot * MAT4_F32;
    for (var i = 0; i < MAT4_F32; i++) {
      this.mat4[offset + i] = Number(values[i]) || 0;
    }
    markDirty(this.header, slot);
  };

  TransformArena.prototype.setTranslate2D = function (slot, x, y) {
    assertSlot(this, slot);
    var offset = slot * MAT4_F32;
    identityMat4(this.mat4, offset);
    this.mat4[offset + 12] = Number(x) || 0;
    this.mat4[offset + 13] = Number(y) || 0;
    markDirty(this.header, slot);
  };

  TransformArena.prototype.setAnchoredTranslate2D = function (slot, cursorX, cursorY, anchorX, anchorY) {
    this.setTranslate2D(
      slot,
      (Number(cursorX) || 0) - (Number(anchorX) || 0),
      (Number(cursorY) || 0) - (Number(anchorY) || 0)
    );
  };

  TransformArena.prototype.dirtyRange = function () {
    return {
      version: Atomics.load(this.header, H_DIRTY_VERSION),
      min: Atomics.load(this.header, H_DIRTY_MIN),
      max: Atomics.load(this.header, H_DIRTY_MAX)
    };
  };

  TransformArena.prototype.consumeDirtyRange = function () {
    var range = this.dirtyRange();
    Atomics.store(this.header, H_DIRTY_MIN, -1);
    Atomics.store(this.header, H_DIRTY_MAX, -1);
    return range;
  };

  TransformArena.prototype.copyDirtyMat4 = function () {
    var range = this.consumeDirtyRange();
    if (range.min < 0 || range.max < range.min) {
      return { range: range, data: new Float32Array(0) };
    }
    var start = range.min * MAT4_F32;
    var end = (range.max + 1) * MAT4_F32;
    return {
      range: range,
      data: this.mat4.slice(start, end)
    };
  };

  TransformArena.prototype.rendererView = function () {
    var arena = this;
    return {
      buffer: arena.buffer,
      mat4: arena.mat4,
      capacity: arena.capacity(),
      dirtyRange: function () {
        return arena.dirtyRange();
      },
      consumeDirtyRange: function () {
        return arena.consumeDirtyRange();
      },
      copyDirtyMat4: function () {
        return arena.copyDirtyMat4();
      }
    };
  };

  global.VfSharedRuntime = {
    HEADER_I32: HEADER_I32,
    MAT4_F32: MAT4_F32,
    createTransformArena: createTransformArena
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.VfSharedRuntime;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
