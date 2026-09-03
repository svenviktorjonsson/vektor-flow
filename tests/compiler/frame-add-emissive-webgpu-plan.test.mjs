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
  `frame-add-emissive-webgpu-plan-${process.pid}`,
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

function run(name, args = [], input) {
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

test("an emissive Frame surface becomes one private WebGPU light source", async () => {
  await mkdir(workRoot, { recursive: true });
  const sourceText = [
    ": .ui.display",
    "display: Display(dim:2)",
    "frame: display.add_frame(pos:[0.08, 0.08], size:[0.84, 0.84])",
    "frame.add_camera(pos:[4, -6, 4], target:[0, 0, 1])",
    "emitter: frame.add(x:[[-1, 1], [-1, 1]], y:[[0, 0], [2, 2]], z:[[2, 2], [2, 2]], id:\"emitter\", color:[0.2, 0.2, 0.2, 1], emission:(wavelength:[460, 550, 610], radiance:[0.2, 0.4, 0.8]))",
    "receiver: frame.add(x:[[-2, 2], [-2, 2]], y:[[-1, -1], [3, 3]], z:[[0, 0], [0, 0]], id:\"receiver\", color:[0.8, 0.8, 0.8, 1])",
    "view: frame.push()",
  ].join("\n");
  assert.doesNotMatch(sourceText, /native_scene|add_light/u);

  const source = path.join(workRoot, "emitter.vkf");
  const typedIrPath = path.join(workRoot, "emitter.typed-ir.json");
  await writeFile(source, `${sourceText}\n`, "utf8");
  const tokens = run("vkf_lexer_cursor_smoke", [sourceText]);
  const ast = run("vkf_parser_token_stream_smoke", [], tokens);
  await writeFile(typedIrPath, run("vkf_ast_to_ir_smoke", [], ast), "utf8");

  const summary = JSON.parse(run("vkf_webgpu_artifact_smoke", [
    "--source", source,
    "--typed-ir", typedIrPath,
  ]));
  const [wgsl, manifest] = await Promise.all([
    readFile(summary.artifact_path, "utf8"),
    readFile(summary.manifest_path, "utf8").then(JSON.parse),
  ]);

  const renderPlan = manifest.runtime_surface.render_plan;
  assert.equal(renderPlan.light_count, 1);
  assert.equal(renderPlan.emitter_sources.length, 1);
  const [emitterSource] = renderPlan.emitter_sources;
  assert.deepEqual({
    ...emitterSource,
    source_radius: undefined,
  }, {
    id: "emitter",
    layer_id: 0,
    object_index: 0,
    kind_code: 5,
    area: 4,
    source_radius: undefined,
    area_sample_count: 8,
    casts_shadow: true,
    shadow_view_count: 1,
  });
  assert.ok(
    Math.abs(emitterSource.source_radius - Math.sqrt(4 / Math.PI)) < 1e-12,
  );
  assert.equal(
    renderPlan.derived_buffers.find(({ id }) => id === "derived_lights")
      .byte_size,
    112,
  );
  assert.equal(
    renderPlan.derived_buffers.find(({ id }) => id === "derived_objects")
      .byte_size,
    512,
  );
  assert.equal(renderPlan.features.shadow_map, true);
  assert.deepEqual(
    renderPlan.passes
      .filter(({ kind }) => kind === "shadow_depth")
      .map(({ light_id, shadow_view }) => ({ light_id, shadow_view })),
    [{
      light_id: "emitter",
      shadow_view: { coverage: "fitted_scene", projection: "perspective" },
    }],
  );
  assert.match(wgsl, /const VKF_LIGHT_COUNT: u32 = 1u;/u);
  assert.match(wgsl, /const VKF_AREA_LIGHT_SAMPLE_COUNT: u32 = 8u;/u);
  assert.match(wgsl, /fn vkf_sample_area_light_transport\(/u);
  const diskBlock = wgsl.match(
    /const VKF_AREA_LIGHT_DISK:[\s\S]*?= array<vec2<f32>, 8>\(([\s\S]*?)\);/u,
  );
  assert.ok(diskBlock);
  const diskSamples = [...diskBlock[1].matchAll(
    /vec2<f32>\((-?[0-9.]+), (-?[0-9.]+)\)/gu,
  )].map((match) => [Number(match[1]), Number(match[2])]);
  assert.equal(diskSamples.length, 8);
  assert.ok(diskSamples.every(([x, y]) => x * x + y * y <= 1 + 1e-6));
  const diskCentroid = diskSamples.reduce(
    ([sumX, sumY], [x, y]) => [sumX + x, sumY + y],
    [0, 0],
  );
  assert.ok(Math.abs(diskCentroid[0]) < 1e-6);
  assert.ok(Math.abs(diskCentroid[1]) < 1e-6);
  const secondMoment = diskSamples.reduce(
    (sum, [x, y]) => sum + x * x + y * y,
    0,
  ) / diskSamples.length;
  assert.ok(Math.abs(secondMoment - 0.5) < 1e-5);
  assert.match(
    wgsl,
    /\(basis_x \* sample_offset\.x \+ basis_y \* sample_offset\.y\) \*\s*light\.target_and_radius\.w/u,
  );
  assert.match(
    wgsl,
    /receiver_distance - average_blocker_distance/u,
  );
  assert.equal(
    renderPlan.passes.filter(({ kind }) => kind === "light_emitters").length,
    0,
    "authored triangle emitters render only through their own geometry",
  );

});

test("a temporal point emitter renders as readable spherical geometry", async () => {
  await mkdir(workRoot, { recursive: true });
  const sourceText = [
    ": .ui.display",
    "display: Display(dim:2)",
    "frame: display.add_frame(pos:[0.08, 0.08], size:[0.84, 0.84])",
    "t: [0, 1]",
    "p: [[-0.1, 0.2, 0.0], [0.1, 0.2, 0.0]]",
    "emitter: frame.add(p_t:p, c_tc:[[1, 0, 0, 1], [1, 0, 0, 1]], s_t:[0.02, 0.02], t:t, t_mode:\"repeat\", s_mode:data, id:\"moving_emitter\", emission:[8, 0.2, 0.1])",
    "view: frame.push()",
  ].join("\n");
  const source = path.join(workRoot, "temporal-emitter.vkf");
  const typedIrPath = path.join(workRoot, "temporal-emitter.typed-ir.json");
  await writeFile(source, `${sourceText}\n`, "utf8");
  const tokens = run("vkf_lexer_cursor_smoke", [sourceText]);
  const ast = run("vkf_parser_token_stream_smoke", [], tokens);
  await writeFile(typedIrPath, run("vkf_ast_to_ir_smoke", [], ast), "utf8");
  const summary = JSON.parse(run("vkf_webgpu_artifact_smoke", [
    "--source", source,
    "--typed-ir", typedIrPath,
  ]));
  const [wgsl, manifest] = await Promise.all([
    readFile(summary.artifact_path, "utf8"),
    readFile(summary.manifest_path, "utf8").then(JSON.parse),
  ]);
  const renderPlan = manifest.runtime_surface.render_plan;

  assert.deepEqual(renderPlan.emitter_sources.map(({ id }) => id), [
    "moving_emitter",
  ]);
  assert.deepEqual(
    renderPlan.passes
      .filter(({ kind }) => kind === "light_emitters")
      .map(({ vertex_count, instance_count }) => ({
        vertex_count,
        instance_count,
      })),
    [{ vertex_count: 9216, instance_count: 1 }],
  );
  assert.equal(
    renderPlan.pipelines.find(({ id }) => id === "light_emitters")?.blend,
    "additive",
    "the finite source must blend into the scene instead of drawing an opaque rim",
  );
  assert.match(wgsl, /fn vkf_emitter_sphere_direction\(/u);
  assert.match(
    wgsl,
    /u32\(raw_lights\[base \+ 13u\]\) == 5u[\s\S]*3\.141592653589793 \* authored_radius \* authored_radius/u,
    "geometry-emitter markers must display authored surface radiance rather than area-integrated power",
  );
  assert.match(
    wgsl,
    /let halo_radius_px = bloom_strength \* min\([\s\S]*4\.0,[\s\S]*source_radius_px \*[\s\S]*compactness/u,
    "flare extension must follow angular size and remain at most four pixels",
  );
  assert.doesNotMatch(
    wgsl,
    /let halo_radius_px = bloom_strength \* \([0-9]/u,
    "flare extent must not use a fixed oversized pixel halo",
  );
  assert.match(
    wgsl,
    /fn vkf_flare_fragment\([\s\S]*let radial_gradient = 1\.0 - smoothstep\(0\.0, 1\.0, radius\);[\s\S]*let halo = radial_gradient \* radial_gradient/u,
    "the flare must fall continuously from its center through its outer halo",
  );
  assert.doesNotMatch(
    wgsl,
    /cross_ray/u,
    "the flare must remain purely radial without one-pixel cross artifacts",
  );
  assert.match(
    wgsl,
    /struct EmitterVertexOut \{[\s\S]*@location\(2\) view_facing: f32,[\s\S]*out\.view_facing = max\(dot\(direction, view_direction\), 0\.0\);[\s\S]*let emitter_gradient = smoothstep\(0\.0, 1\.0, input\.view_facing\);[\s\S]*return vec4<f32>\(\s*mapped_radiance \* emitter_gradient, emitter_gradient\)/u,
    "the visible finite source must fade continuously to zero at its silhouette",
  );
});
