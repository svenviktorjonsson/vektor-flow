/**
 * Minimal column-major 4x4 (WebGPU std140 compatible for mat4 in uniforms).
 */
(function (global) {
  "use strict";

  function mat4Identity() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }

  function mat4Mul(a, b) {
    var o = new Float32Array(16);
    for (var c = 0; c < 4; c++) {
      for (var r = 0; r < 4; r++) {
        o[c * 4 + r] =
          a[0 * 4 + r] * b[c * 4 + 0] +
          a[1 * 4 + r] * b[c * 4 + 1] +
          a[2 * 4 + r] * b[c * 4 + 2] +
          a[3 * 4 + r] * b[c * 4 + 3];
      }
    }
    return o;
  }

  function mat4Perspective(fovYRad, aspect, n, f) {
    var t = Math.tan(fovYRad * 0.5);
    var x = 1 / (aspect * t);
    var y = 1 / t;
    var c = f / (n - f);
    var d = (f * n) / (n - f);
    return new Float32Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, c, -1, 0, 0, d, 0]);
  }

  function mat4Ortho(l, r, b, t, n, f) {
    return new Float32Array([
      2 / (r - l), 0, 0, 0,
      0, 2 / (t - b), 0, 0,
      0, 0, -2 / (f - n), 0,
      -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1,
    ]);
  }

  /**
   * Perspective for WebGPU / D3D / Metal NDC: z in [0, 1] (not OpenGL [-1, 1]).
   * Same memory layout (column-major) as WGSL mat4x4 in uniform.
   */
  function mat4PerspectiveZ01(fovYRad, aspect, n, f) {
    var t = 1.0 / Math.tan(fovYRad * 0.5);
    var nf = 1.0 / (n - f);
    return new Float32Array([t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, f * nf, -1, 0, 0, n * f * nf, 0]);
  }

  /**
   * Orthographic for WebGPU depth [0, 1]. For 2D in z=0 use near=0, far=1.
   */
  function mat4OrthoZ01(l, r, b, t, n, f) {
    var lr = 1.0 / (l - r);
    var bt = 1.0 / (b - t);
    var fn = 1.0 / (n - f);
    return new Float32Array([
      -2.0 * lr, 0, 0, 0,
      0, -2.0 * bt, 0, 0,
      0, 0, fn, 0,
      (l + r) * lr, (t + b) * bt, n * fn, 1,
    ]);
  }

  function mat4Translation(x, y, z) {
    var m = mat4Identity();
    m[12] = x;
    m[13] = y;
    m[14] = z;
    return m;
  }

  function mat4RotationY(a) {
    var c = Math.cos(a);
    var s = Math.sin(a);
    return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
  }

  function mat4Scale(x, y, z) {
    return new Float32Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]);
  }

  function vec3Len(a) {
    return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
  }

  function vec3Normalize(a) {
    var l = vec3Len(a);
    if (l < 1e-12) {
      return [0, 0, 1];
    }
    return [a[0] / l, a[1] / l, a[2] / l];
  }

  function vec3Add(a, b) {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  }

  function vec3Sub(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  }

  function vec3Cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }

  /** Non-normalized face normal of triangle a,b,c (ccw in right-handed Y-up: points toward viewer if CCW is front). */
  function triFaceNormal3(a, b, c) {
    var e0 = vec3Sub(b, a);
    var e1 = vec3Sub(c, a);
    return vec3Cross(e0, e1);
  }

  global.VfGeomMath = {
    mat4Identity: mat4Identity,
    mat4Mul: mat4Mul,
    mat4Perspective: mat4Perspective,
    mat4Ortho: mat4Ortho,
    mat4PerspectiveZ01: mat4PerspectiveZ01,
    mat4OrthoZ01: mat4OrthoZ01,
    mat4Translation: mat4Translation,
    mat4RotationY: mat4RotationY,
    mat4Scale: mat4Scale,
    vec3Len: vec3Len,
    vec3Normalize: vec3Normalize,
    vec3Add: vec3Add,
    vec3Sub: vec3Sub,
    vec3Cross: vec3Cross,
    triFaceNormal3: triFaceNormal3,
  };
})(typeof window !== "undefined" ? window : this);
