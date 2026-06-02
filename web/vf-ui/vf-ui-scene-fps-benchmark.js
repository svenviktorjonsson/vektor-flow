(function(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("node:perf_hooks").performance,
      require("./vf-shared-runtime.js"),
      require("./vf-vkf-ui-runtime.js")
    );
    return;
  }
  root.VfUiSceneFpsBenchmark = factory(root.performance, root.VfSharedRuntime, root.VfVkfUiRuntime);
})(typeof globalThis !== "undefined" ? globalThis : this, function(performanceApi, shared, vkfUi) {
  "use strict";

  var DEFAULT_CASES = [
    {
      name: "overlay_object_churn",
      objectTypes: { rects: 24, meshes: 8, points: 128, edges: 96, faces: 24 },
      vertices: 320,
      edges: 192,
      faces: 48,
      viewChangesPerFrame: 4,
      objectChangesPerFrame: 32,
      effects: { lights: 1, shadows: false, reflections: false }
    },
    {
      name: "lit_surface_view_sweep",
      objectTypes: { rects: 4, meshes: 10, points: 512, edges: 960, faces: 480 },
      vertices: 720,
      edges: 1320,
      faces: 640,
      viewChangesPerFrame: 10,
      objectChangesPerFrame: 24,
      effects: { lights: 3, shadows: true, reflections: false }
    },
    {
      name: "reflective_shadow_dense_scene",
      objectTypes: { rects: 2, meshes: 16, points: 1536, edges: 3072, faces: 1536 },
      vertices: 2048,
      edges: 4096,
      faces: 2048,
      viewChangesPerFrame: 16,
      objectChangesPerFrame: 48,
      effects: { lights: 4, shadows: true, reflections: true }
    }
  ];

  var CONTRACT = {
    metric: "ui_scene_config_space_fps",
    units: {
      frameMs: "milliseconds",
      fps: "frames_per_second",
      vertices: "count",
      edges: "count",
      faces: "count"
    },
    measured: [
      "runtime object transform mutations",
      "runtime geometry vertex mutations",
      "arena dirty transform reads",
      "arena dirty geometry reads"
    ],
    approximated: [
      "camera/view projection work",
      "lighting evaluation",
      "shadow pass overhead",
      "reflection pass overhead"
    ]
  };

  function defaultCases() {
    return DEFAULT_CASES.map(function(sceneCase) {
      return cloneJson(sceneCase);
    });
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function percentile(sorted, pct) {
    if (!sorted.length) { return 0; }
    var pos = (sorted.length - 1) * pct;
    var lo = Math.floor(pos);
    var hi = Math.ceil(pos);
    if (lo === hi) { return sorted[lo]; }
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  function stats(values) {
    var clean = values.filter(function(value) { return Number.isFinite(value); });
    if (!clean.length) {
      return { count: 0, min: 0, max: 0, mean: 0, median: 0, p95: 0, stddev: 0, ci95: 0 };
    }
    var sorted = clean.slice().sort(function(a, b) { return a - b; });
    var sum = clean.reduce(function(acc, value) { return acc + value; }, 0);
    var mean = sum / clean.length;
    var variance = clean.length > 1
      ? clean.reduce(function(acc, value) { return acc + Math.pow(value - mean, 2); }, 0) / (clean.length - 1)
      : 0;
    var stddev = Math.sqrt(variance);
    return {
      count: clean.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean: mean,
      median: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      stddev: stddev,
      ci95: clean.length > 1 ? 1.96 * stddev / Math.sqrt(clean.length) : 0
    };
  }

  function gridShape(vertexTarget, faceTarget, edgeTarget) {
    var width = Math.max(2, Math.ceil(Math.sqrt(Math.max(1, vertexTarget))));
    var height = Math.max(2, Math.ceil(vertexTarget / width));
    var coords = { x: [], y: [], z: [] };
    for (var y = 0; y < height; y += 1) {
      for (var x = 0; x < width && coords.x.length < vertexTarget; x += 1) {
        coords.x.push(x);
        coords.y.push(y);
        coords.z.push(Math.sin((x + y) * 0.17) * 0.15);
      }
    }
    var edges = [];
    var faces = [];
    function index(xi, yi) { return yi * width + xi; }
    for (y = 0; y < height; y += 1) {
      for (x = 0; x < width; x += 1) {
        var current = index(x, y);
        if (current >= vertexTarget) { continue; }
        if (x + 1 < width && index(x + 1, y) < vertexTarget && edges.length < edgeTarget) {
          edges.push([current, index(x + 1, y)]);
        }
        if (y + 1 < height && index(x, y + 1) < vertexTarget && edges.length < edgeTarget) {
          edges.push([current, index(x, y + 1)]);
        }
        if (
          x + 1 < width &&
          y + 1 < height &&
          index(x + 1, y + 1) < vertexTarget &&
          faces.length < faceTarget
        ) {
          faces.push([current, index(x + 1, y), index(x + 1, y + 1), index(x, y + 1)]);
        }
      }
    }
    return { coords: coords, edges: edges, faces: faces };
  }

  function splitCount(total, buckets, index) {
    var base = Math.floor(total / buckets);
    var remainder = total % buckets;
    return base + (index < remainder ? 1 : 0);
  }

  function buildScene(sceneCase) {
    var meshCount = Math.max(1, (sceneCase.objectTypes && sceneCase.objectTypes.meshes) | 0);
    var rectCount = Math.max(0, (sceneCase.objectTypes && sceneCase.objectTypes.rects) | 0);
    var transformCapacity = meshCount + rectCount + 4;
    var geometryCapacity = Math.max(1, sceneCase.vertices | 0);
    var arena = shared.createTransformArena(transformCapacity);
    var geometryArena = shared.createGeometryArena(geometryCapacity);
    var eventArena = shared.createEventArena(8);
    var runtime = vkfUi.createVkfUiRuntime({
      arena: arena,
      geometryArena: geometryArena,
      eventArena: eventArena,
      width: 1280,
      height: 720
    });
    var panel = runtime.ui.display.frame({ title: sceneCase.name });
    runtime.ui.display.add_frame(panel, [0, 0, 1, 1]);
    var objects = [];
    var meshes = [];
    var vertexOffset = 0;

    for (var r = 0; r < rectCount; r += 1) {
      objects.push(panel.add_rect([r * 3, r * 2, 12 + (r % 5), 8 + (r % 3)], {
        color: [0.2, 0.4, 0.8, 0.45]
      }));
    }

    for (var m = 0; m < meshCount; m += 1) {
      var vertices = splitCount(sceneCase.vertices | 0, meshCount, m);
      var edges = splitCount(sceneCase.edges | 0, meshCount, m);
      var faces = splitCount(sceneCase.faces | 0, meshCount, m);
      var shape = gridShape(vertices, faces, edges);
      var mesh = panel.add({
        x: shape.coords.x,
        y: shape.coords.y,
        z: shape.coords.z,
        bounds: [m * 8, m * 4, 64, 48]
      }, {
        face_color: [0.2, 0.7, 0.9, 0.55],
        edge_color: [0.9, 0.9, 0.95, 0.9],
        vertex_color: [1, 0.8, 0.3, 1]
      });
      mesh.add_vertices(shape.coords.x.map(function(_value, index) { return index; }));
      mesh.add_edges(shape.edges);
      mesh.add_faces(shape.faces);
      mesh.__benchVertexBase = vertexOffset;
      vertexOffset += vertices;
      meshes.push(mesh);
      objects.push(mesh);
    }

    arena.copyDirtyMat4();
    geometryArena.consumeDirtyRange();
    return {
      arena: arena,
      geometryArena: geometryArena,
      runtime: runtime,
      panel: panel,
      meshes: meshes,
      objects: objects
    };
  }

  function rendererApproximation(sceneCase, frameIndex, dirtyVertices, dirtyTransforms) {
    var effects = sceneCase.effects || {};
    var lights = Math.max(0, effects.lights | 0);
    var shadowFactor = effects.shadows ? 2 : 0;
    var reflectionFactor = effects.reflections ? 2 : 0;
    var viewOps = Math.max(0, sceneCase.viewChangesPerFrame | 0) * 96;
    var geometryOps = Math.ceil((sceneCase.vertices + sceneCase.edges * 0.5 + sceneCase.faces * 2) / 12);
    var effectOps = Math.ceil((sceneCase.faces + dirtyVertices) * (lights + shadowFactor + reflectionFactor) / 18);
    var dirtyOps = Math.max(0, dirtyTransforms) * 32 + Math.max(0, dirtyVertices) * 12;
    var iterations = Math.max(1, viewOps + geometryOps + effectOps + dirtyOps);
    var acc = 0;
    for (var i = 0; i < iterations; i += 1) {
      acc += Math.sin((i + frameIndex) * 0.011) * Math.cos((i + lights + 1) * 0.017);
    }
    return acc;
  }

  function mutateFrame(scene, sceneCase, frameIndex) {
    var meshes = scene.meshes;
    var objects = scene.objects;
    var viewChanges = Math.max(0, sceneCase.viewChangesPerFrame | 0);
    var objectChanges = Math.max(0, sceneCase.objectChangesPerFrame | 0);
    var m;
    for (var i = 0; i < viewChanges; i += 1) {
      var object = objects[(frameIndex + i) % objects.length];
      object.translate({ trans: [Math.sin((frameIndex + i) * 0.07) * 0.15, Math.cos((frameIndex + i) * 0.05) * 0.12] });
    }
    for (i = 0; i < objectChanges; i += 1) {
      m = meshes[(frameIndex + i) % meshes.length];
      if (!m.coords.x.length) { continue; }
      var vertex = (frameIndex * 17 + i * 7) % m.coords.x.length;
      m.move_vertex({
        vertex: vertex,
        local_trans: [
          Math.sin((frameIndex + i) * 0.13) * 0.05,
          Math.cos((frameIndex + i) * 0.19) * 0.05
        ]
      });
    }
  }

  function rangeCount(range) {
    if (!range || range.min < 0 || range.max < range.min) { return 0; }
    return range.max - range.min + 1;
  }

  function runSceneCase(sceneCase, options) {
    options = options || {};
    var warmupFrames = Math.max(0, options.warmupFrames == null ? 8 : options.warmupFrames | 0);
    var frames = Math.max(1, options.frames == null ? 40 : options.frames | 0);
    var scene = buildScene(sceneCase);
    var frameMs = [];
    var dirtyVertexCounts = [];
    var dirtyTransformCounts = [];
    var sink = 0;

    for (var warm = 0; warm < warmupFrames; warm += 1) {
      mutateFrame(scene, sceneCase, warm);
      scene.arena.copyDirtyMat4();
      scene.geometryArena.copyDirtyVertices();
      scene.geometryArena.consumeDirtyRange();
      sink += rendererApproximation(sceneCase, warm, 0, 0);
    }

    for (var frame = 0; frame < frames; frame += 1) {
      var started = performanceApi.now();
      mutateFrame(scene, sceneCase, frame);
      var transformDirty = scene.arena.copyDirtyMat4();
      var geometryDirty = scene.geometryArena.copyDirtyVertices();
      var dirtyTransforms = rangeCount(transformDirty.range);
      var dirtyVertices = rangeCount(geometryDirty.range);
      sink += rendererApproximation(sceneCase, frame, dirtyVertices, dirtyTransforms);
      scene.geometryArena.consumeDirtyRange();
      frameMs.push(performanceApi.now() - started);
      dirtyVertexCounts.push(dirtyVertices);
      dirtyTransformCounts.push(dirtyTransforms);
    }

    var frameStats = stats(frameMs);
    var p95FrameMs = Math.max(frameStats.p95, 0.000001);
    return {
      name: sceneCase.name,
      config: cloneJson(sceneCase),
      object_types: cloneJson(sceneCase.objectTypes || {}),
      geometry: {
        vertices: sceneCase.vertices | 0,
        edges: sceneCase.edges | 0,
        faces: sceneCase.faces | 0
      },
      changes_per_frame: {
        view: sceneCase.viewChangesPerFrame | 0,
        object: sceneCase.objectChangesPerFrame | 0
      },
      effects: cloneJson(sceneCase.effects || {}),
      frame_ms: frameStats,
      fps_possible: {
        median: 1000 / Math.max(frameStats.median, 0.000001),
        p95_budgeted: 1000 / p95FrameMs
      },
      dirty_vertices: stats(dirtyVertexCounts),
      dirty_transforms: stats(dirtyTransformCounts),
      approximation_model: CONTRACT.approximated.slice(),
      _sink: sink
    };
  }

  function runUiSceneFpsBenchmark(options) {
    options = options || {};
    var cases = Array.isArray(options.cases) && options.cases.length ? options.cases : defaultCases();
    var results = cases.map(function(sceneCase) {
      return runSceneCase(sceneCase, options);
    });
    var fpsValues = results.map(function(result) { return result.fps_possible.p95_budgeted; });
    return {
      contract: cloneJson(CONTRACT),
      frames_per_case: Math.max(1, options.frames == null ? 40 : options.frames | 0),
      warmup_frames_per_case: Math.max(0, options.warmupFrames == null ? 8 : options.warmupFrames | 0),
      cases: results.map(function(result) {
        var clean = cloneJson(result);
        delete clean._sink;
        return clean;
      }),
      summary: {
        cases: results.length,
        min_p95_budgeted_fps: Math.min.apply(null, fpsValues),
        median_p95_budgeted_fps: percentile(fpsValues.slice().sort(function(a, b) { return a - b; }), 0.5),
        max_p95_budgeted_fps: Math.max.apply(null, fpsValues)
      }
    };
  }

  return {
    CONTRACT: CONTRACT,
    defaultCases: defaultCases,
    runSceneCase: runSceneCase,
    runUiSceneFpsBenchmark: runUiSceneFpsBenchmark
  };
});
