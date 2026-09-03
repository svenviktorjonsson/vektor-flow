import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const nativeBin = process.env.VKF_NATIVE_COMPILER_BIN;
const workRoot = path.join(
  repositoryRoot,
  ".w",
  `material-gallery-webgpu-plan-${process.pid}`,
);

after(() => rm(workRoot, { recursive: true, force: true }));

function compilerTool(name) {
  assert.ok(
    nativeBin,
    "VKF_NATIVE_COMPILER_BIN must name the focused native build directory",
  );
  return path.join(
    nativeBin,
    process.platform === "win32" ? `${name}.exe` : name,
  );
}

function stage(name, input, args = []) {
  const result = spawnSync(compilerTool(name), args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    input,
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    result.stderr || `${name} failed without diagnostics`,
  );
  return result.stdout;
}

async function compileWebGpu(source, sourceText, typedIrName) {
  const tokens = stage("vkf_lexer_cursor_smoke", undefined, ["--file", source]);
  const ast = stage("vkf_parser_token_stream_smoke", tokens);
  const typedIr = stage("vkf_ast_to_ir_smoke", ast);
  const typedIrPath = path.join(workRoot, typedIrName);
  await writeFile(typedIrPath, typedIr, "utf8");
  const summary = JSON.parse(stage("vkf_webgpu_artifact_smoke", undefined, [
    "--source",
    source,
    "--typed-ir",
    typedIrPath,
  ]));
  return Promise.all([
    readFile(summary.artifact_path, "utf8"),
    readFile(summary.manifest_path, "utf8").then(JSON.parse),
  ]);
}

test("Frame render detection is independent of the binding name", async () => {
  await mkdir(workRoot, { recursive: true });
  const source = path.join(workRoot, "renamed-scene.vkf");
  const sourceText = [
    ": .ui.display",
    "display: Display(dim:2)",
    "view: display.add_frame(pos:[0.08, 0.08], size:[0.84, 0.84])",
    "surface: view.add(x:[[-1, 1], [-1, 1]], y:[[0, 0], [2, 2]], z:[[0, 0], [0, 0]], id:\"surface\", color:[0.2, 0.7, 1, 1])",
    "result: view.push()",
    "",
  ].join("\n");
  await writeFile(source, sourceText, "utf8");
  const [, manifest] = await compileWebGpu(
    source,
    sourceText,
    "renamed-scene.typed-ir.json",
  );
  assert.equal(
    manifest.runtime_surface?.update_mode,
    "retained_scene_render",
  );
});

