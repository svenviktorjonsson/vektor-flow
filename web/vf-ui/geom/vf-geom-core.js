/**
 * Core geometry: simplicial-style data packed for GPU.
 * Vertices: per-vertex [x,y,z, nx,ny,nz, r,g,b,a]. Indices into vertices for tris or lines.
 * Future WASM can own the same layout (f32 + u32 views over one linear buffer).
 */
(function (global) {
  "use strict";

  var V = 10; // x,y,z, nx,ny,nz, r,g,b,a per vertex
  var N2 = [0, 0, 1];

  function cross3(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }

  function len3(v) {
    return Math.hypot(v[0], v[1], v[2]);
  }

  function norm3(v) {
    var l = len3(v);
    if (l < 1e-12) {
      return [0, 0, 1];
    }
    return [v[0] / l, v[1] / l, v[2] / l];
  }

  function vertex(x, y, z, nx, ny, nz, r, g, b, a) {
    return [x, y, z, nx, ny, nz, r, g, b, a];
  }

  function interleave(verts) {
    var a = new Float32Array(verts.length * V);
    for (var i = 0; i < verts.length; i++) {
      for (var j = 0; j < V; j++) {
        a[i * V + j] = verts[i][j];
      }
    }
    return a;
  }

  /** Filled CCW triangle in z=0 plane, clip-ish coords. */
  function preset2dTriangle() {
    return {
      id: "2d_tri",
      mode3d: false,
      label: "2D: triangle",
      vertices: interleave([
        vertex(0, 0.75, 0, N2[0], N2[1], N2[2], 0.9, 0.3, 0.2, 1),
        vertex(-0.7, -0.45, 0, N2[0], N2[1], N2[2], 0.2, 0.7, 0.95, 1),
        vertex(0.7, -0.45, 0, N2[0], N2[1], N2[2], 0.4, 0.95, 0.4, 1),
      ]),
      indices: new Uint32Array([0, 1, 2]),
      topology: "triangle-list",
    };
  }

  function preset2dQuad() {
    return {
      id: "2d_quad",
      mode3d: false,
      label: "2D: quad (2 tris)",
      vertices: interleave([
        vertex(-0.6, 0.6, 0, N2[0], N2[1], N2[2], 0.85, 0.45, 0.15, 1),
        vertex(0.6, 0.6, 0, N2[0], N2[1], N2[2], 0.15, 0.5, 0.95, 1),
        vertex(0.6, -0.6, 0, N2[0], N2[1], N2[2], 0.35, 0.9, 0.45, 1),
        vertex(-0.6, -0.6, 0, N2[0], N2[1], N2[2], 0.75, 0.35, 0.85, 1),
      ]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      topology: "triangle-list",
    };
  }

  /** Same as quad; separate preset id for “rectangle” case studies. */
  function preset2dRect() {
    var p = preset2dQuad();
    p.id = "2d_rect";
    p.label = "2D: rectangle";
    return p;
  }

  /** N-gon (octagon) as triangle fan in z=0. */
  function preset2dPolygon() {
    var n = 8;
    var R = 0.7;
    var verts = [vertex(0, 0, 0, N2[0], N2[1], N2[2], 0.2, 0.22, 0.3, 1)];
    for (var k = 0; k < n; k++) {
      var a = (k * 2 * Math.PI) / n - Math.PI / 2;
      var t = k / n;
      verts.push(
        vertex(
          R * Math.cos(a),
          R * Math.sin(a),
          0,
          N2[0],
          N2[1],
          N2[2],
          0.35 + 0.5 * t,
          0.4 + 0.45 * Math.sin(2 * a),
          0.85 - 0.4 * t,
          1
        )
      );
    }
    var idx = [];
    for (var t = 0; t < n; t++) {
      idx.push(0, 1 + t, 1 + ((t + 1) % n));
    }
    return {
      id: "2d_poly",
      mode3d: false,
      label: "2D: polygon (octagon)",
      vertices: interleave(verts),
      indices: new Uint32Array(idx),
      topology: "triangle-list",
    };
  }

  /** Hex = center + 6 around, 6 triangles. */
  function preset2dHex() {
    var R = 0.65;
    var verts = [vertex(0, 0, 0, N2[0], N2[1], N2[2], 0.5, 0.55, 0.6, 1)];
    var cols = [
      [0.95, 0.4, 0.35, 1],
      [0.4, 0.85, 0.4, 1],
      [0.4, 0.55, 0.95, 1],
      [0.85, 0.75, 0.3, 1],
      [0.6, 0.35, 0.9, 1],
      [0.3, 0.85, 0.85, 1],
    ];
    for (var k = 0; k < 6; k++) {
      var a = (k * Math.PI) / 3 - Math.PI / 2;
      verts.push(
        vertex(
          R * Math.cos(a),
          R * Math.sin(a),
          0,
          N2[0],
          N2[1],
          N2[2],
          cols[k][0],
          cols[k][1],
          cols[k][2],
          cols[k][3]
        )
      );
    }
    var idx = [];
    for (var t = 0; t < 6; t++) {
      idx.push(0, 1 + t, 1 + ((t + 1) % 6));
    }
    return {
      id: "2d_hex",
      mode3d: false,
      label: "2D: hex (fan)",
      vertices: interleave(verts),
      indices: new Uint32Array(idx),
      topology: "triangle-list",
    };
  }

  var CUBE = [
    [-0.5, -0.5, -0.5],
    [0.5, -0.5, -0.5],
    [0.5, 0.5, -0.5],
    [-0.5, 0.5, -0.5],
    [-0.5, -0.5, 0.5],
    [0.5, -0.5, 0.5],
    [0.5, 0.5, 0.5],
    [-0.5, 0.5, 0.5],
  ];

  function faceColor(i) {
    var p = [
      [0.85, 0.2, 0.25],
      [0.25, 0.75, 0.35],
      [0.25, 0.4, 0.9],
      [0.9, 0.75, 0.2],
      [0.7, 0.35, 0.85],
      [0.35, 0.85, 0.9],
    ];
    var c = p[i % 6];
    return [c[0], c[1], c[2], 1];
  }

  function preset3dCubeSolid() {
    var faces = [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [2, 3, 7, 6],
      [0, 3, 7, 4],
      [1, 2, 6, 5],
    ];
    var faceNormals = [
      [0, 0, -1],
      [0, 0, 1],
      [0, -1, 0],
      [0, 1, 0],
      [-1, 0, 0],
      [1, 0, 0],
    ];
    var verts = [];
    var idx = [];
    for (var fi = 0; fi < 6; fi++) {
      var col = faceColor(fi);
      var f = faces[fi];
      var n = faceNormals[fi];
      var base = verts.length;
      for (var j = 0; j < 4; j++) {
        var p = CUBE[f[j]];
        verts.push(vertex(p[0], p[1], p[2], n[0], n[1], n[2], col[0], col[1], col[2], col[3]));
      }
      idx.push(
        base,
        base + 1,
        base + 2,
        base,
        base + 2,
        base + 3
      );
    }
    return {
      id: "3d_cube",
      mode3d: true,
      label: "3D: cube (shaded tris)",
      vertices: interleave(verts),
      indices: new Uint32Array(idx),
      topology: "triangle-list",
    };
  }

  var EDGE = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];

  function preset3dCubeWire() {
    var verts = [];
    for (var i = 0; i < 8; i++) {
      var p = CUBE[i];
      verts.push(vertex(p[0], p[1], p[2], N2[0], N2[1], N2[2], 0.2, 0.85, 0.45, 1));
    }
    var idx = [];
    for (var e = 0; e < EDGE.length; e++) {
      idx.push(EDGE[e][0], EDGE[e][1]);
    }
    return {
      id: "3d_cube_wire",
      mode3d: true,
      label: "3D: cube (wireframe)",
      vertices: interleave(verts),
      indices: new Uint32Array(idx),
      topology: "line-list",
    };
  }

  function preset3dTet() {
    var P = [
      [0, 0.9, 0],
      [-0.75, -0.55, -0.45],
      [0.75, -0.55, -0.45],
      [0, -0.2, 0.75],
    ];
    var vc = [
      [0.95, 0.35, 0.2, 1],
      [0.35, 0.85, 0.4, 1],
      [0.4, 0.45, 0.95, 1],
      [0.7, 0.7, 0.3, 1],
    ];
    var facesT = [
      [0, 1, 2],
      [0, 1, 3],
      [0, 2, 3],
      [1, 2, 3],
    ];
    var accN = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    for (var ff = 0; ff < 4; ff++) {
      var F0 = facesT[ff];
      var a0 = P[F0[0]];
      var b0 = P[F0[1]];
      var c0 = P[F0[2]];
      var e0 = [b0[0] - a0[0], b0[1] - a0[1], b0[2] - a0[2]];
      var e1 = [c0[0] - a0[0], c0[1] - a0[1], c0[2] - a0[2]];
      var fn0 = cross3(e0, e1);
      for (var t = 0; t < 3; t++) {
        var vi = F0[t];
        accN[vi] = [accN[vi][0] + fn0[0], accN[vi][1] + fn0[1], accN[vi][2] + fn0[2]];
      }
    }
    var norms = [norm3(accN[0]), norm3(accN[1]), norm3(accN[2]), norm3(accN[3])];
    var verts = [];
    for (var v = 0; v < 4; v++) {
      var q = P[v];
      var c = vc[v];
      var nn = norms[v];
      verts.push(vertex(q[0], q[1], q[2], nn[0], nn[1], nn[2], c[0], c[1], c[2], c[3]));
    }
    var faces = [
      [0, 1, 2],
      [0, 1, 3],
      [0, 2, 3],
      [1, 2, 3],
    ];
    var idx = [];
    for (var f = 0; f < 4; f++) {
      var F = faces[f];
      idx.push(F[0], F[1], F[2]);
    }
    return {
      id: "3d_tet",
      mode3d: true,
      label: "3D: tetrahedron",
      vertices: interleave(verts),
      indices: new Uint32Array(idx),
      topology: "triangle-list",
    };
  }

  /** Heightfield in clip-ish space, shaded tris (sin/cos + radial falloff). */
  function preset3dSurface() {
    var nx = 28;
    var ny = 28;
    var x0 = -0.75;
    var x1 = 0.75;
    var y0 = -0.75;
    var y1 = 0.75;
    function zfun(x, y) {
      return (
        0.3 *
        Math.sin(2.2 * x * Math.PI) *
        Math.cos(1.8 * y * Math.PI) *
        (0.6 + 0.4 * (1 - x * x - y * y))
      );
    }
    var verts = [];
    for (var j = 0; j <= ny; j++) {
      for (var i = 0; i <= nx; i++) {
        var u = i / nx;
        var v = j / ny;
        var x = x0 + (x1 - x0) * u;
        var y = y0 + (y1 - y0) * v;
        var z = zfun(x, y);
        var c = 0.5 + 0.5 * (z / 0.32);
        if (c < 0) c = 0;
        if (c > 1) c = 1;
        verts.push(
          vertex(x, y, z, 0.15 + 0.5 * c, 0.35 + 0.4 * (1 - c) * 0.7, 0.8 + 0.15 * c, 1)
        );
      }
    }
    function vid(i, j) {
      return j * (nx + 1) + i;
    }
    var idx = [];
    for (var jj = 0; jj < ny; jj++) {
      for (var ii = 0; ii < nx; ii++) {
        var a = vid(ii, jj);
        var b = vid(ii + 1, jj);
        var c0 = vid(ii, jj + 1);
        var d = vid(ii + 1, jj + 1);
        idx.push(a, c0, b, b, c0, d);
      }
    }
    return {
      id: "3d_surface",
      mode3d: true,
      label: "3D: surface (heightfield)",
      vertices: interleave(verts),
      indices: new Uint32Array(idx),
      topology: "triangle-list",
    };
  }

  var PRESETS = {
    "2d_tri": preset2dTriangle,
    "2d_quad": preset2dQuad,
    "2d_rect": preset2dRect,
    "2d_poly": preset2dPolygon,
    "2d_hex": preset2dHex,
    "3d_cube": preset3dCubeSolid,
    "3d_cube_wire": preset3dCubeWire,
    "3d_tet": preset3dTet,
    "3d_surface": preset3dSurface,
  };

  function getPreset(name) {
    var fn = PRESETS[name];
    if (!fn) {
      return preset2dTriangle();
    }
    return fn();
  }

  global.VfGeomCore = {
    STRIDE: V,
    getPreset: getPreset,
    PRESET_IDS: Object.keys(PRESETS),
  };
})(typeof window !== "undefined" ? window : this);