test("compiled reflected light keeps horizontal parity", async () => {
  await mkdir(workRoot, { recursive: true });
  const sourcePosition = [-1.25, -6.0, 5.0];
  const source = path.join(workRoot, "reflected-light-parity.vkf");
  const sourceText = [
    ": .ui.display",
    "display: Display(dim:2)",
    "frame: display.add_frame(pos:[0.08, 0.08], size:[0.84, 0.84])",
    "frame.add_camera(pos:[0, -6, 3], target:[0, 0, 1.5], up:[0, 0, 1], fov:43)",
    `source: frame.add(x:[[-1.35, -1.15], [-1.35, -1.15]], y:[[-6.1, -6.1], [-5.9, -5.9]], z:[[5, 5], [5, 5]], id:"source", color:[1, 1, 1, 1], emission:[1, 1, 1])`,
    "mirror: frame.add(x:[[-2, 2], [-2, 2]], y:[[0, 0], [0, 0]], z:[[0, 0], [3, 3]], id:\"mirror\", color:[0.34, 0.34, 0.34, 1], reflectivity:1.0)",
    "view: frame.push()",
    "",
  ].join("\n");
  await writeFile(source, sourceText, "utf8");

  const [wgsl, manifest] = await compileWebGpu(
    source,
    sourceText,
    "reflected-light-parity.typed-ir.json",
  );
  assert.doesNotMatch(
    sourceText,
    /native_scene|add_light|kind:\s*"projected"/u,
  );
  assert.deepEqual(
    manifest.runtime_surface.render_plan.emitter_views.map((view) => ({
      id: view.id,
      source_id: view.source_id,
      source_light_index: view.source_light_index,
      reflect_surface_id: view.reflect_surface_id,
    })),
    [{
      id: "source@mirror",
      source_id: "source",
      source_light_index: 0,
      reflect_surface_id: "mirror",
    }],
  );

  assert.match(
    wgsl,
    /vkf_reflect_point\(\s*source\.position_and_range\.xyz,\s*aperture_0,\s*plane_normal\)/u,
  );
  assert.match(
    wgsl,
    /derived_lights\[light_index\]\.color_and_intensity\s*=\s*source\.color_and_intensity;/u,
    "a planar mirror must derive its virtual light energy from the one source",
  );
  assert.match(
    wgsl,
    /let x_axis = vkf_safe_normalize\(cross\(up_hint, z_axis\)\);/u,
  );
  assert.match(
    wgsl,
    /let projected_view = vkf_look_at\(\s*derived_lights\[light_index\]\.position_and_range\.xyz,\s*derived_lights\[light_index\]\.target_and_radius\.xyz,\s*vkf_adaptive_shadow_up\(projected_direction\)\s*\);/u,
  );
  assert.match(
    wgsl,
    /if \(dot\(projected_right, aperture_right\) < 0\.0\) \{\s*projected_projection = vkf_flip_clip_x\(\) \* projected_projection;/u,
  );

  const subtract = (left, right) => left.map((value, index) =>
    value - right[index]);
  const dot = (left, right) => left.reduce(
    (sum, value, index) => sum + value * right[index],
    0,
  );
  const cross = (left, right) => [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
  const normalize = (value) => {
    const length = Math.sqrt(dot(value, value));
    return value.map((component) => component / length);
  };
  const planePoint = [0.0, 0.0, 0.0];
  const planeNormal = [0.0, 1.0, 0.0];
  const sourceOffset = subtract(sourcePosition, planePoint);
  const reflectedPosition = sourcePosition.map((value, index) =>
    value - 2.0 * dot(sourceOffset, planeNormal) * planeNormal[index]);
  assert.deepEqual(reflectedPosition, [-1.25, 6.0, 5.0]);

  const apertureCenter = [0.0, 0.0, 1.5];
  const zAxis = normalize(subtract(reflectedPosition, apertureCenter));
  const xAxis = normalize(cross([0.0, 0.0, 1.0], zAxis));
  const parity = dot(xAxis, [1.0, 0.0, 0.0]) < 0.0 ? -1.0 : 1.0;
  const cameraX = (point) =>
    parity * dot(xAxis, subtract(point, reflectedPosition));
  assert.ok(cameraX([-1.5, 0.0, 2.0]) < cameraX([1.5, 0.0, 2.0]));
});

test("compiled mirror keeps double-sided geometry with one-sided reflection", async () => {
  await mkdir(workRoot, { recursive: true });
  const source = path.join(workRoot, "one-sided-mirror.vkf");
  const sourceText = [
    ": .ui.display",
    "display: Display(dim:2)",
    "frame: display.add_frame(pos:[0.08, 0.08], size:[0.84, 0.84])",
    "frame.add_camera(pos:[0, 3, 1], target:[0, 0, 1], up:[0, 0, 1], fov:43)",
    "mirror: frame.add(x:[[-2, 2], [-2, 2]], y:[[0, 0], [0, 0]], z:[[0, 0], [2, 2]], id:\"mirror\", color:[0.34, 0.34, 0.34, 1], reflectivity:1.0)",
    "view: frame.push()",
    "",
  ].join("\n");
  await writeFile(source, sourceText, "utf8");

  const [wgsl, manifest] = await compileWebGpu(
    source,
    sourceText,
    "one-sided-mirror.typed-ir.json",
  );
  const render = manifest.runtime_surface.render_plan;
  const pipelines = new Map(render.pipelines.map((pipeline) => [
    pipeline.id,
    pipeline,
  ]));
  assert.equal(pipelines.get("retained_scene_hdr").cull_mode, "none");
  assert.equal(pipelines.get("retained_scene_present").cull_mode, "none");
  assert.equal(
    render.passes.filter(({ kind }) => kind === "planar_reflection").length,
    1,
    "one planar reflective geometry must infer one optical reflection path",
  );
  assert.deepEqual(render.reflective_surfaces, [
    { id: "mirror", object_index: 0 },
  ]);
  assert.doesNotMatch(wgsl, /surface_kind == 2u[^}]*discard/su);
  assert.match(
    wgsl,
    /if \(object\.surface_kind == 2u && !front_facing\) \{\s*let ambient_backface = material_color\.rgb \* scene\.ambient\.rgb;\s*return vec4<f32>\(ambient_backface, material_color\.a\);\s*\}/u,
  );
  assert.match(
    wgsl,
    /object\.reflectivity > 0\.0 && mirror_front_visible/u,
    "front-facing mirror fragments must retain planar reflection",
  );
});

test("material gallery compiles to a feature-specialized retained-scene GPU plan", async () => {
  await mkdir(workRoot, { recursive: true });
  const source = path.join(
    repositoryRoot,
    "examples",
    "material_ui_gallery",
    "app.vkf",
  );
  const sourceText = await readFile(source, "utf8");
  assert.doesNotMatch(
    sourceText,
    /native_scene|add_light|kind:\s*"projected"/u,
    "the shipped gallery must use only canonical Frame.add/push scene construction",
  );
  const [wgsl, manifest] = await compileWebGpu(
    source,
    sourceText,
    "gallery.typed-ir.json",
  );
  const render = manifest.runtime_surface?.render_plan;
  assert.ok(render, "manifest must contain the compiler-owned render plan");
  assert.equal(render.schema, "vektor-flow/retained-scene-render-plan");
  assert.equal(render.version, 1);
  assert.equal(render.execution_owner, "wasm_wgsl");
  assert.equal(
    render.draw_lists_source,
    "runtime_surface.render_parameter_arena.draw_lists",
  );
  assert.equal(
    render.parameter_arena_source,
    "runtime_surface.render_parameter_arena",
  );
  assert.deepEqual(render.platform_inputs, [
    { name: "viewport_width", type: "f32" },
    { name: "viewport_height", type: "f32" },
  ]);
  assert.equal(
    render.max_reflection_depth,
    1,
    "visual reflections must remain direct so floor and mirror do not duplicate one another's background scene",
  );
  assert.deepEqual(render.arena, {
    metadata_source: "wasm_retained_scene_arena",
    vertex_storage: "float32",
    index_storage: "uint32",
  });
  assert.deepEqual(render.vertex_layout, {
    array_stride: 40,
    step_mode: "vertex",
    attributes: [
      { shader_location: 0, offset: 0, format: "float32x3" },
      { shader_location: 1, offset: 12, format: "float32x3" },
      { shader_location: 2, offset: 24, format: "float32x4" },
    ],
  });
  assert.deepEqual(
    render.bindings.map(({ group, binding, resource }) => ({
      group,
      binding,
      resource,
    })),
    [
      { group: 0, binding: 0, resource: "derived_scene" },
      { group: 0, binding: 1, resource: "derived_lights" },
      { group: 0, binding: 2, resource: "shadow_depth" },
      { group: 0, binding: 3, resource: "shadow_comparison_sampler" },
      { group: 0, binding: 4, resource: "pass.reflection_sources_by_object" },
      { group: 0, binding: 5, resource: "planar_reflection_sampler" },
      { group: 0, binding: 6, resource: "pass_state_arena" },
      { group: 1, binding: 0, resource: "derived_objects" },
      { group: 2, binding: 1, resource: "render_parameter_arena.lights" },
      { group: 2, binding: 2, resource: "render_parameter_arena.objects" },
      { group: 2, binding: 3, resource: "retained_scene_arena" },
    ],
  );
  assert.deepEqual(
    render.pipelines,
    [
      {
        id: "prepare_frame",
        compute_entry: "vkf_prepare_frame",
        workgroup_size: [64, 1, 1],
      },
      {
        id: "prepare_shadow_views",
        compute_entry: "vkf_refit_shadow_views",
        workgroup_size: [1, 1, 1],
      },
      {
        id: "prepare_reflection_camera",
        compute_entry: "vkf_prepare_reflection_camera",
        workgroup_size: [1, 1, 1],
      },
      {
        id: "shadow_depth",
        vertex_entry: "vkf_shadow_vertex",
        fragment_entry: null,
        depth_write: true,
        color_target: false,
        depth_format: "depth32float",
        depth_compare: "less",
        depth_bias: 0,
        depth_bias_clamp: 0,
        depth_bias_slope_scale: 0,
        cull_mode: "none",
      },
      {
        id: "retained_scene_hdr",
        vertex_entry: "vkf_reflection_vertex",
        fragment_entry: "vkf_scene_fragment",
        depth_write: true,
        color_target: true,
        color_format: "rgba16float",
        sample_count: 1,
        depth_format: "depth32float",
        depth_compare: "less",
        cull_mode: "none",
      },
      {
        id: "retained_scene_terminal_hdr",
        vertex_entry: "vkf_reflection_vertex",
        fragment_entry: "vkf_terminal_scene_fragment",
        depth_write: true,
        color_target: true,
        color_format: "rgba16float",
        sample_count: 1,
        depth_format: "depth32float",
        depth_compare: "less",
        cull_mode: "none",
      },
      {
        id: "retained_scene_hdr_msaa",
        vertex_entry: "vkf_scene_vertex",
        fragment_entry: "vkf_scene_fragment",
        depth_write: true,
        color_target: true,
        color_format: "rgba16float",
        sample_count: 4,
        depth_format: "depth32float",
        depth_compare: "less",
        cull_mode: "none",
      },
      {
        id: "retained_scene_terminal_hdr_msaa",
        vertex_entry: "vkf_scene_vertex",
        fragment_entry: "vkf_terminal_scene_fragment",
        depth_write: true,
        color_target: true,
        color_format: "rgba16float",
        sample_count: 4,
        depth_format: "depth32float",
        depth_compare: "less",
        cull_mode: "none",
      },
      {
        id: "retained_scene_present",
        vertex_entry: "vkf_present_vertex",
        fragment_entry: "vkf_present_fragment",
        vertex_buffers: false,
        color_target: true,
        color_format: "preferred_canvas_format",
        sample_count: 1,
        cull_mode: "none",
      },
      {
        id: "reflection_emitters",
        vertex_entry: "vkf_reflection_emitter_vertex",
        fragment_entry: "vkf_emitter_fragment",
        vertex_buffers: false,
        depth_write: true,
        color_target: true,
        color_format: "rgba16float",
        sample_count: 1,
        blend: "additive",
        depth_format: "depth32float",
        depth_compare: "less",
        cull_mode: "none",
      },
      {
        id: "reflection_flares",
        vertex_entry: "vkf_reflection_flare_vertex",
        fragment_entry: "vkf_flare_fragment",
        vertex_buffers: false,
        depth_write: false,
        color_target: true,
        color_format: "rgba16float",
        sample_count: 1,
        depth_format: "depth32float",
        depth_compare: "less-equal",
        cull_mode: "none",
        blend: "additive",
      },
      {
        id: "light_emitters",
        vertex_entry: "vkf_emitter_vertex",
        fragment_entry: "vkf_emitter_fragment",
        vertex_buffers: false,
        depth_write: true,
        color_target: true,
        color_format: "rgba16float",
        sample_count: 4,
        blend: "additive",
        depth_format: "depth32float",
        depth_compare: "less",
        cull_mode: "none",
      },
      {
        id: "light_flares",
        vertex_entry: "vkf_flare_vertex",
        fragment_entry: "vkf_flare_fragment",
        vertex_buffers: false,
        depth_write: false,
        color_target: true,
        color_format: "rgba16float",
        sample_count: 4,
        depth_format: "depth32float",
        depth_compare: "less-equal",
        cull_mode: "none",
        blend: "additive",
      },
    ],
  );
  assert.deepEqual(render.derived_buffers, [
    {
      id: "derived_scene",
      kind: "storage_uniform",
      size_policy: "scene_camera_layout",
      byte_size: 768,
      usage: ["storage", "uniform"],
    },
    {
      id: "derived_lights",
      kind: "storage",
      size_policy: "light_count",
      stride: 112,
      byte_size: 672,
      usage: ["storage"],
    },
    {
      id: "derived_objects",
      kind: "storage_uniform",
      size_policy: "object_count",
      stride: 256,
      byte_size: 1280,
      usage: ["storage", "uniform"],
    },
  ]);
  assert.deepEqual(
    render.control_buffers.map(({ id, byte_size, usage }) => ({
      id,
      byte_size,
      usage,
    })),
    [
      {
        id: "pass_state_arena",
        byte_size: 3584,
        usage: ["uniform", "copy_dst"],
      },
      {
        id: "platform_viewport",
        byte_size: 8,
        usage: ["uniform", "copy_dst"],
      },
    ],
  );
  assert.deepEqual(
    render.samplers.map(({ id, kind, compare, mag_filter, min_filter }) => ({
      id,
      kind,
      compare,
      mag_filter,
      min_filter,
    })),
    [
      {
        id: "shadow_comparison_sampler",
        kind: "comparison",
        compare: "less",
        mag_filter: "linear",
        min_filter: "linear",
      },
      {
        id: "planar_reflection_sampler",
        kind: "filtering",
        compare: undefined,
        mag_filter: "linear",
        min_filter: "linear",
      },
    ],
  );
  assert.deepEqual(
    render.parameter_bindings.map(({ group, binding, source }) => ({
      group,
      binding,
      source,
    })),
    [
      { group: 2, binding: 0, source: "render_parameter_arena.camera" },
      { group: 2, binding: 1, source: "render_parameter_arena.lights" },
      { group: 2, binding: 2, source: "render_parameter_arena.objects" },
      { group: 2, binding: 3, source: "retained_scene_arena" },
      { group: 2, binding: 4, source: "platform_viewport" },
      { group: 3, binding: 0, source: "derived_scene" },
      { group: 3, binding: 1, source: "derived_lights" },
      { group: 3, binding: 2, source: "derived_objects" },
    ],
  );
  assert.equal(render.light_count, 6);
  assert.deepEqual(render.reflective_surfaces, [
    { id: "studio_floor", object_index: 0 },
    { id: "upright_mirror", object_index: 1 },
  ]);
  const shadowPasses = render.passes.filter(({ kind }) => kind === "shadow_depth");
  const directShadowPasses = shadowPasses.filter(({ light_id }) =>
    light_id === "red_emitter" || light_id === "green_emitter"
  );
  assert.equal(directShadowPasses.length, 2);
  assert.ok(directShadowPasses.every(({ draw_list_id, shadow_view }) =>
    draw_list_id === "shadow_casters" &&
      shadow_view.coverage === "fitted_scene" &&
      shadow_view.projection === "perspective"
  ));
  const projectedShadowPasses = shadowPasses.filter(({ light_id }) =>
    light_id.includes("@")
  );
  assert.deepEqual(
    projectedShadowPasses.map(({ light_id }) => light_id),
    [
      "red_emitter@studio_floor",
      "red_emitter@upright_mirror",
      "green_emitter@studio_floor",
      "green_emitter@upright_mirror",
    ],
  );
  assert.ok(
    projectedShadowPasses.every(({ draw_list_id, shadow_view }) =>
      draw_list_id === "shadow_casters" &&
        shadow_view.coverage === "fitted_scene" &&
        shadow_view.projection === "perspective"
    ),
  );
  assert.equal(shadowPasses.length, 6);
  assert.equal(render.passes[0].kind, "prepare_frame");
  assert.equal(render.passes[0].pipeline, "prepare_frame");
  assert.deepEqual(
    render.passes[0].bind_groups.find(({ group }) => group === 2)
      .entries.map(({ binding }) => binding),
    [0, 1, 2, 4],
    "frame preparation must bind exactly the resources used by its auto layout",
  );
  const shadowViewPrepare = render.passes.find(
    ({ kind }) => kind === "prepare_shadow_views",
  );
  assert.ok(shadowViewPrepare, "dynamic LightViews require an ordered refit pass");
  assert.deepEqual(
    shadowViewPrepare.bind_groups.find(({ group }) => group === 2)
      .entries.map(({ binding }) => binding),
    [1, 2],
    "shadow refit must not bind camera/viewport entries absent from auto layout",
  );
  assert.ok(
    render.passes.indexOf(shadowViewPrepare) > 0 &&
      render.passes.indexOf(shadowViewPrepare) <
        render.passes.findIndex(({ kind }) => kind === "shadow_depth"),
    "the GPU pass boundary must order object derivation before LightView refit and depth",
  );
  const reflectionPrepasses = render.passes.filter(
    ({ kind }) => kind === "prepare_reflection_camera",
  );
  assert.equal(reflectionPrepasses.length, 2);
  assert.deepEqual(
    reflectionPrepasses.map(({ reflection_path, parent_camera_state_index }) => ({
      reflection_path,
      parent_camera_state_index,
    })),
    [
      { reflection_path: ["studio_floor"], parent_camera_state_index: null },
      { reflection_path: ["upright_mirror"], parent_camera_state_index: null },
    ],
    "floor and mirror each require one direct reflected observer",
  );
  assert.ok(reflectionPrepasses.every(({ aperture }) =>
    aperture?.arena === "retained_scene_arena" &&
      aperture.vertex_count >= 4 && aperture.vertex_stride === 40
  ));
  assert.equal(
    reflectionPrepasses.find(({ surface_id }) =>
      surface_id === "upright_mirror"
    ).aperture.vertex_count,
    6,
  );
  for (const pass of render.passes) {
    assert.ok(Array.isArray(pass.bind_resources), `${pass.kind} binds resources`);
    assert.ok(pass.bind_resources.length > 0, `${pass.kind} binds resources`);
    assert.ok(Array.isArray(pass.bind_groups), `${pass.kind} maps bind groups`);
    for (const group of pass.bind_groups) {
      assert.equal(typeof group.group, "number");
      assert.ok(group.entries.length > 0);
      for (const entry of group.entries) {
        assert.equal(typeof entry.binding, "number");
        assert.equal(typeof entry.source, "string");
        assert.equal(typeof entry.resource_type, "string");
        assert.ok(Object.hasOwn(entry, "size"));
        assert.equal(typeof entry.dynamic_offset, "boolean");
      }
    }
    if (pass.kind.startsWith("prepare_")) {
      assert.deepEqual(pass.viewport, { policy: "none" });
      assert.deepEqual(Object.keys(pass.dispatch).sort(), ["x", "y", "z"]);
      continue;
    }
    assert.deepEqual(pass.viewport, { policy: "target" });
    if (pass.kind === "shadow_depth") {
      assert.deepEqual(pass.depth, {
        target: "shadow_depth",
        array_layer: pass.target_layer,
        load_op: "clear",
        store_op: "store",
        clear_value: 1,
        read_only: false,
      });
      assert.equal(pass.color, null);
      continue;
    }
    if (pass.kind === "light_flares" || pass.kind === "light_emitters") {
      assert.deepEqual(pass.color, {
        target: "scene_hdr_msaa",
        load_op: "load",
        store_op: "store",
        resolve_target: "scene_hdr",
      });
      assert.deepEqual(pass.depth, {
        target: "scene_depth_msaa",
        array_layer: 0,
        load_op: "load",
        store_op: "store",
        clear_value: 1,
        read_only: pass.kind === "light_flares",
      });
      continue;
    }
    if (pass.kind === "scene_present") {
      assert.deepEqual(pass.color, {
        target: "swap_chain",
        load_op: "clear",
        store_op: "store",
        clear_value: [0.012, 0.018, 0.032, 1],
      });
      assert.equal(pass.depth, undefined);
      continue;
    }
    if (pass.kind === "reflection_emitters" || pass.kind === "reflection_flares") {
      assert.deepEqual(pass.color, {
        target: pass.color_attachment,
        load_op: "load",
        store_op: "store",
        resolve_target: null,
      });
      assert.deepEqual(pass.depth, {
        target: pass.depth_attachment,
        array_layer: 0,
        load_op: "load",
        store_op: "store",
        clear_value: 1,
        read_only: pass.kind === "reflection_flares",
      });
      continue;
    }
    assert.deepEqual(pass.color, {
      target: pass.color_attachment,
      load_op: "clear",
      store_op: "store",
      clear_value: [0.012, 0.018, 0.032, 1],
      resolve_target: pass.resolve_target ?? null,
    });
    assert.deepEqual(pass.depth, {
      target: pass.depth_attachment,
      array_layer: 0,
      load_op: "clear",
      store_op: "store",
      clear_value: 1,
      read_only: false,
    });
  }
  const statefulPasses = render.passes.filter((pass) => pass.pass_state);
  assert.equal(statefulPasses.length, 14);
  assert.deepEqual(
    statefulPasses.map(({ pass_state_byte_offset }) => pass_state_byte_offset),
    Array.from({ length: statefulPasses.length }, (_, index) => index * 256),
  );
  assert.equal(
    new Set(statefulPasses.map(({ pass_state_byte_offset }) =>
      pass_state_byte_offset
    )).size,
    statefulPasses.length,
  );
  assert.ok(statefulPasses.every(({ pass_state_byte_offset, bind_groups }) => {
    const stateBinding = bind_groups
      .find(({ group }) => group === 0)?.entries
      .find(({ binding }) => binding === 6);
    return pass_state_byte_offset % 256 === 0 &&
      stateBinding?.source === "pass_state_arena" &&
      stateBinding.offset === pass_state_byte_offset &&
      stateBinding.size === 32 && stateBinding.dynamic_offset === false;
  }));
  const passStateBuffer = render.control_buffers.find(({ id }) =>
    id === "pass_state_arena"
  );
  assert.equal(passStateBuffer.record_stride, 256);
  assert.equal(passStateBuffer.record_byte_length, 32);
  assert.equal(passStateBuffer.records.length, statefulPasses.length);
  assert.deepEqual(
    passStateBuffer.records.map(({ byte_offset }) => byte_offset),
    Array.from({ length: statefulPasses.length }, (_, index) => index * 256),
  );
  for (const pass of render.passes.filter(({ draw_list_id }) => draw_list_id)) {
    assert.deepEqual(pass.object_binding, {
      group: 1,
      binding: 0,
      source: "derived_objects",
      byte_offset_source: "draw.object_uniform_byte_offset",
      byte_length_source: "draw.object_uniform_byte_length",
      dynamic_offset: false,
    });
  }
  assert.deepEqual(
    directShadowPasses.map(({
      light_index, camera_state_id, camera_state_index, target_layer,
    }) => ({ light_index, camera_state_id, camera_state_index, target_layer })),
    [
      {
        light_index: 0,
        camera_state_id: "light:red_emitter",
        camera_state_index: 0,
        target_layer: 0,
      },
      {
        light_index: 1,
        camera_state_id: "light:green_emitter",
        camera_state_index: 1,
        target_layer: 1,
      },
    ],
  );
  assert.deepEqual(
    projectedShadowPasses.map(({
      light_index, camera_state_id, camera_state_index, target_layer,
    }) => ({ light_index, camera_state_id, camera_state_index, target_layer })),
    [
      {
        light_index: 2,
        camera_state_id: "light:red_emitter@studio_floor",
        camera_state_index: 2,
        target_layer: 2,
      },
      {
        light_index: 3,
        camera_state_id: "light:red_emitter@upright_mirror",
        camera_state_index: 3,
        target_layer: 3,
      },
      {
        light_index: 4,
        camera_state_id: "light:green_emitter@studio_floor",
        camera_state_index: 4,
        target_layer: 4,
      },
      {
        light_index: 5,
        camera_state_id: "light:green_emitter@upright_mirror",
        camera_state_index: 5,
        target_layer: 5,
      },
    ],
  );
  const reflectionPasses = render.passes.filter(
    ({ kind }) => kind === "planar_reflection",
  );
  assert.equal(reflectionPasses.length, 2);
  assert.deepEqual(
    reflectionPasses.map(({ reflection_path, target }) => ({
      reflection_path,
      target,
    })),
    [
      {
        reflection_path: ["studio_floor"],
        target: "planar_reflection_studio_floor_1",
      },
      {
        reflection_path: ["upright_mirror"],
        target: "planar_reflection_upright_mirror_1",
      },
    ],
    "visual reflection passes must not recurse through another reflective surface",
  );
  assert.equal(
    new Set(reflectionPasses.map(({ camera_state_id }) => camera_state_id)).size,
    reflectionPasses.length,
  );
  for (const pass of reflectionPasses) {
    assert.equal(pass.camera_state_id, `reflection:${pass.reflection_path.join(">")}`);
    assert.equal(
      pass.draw_list_id,
      `reflection_visible_${pass.surface_id}_${pass.reflection_depth}`,
    );
    assert.equal(
      pass.reflection_source,
      undefined,
      "a reflection pass must not bind one surface texture to every reflective object",
    );
    assert.equal(pass.pipeline, "retained_scene_terminal_hdr");
    assert.equal(pass.fragment_entry, "vkf_terminal_scene_fragment");
    assert.equal(pass.reflection_sources, undefined);
    assert.ok(pass.bind_groups.every(({ entries }) =>
      entries.every(({ binding }) => binding !== 4 && binding !== 5)
    ));
  }
  assert.deepEqual(
    render.emitter_sources.map(({ id, object_index, casts_shadow }) => ({
      id,
      object_index,
      casts_shadow,
    })),
    [
      { id: "red_emitter", object_index: 3, casts_shadow: true },
      { id: "green_emitter", object_index: 4, casts_shadow: true },
    ],
    "emissive geometry remains the sole visible source geometry",
  );
  assert.equal(render.emitter_views.length, 4);
  assert.deepEqual(
    render.passes.filter(({ kind }) =>
      kind === "reflection_emitters" || kind === "reflection_flares" ||
        kind === "light_emitters" || kind === "light_flares"
    ).map(({ kind }) => kind),
    [
      "reflection_flares",
      "reflection_emitters",
      "reflection_flares",
      "reflection_emitters",
      "light_flares",
      "light_emitters",
    ],
    "the two physical emitters and their flares must remain visible in direct and reflected views",
  );
  const scenePass = render.passes.find(({ kind }) => kind === "scene_color");
  assert.equal(scenePass.pass_state, undefined);
  const presentStateBinding = scenePass.bind_groups
    .find(({ group }) => group === 0)?.entries
    .find(({ binding }) => binding === 6);
  assert.equal(presentStateBinding, undefined);
  assert.deepEqual(
    {
      pipeline: scenePass.pipeline,
      color_attachment: scenePass.color_attachment,
      resolve_target: scenePass.resolve_target,
      depth_attachment: scenePass.depth_attachment,
    },
    {
      pipeline: "retained_scene_hdr_msaa",
      color_attachment: "scene_hdr_msaa",
      resolve_target: "scene_hdr",
      depth_attachment: "scene_depth_msaa",
    },
  );
  const targetsById = new Map(render.targets.map((target) => [target.id, target]));
  assert.deepEqual(
    {
      size_policy: targetsById.get("planar_reflection_studio_floor_1").size_policy,
      scale: targetsById.get("planar_reflection_studio_floor_1").scale,
    },
    { size_policy: "canvas_scale", scale: 0.5 },
  );
  assert.deepEqual(
    {
      size_policy: targetsById.get("planar_reflection_upright_mirror_1").size_policy,
      scale: targetsById.get("planar_reflection_upright_mirror_1").scale,
    },
    { size_policy: "canvas", scale: 1 },
  );
  assert.ok(
    [...targetsById.keys()].every((targetId) =>
      !targetId.includes("studio_floor__upright_mirror") &&
      !targetId.includes("upright_mirror__studio_floor")
    ),
    "the plan must not allocate cross-surface reflection targets",
  );
  const pipelinesById = new Map(
    render.pipelines.map((pipeline) => [pipeline.id, pipeline]),
  );
  for (const pass of render.passes.filter(({ color_attachment }) => color_attachment)) {
    const target = targetsById.get(pass.color_attachment);
    const pipeline = pipelinesById.get(pass.pipeline);
    assert.equal(target.format, pipeline.color_format);
    assert.equal(target.sample_count, pipeline.sample_count);
    if (pass.resolve_target) {
      assert.equal(targetsById.get(pass.resolve_target).sample_count, 1);
    }
  }
  assert.ok(!targetsById.has("transparent_reflection_fallback"));
  assert.doesNotMatch(JSON.stringify(render), /fallback/iu);
  for (const pipeline of render.pipelines.filter(({ depth_write }) => depth_write)) {
    assert.equal(pipeline.depth_format, "depth32float");
    assert.equal(pipeline.depth_compare, "less");
  }
  assert.deepEqual(render.features, {
    checker_texture: true,
    planar_mirror: true,
    shadow_map: true,
  });

  assert.match(wgsl, /struct SceneCamera\s*\{[^}]*view_projection:/su);
  assert.match(wgsl, /struct SceneLight\s*\{/u);
  assert.match(wgsl, /struct ObjectMaterial\s*\{/u);
  assert.match(wgsl, /roughness:\s*f32/u);
  assert.match(wgsl, /ior:\s*f32/u);
  assert.match(wgsl, /extinction:\s*f32/u);
  assert.match(wgsl, /polarization:\s*vec4<f32>/u);
  assert.match(wgsl, /polarization_basis:\s*vec4<f32>/u);
  assert.match(wgsl, /specular_strength:\s*f32/u);
  assert.match(wgsl, /no_backface_specular:\s*u32/u);
  assert.match(wgsl, /surface_kind:\s*u32/u);
  assert.match(wgsl, /reflection_camera_index:\s*u32/u);
  assert.match(wgsl, /object_index:\s*u32/u);
  assert.match(wgsl, /fn vkf_checker_color\(/u);
  assert.match(wgsl, /@location\(3\) local_position:\s*vec3<f32>/u);
  assert.match(wgsl, /@location\(6\) local_normal:\s*vec3<f32>/u);
  assert.match(
    wgsl,
    /vkf_checker_color\(\s*input\.local_position,\s*input\.local_normal\)/u,
  );
  assert.match(wgsl, /abs\(local_normal\)/u);
  assert.match(wgsl, /planar_position\s*=\s*local_position\.xz/u);
  assert.match(wgsl, /planar_position\s*=\s*local_position\.yz/u);
  assert.doesNotMatch(wgsl, /vkf_checker_color\(input\.world_position\)/u);
  assert.match(wgsl, /fn vkf_shadow_visibility\(/u);
  assert.match(wgsl, /shadow_near_far:\s*array<vec4<f32>,\s*6>/u);
  assert.match(wgsl, /textureSampleCompareLevel\(/u);
  assert.match(wgsl, /textureLoad\(\s*shadow_depth,/u);
  assert.doesNotMatch(wgsl, /\btextureSampleCompare\(/u);
  assert.doesNotMatch(
    wgsl,
    /depth - 0\.0008/u,
    "shadow receiver bias must follow slope and texel size",
  );
  assert.doesNotMatch(
    wgsl,
    /\binverse\(/u,
    "soft-shadow depth reconstruction must not compile a matrix inverse per fragment",
  );
  const blockerSampleCount = Number(wgsl.match(
    /const VKF_SHADOW_BLOCKER_SAMPLE_COUNT: u32 = (\d+)u;/u,
  )?.[1]);
  const filterSampleCount = Number(wgsl.match(
    /const VKF_SHADOW_FILTER_SAMPLE_COUNT: u32 = (\d+)u;/u,
  )?.[1]);
  assert.equal(blockerSampleCount, 16);
  assert.equal(
    filterSampleCount,
    32,
    "stable penumbrae use a fixed 32-tap disk with hardware 2x2 PCF",
  );
  assert.match(wgsl, /let source_radius = max\(light\.target_and_radius\.w, 0\.0\)/u);
  assert.match(wgsl, /let receiver_view_distance = vkf_shadow_linear_distance\(/u);
  assert.match(
    wgsl,
    /let receiver_distance = length\(\s*world_position - light\.position_and_range\.xyz\)/u,
  );
  assert.match(
    wgsl,
    /near_plane \* far_plane\s*\/\s*max\(far_plane - depth \* \(far_plane - near_plane\), 1\.0e-6\)/u,
  );
  assert.match(
    wgsl,
    /let blocker_ray_scale = receiver_distance \/\s*max\(receiver_view_distance, 1\.0e-4\)/u,
  );
  assert.match(wgsl, /blocker_distance_sum = blocker_distance_sum \+/u);
  assert.match(
    wgsl,
    /let penumbra_ratio = max\(\s*receiver_distance - average_blocker_distance, 0\.0\)\s*\/\s*max\(average_blocker_distance, 1\.0e-4\)/u,
  );
  assert.match(
    wgsl,
    /let compare_depth = depth - vkf_shadow_receiver_bias\(/u,
  );
  assert.doesNotMatch(
    wgsl,
    /vkf_shadow_rotation|fract\(sin\(seed\)/u,
    "a static scene must not inject per-pixel shadow noise",
  );
  assert.match(
    wgsl,
    /VKF_SHADOW_DISK\[sample_index \* 2u\]/u,
    "blocker search must cover the full disk instead of only its inner taps",
  );
  assert.match(wgsl, /VKF_SHADOW_DISK\[sample_index\]/u);
  assert.match(
    wgsl,
    /vkf_shadow_visibility\(\s*input\.world_position,\s*n,\s*light\s*\)/u,
    "direct and projected lights must share the same soft-shadow path",
  );
  assert.match(
    wgsl,
    /let light = lights\[light_index\];\s*var visibility = vkf_projected_light_aperture\(\s*input\.world_position, light, object\.object_index\);\s*if \(visibility <= 0\.0\) \{\s*continue;\s*\}\s*let to_light/u,
    "a fully clipped projected light must skip shading and shadow sampling",
  );
  assert.match(
    wgsl,
    /visibility = visibility \* vkf_shadow_visibility\(/u,
    "soft aperture coverage must modulate the shared shadow visibility",
  );
  assert.match(
    wgsl,
    /fn vkf_shadow_receiver_light_mask\([^)]*\)[\s\S]*?return 63u;/u,
    "every receiver retains all six light identities while non-shadowing " +
      "lights consume no shadow view",
  );
  assert.match(
    wgsl,
    /diffuse_rgb = diffuse_rgb \+ radiance \* diffuse/u,
    "direct and reflected-light radiance must accumulate instead of replace",
  );
  assert.match(
    wgsl,
    /let reflected_radius = source\.target_and_radius\.w \+\s*reflected_roughness \* length\(/u,
    "a reflected virtual light must broaden with mirror roughness",
  );
  assert.match(
    wgsl,
    /derived_scene\.shadow_near_far\[u32\(shadow_slot\)\] =\s*vec4<f32>\(near_plane, far_plane, 0\.0, 0\.0\)/u,
  );
  assert.match(
    wgsl,
    /derived_scene\.shadow_near_far\[u32\(projected_shadow_slot\)\] =\s*vec4<f32>\(\s*projected_near_plane, projected_far_plane, 0\.0, 0\.0\)/u,
  );
  assert.match(wgsl, /light_ndc\.x < -1\.0 \|\| light_ndc\.x > 1\.0/u);
  assert.match(wgsl, /return 1\.0;\s*\}\s*let uv =/u);
  assert.match(wgsl, /aperture_vertex_count:\s*u32/u);
  assert.match(wgsl, /fn vkf_light_aperture_position\(/u);
  assert.match(wgsl, /var aperture_center = vec3<f32>\(0\.0\)/u);
  assert.match(wgsl, /target_and_radius = vec4<f32>\(\s*aperture_center,/u);
  assert.match(wgsl, /fn vkf_planar_aperture_coverage\(/u);
  assert.match(wgsl, /let softness = max\(aperture_light\.target_and_radius\.w, 0\.0\)/u);
  assert.match(wgsl, /if \(receiver_gap < -1\.0e-5\)/u);
  assert.match(
    wgsl,
    /smoothstep\(\s*-edge_softness, edge_softness, signed_distance\)/u,
  );
  assert.match(wgsl, /fn vkf_planar_reflection\(/u);
  assert.match(wgsl, /textureSampleLevel\([^;]+,\s*0\.0\)/u);
  assert.match(
    wgsl,
    /let reflection_coverage = object\.reflectivity \* reflected\.a/u,
    "an invalid reflection sample must preserve the already shaded surface",
  );
  assert.match(
    wgsl,
    /shaded = mix\(shaded, reflected\.rgb, reflection_coverage\)/u,
    "only valid reflected-camera coverage may blend reflected radiance",
  );
  assert.doesNotMatch(
    wgsl,
    /mix\(shaded, reflected\.rgb, object\.reflectivity\)/u,
    "reflection blending must use only valid reflected-camera coverage",
  );
  assert.doesNotMatch(
    wgsl,
    /\btextureSample\(/u,
    "reflection sampling may be reached through non-uniform front-face control flow",
  );
  assert.match(wgsl, /fn vkf_shadow_vertex\(/u);
  assert.match(wgsl, /fn vkf_scene_vertex\(/u);
  assert.match(wgsl, /fn vkf_scene_fragment\(/u);
  assert.match(wgsl, /@compute\s+@workgroup_size\(64\)\s+fn vkf_prepare_frame\(/u);
  assert.match(wgsl, /fn vkf_prepare_reflection_camera\(/u);
  assert.match(wgsl, /fn vkf_reflection_parent_slot\(/u);
  assert.match(wgsl, /mirror_view_position:\s*array<vec4<f32>,\s*2>/u);
  assert.match(wgsl, /mirror_view_target:\s*array<vec4<f32>,\s*2>/u);
  assert.match(
    wgsl,
    /derived_scene\.mirror_view_position\[parent_camera_index\]\.xyz/u,
  );
  assert.match(wgsl, /fn vkf_next_reflection_camera_slot\(/u);
  assert.match(wgsl, /fn vkf_look_at\(/u);
  assert.match(wgsl, /fn vkf_perspective\(/u);
  assert.match(wgsl, /fn vkf_reflect_point\(/u);
  assert.match(wgsl, /fn vkf_off_axis_projection\(/u);
  assert.match(wgsl, /fn vkf_projected_light_aperture\(/u);
  assert.match(
    wgsl,
    /if \(receiver_object_index == light\.aperture_object_index\) \{\s*return 0\.0;\s*\}/u,
    "a projected light must not illuminate its own aperture object",
  );
  assert.match(
    wgsl,
    /vkf_projected_light_aperture\(\s*input\.world_position, light, object\.object_index\);/u,
    "projected-light aperture rejection must receive the shaded object index",
  );
  assert.doesNotMatch(
    wgsl,
    /vkf_direct_mirror_shadow/u,
    "the real light shadow map must be the only direct-light occlusion path",
  );
  assert.doesNotMatch(
    wgsl,
    /candidate_index < VKF_LIGHT_COUNT/u,
    "direct mirror shadows must not scan every light for every fragment",
  );
  assert.match(wgsl, /fn vkf_light_attenuation\(/u);
  assert.match(
    wgsl,
    /intensity\s*\/\s*max\(distance \* distance,\s*1\.0e-6\)/u,
  );
  assert.match(wgsl, /let fade = 1\.0 - range_ratio \* range_ratio/u);
  assert.doesNotMatch(
    wgsl,
    /1\.0 - length\(to_light\) \/ light\.position_and_range\.w/u,
  );
  assert.match(wgsl, /hit_distance <= 1\.0e-5 \|\| hit_distance > 1\.0 \+ 1\.0e-5/u);
  assert.match(wgsl, /@builtin\(front_facing\) front_facing:\s*bool/u);
  assert.doesNotMatch(
    wgsl,
    /if \(object\.surface_kind == 2u && !front_facing\) \{\s*discard;\s*\}/u,
    "a mirror backface must remain visible",
  );
  assert.match(wgsl, /fn vkf_terminal_scene_fragment\(/u);
  assert.match(
    wgsl,
    /fn vkf_terminal_scene_fragment\([\s\S]*vkf_shade_authored_material\(input, front_facing\)/u,
    "a reflected view must terminate by shading ordinary authored material",
  );
  assert.match(
    wgsl,
    /if \(object\.surface_kind == 2u && !front_facing\) \{\s*let ambient_backface = material_color\.rgb \* scene\.ambient\.rgb;\s*return vec4<f32>\(ambient_backface, material_color\.a\);\s*\}/u,
    "a planar reflective backface must be ambient-only with no direct, projected, specular, or reflection term",
  );
  assert.match(wgsl, /object\.surface_kind != 2u \|\| front_facing/u);
  assert.match(wgsl, /object\.no_backface_specular != 0u/u);
  assert.match(wgsl, /specular_rgb = specular_rgb \+ radiance \* specular/u);
  assert.match(wgsl, /fn vkf_fresnel_amplitudes\(/u);
  assert.match(wgsl, /fn vkf_rotate_stokes_basis\(/u);
  assert.match(wgsl, /let cos_double = cosine \* cosine - sine \* sine/u);
  assert.match(wgsl, /fn vkf_reflect_stokes\(/u);
  assert.match(wgsl, /rs_amplitude \* rp_amplitude \* polarization\.z/u);
  assert.match(wgsl, /rs_amplitude \* rp_amplitude \* polarization\.w/u);
  assert.match(wgsl, /source\.polarization_basis/u);
  assert.match(wgsl, /derived_lights\[light_index\]\.polarization_basis/u);
  assert.match(wgsl, /specular \*= reflected_stokes\.x \/ max\(local_stokes\.x/u);
  assert.match(wgsl, /let base = item_index \* 32u/u);
  assert.match(
    wgsl,
    /if \(object_index == 0u\) \{ return 0u; \}[\s\S]*if \(object_index == 1u\) \{ return 1u; \}/u,
  );
  assert.match(
    wgsl,
    /vkf_next_reflection_camera_slot\(\s*pass_state\.camera_state_index,\s*object\.object_index\s*\)/u,
  );
  assert.match(wgsl, /input\.view_position - input\.world_position/u);
  assert.match(wgsl, /pass_state\.aperture_vertex_count/u);
  assert.match(wgsl, /raw_camera:\s*array<f32>/u);
  assert.match(wgsl, /raw_lights:\s*array<f32>/u);
  assert.match(wgsl, /raw_objects:\s*array<f32>/u);
  assert.match(wgsl, /aperture_vertices:\s*array<f32>/u);
  assert.match(wgsl, /derived_scene:\s*SceneCamera/u);
  assert.match(wgsl, /derived_lights:\s*array<SceneLight>/u);
  assert.match(wgsl, /derived_objects:\s*array<DerivedObjectSlot>/u);
  assert.match(wgsl, /derived_scene\.light_view_projection/u);
  assert.match(wgsl, /reflect_object_index/u);
  assert.match(wgsl, /const VKF_LIGHT_COUNT: u32 = 6u;/u);
  assert.match(wgsl, /for \(var light_index: u32 = 0u;/u);
  assert.doesNotMatch(wgsl, /lights\[0\]/u);
  assert.doesNotMatch(
    wgsl,
    /\btarget\s*(?::|=)/u,
    "compiler-emitted WGSL must not use the reserved target identifier",
  );
});
