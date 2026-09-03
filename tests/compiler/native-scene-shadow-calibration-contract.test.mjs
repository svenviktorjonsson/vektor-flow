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
  `shadow-calibration-contract-${process.pid}`,
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

let compiledGallery;

function compileShadowedGallery() {
  compiledGallery ??= (async () => {
    await mkdir(workRoot, { recursive: true });
    const source = path.join(
      repositoryRoot,
      "examples",
      "material_ui_gallery",
      "app.vkf",
    );
    const sourceText = await readFile(source, "utf8");
    const tokens = stage("vkf_lexer_cursor_smoke", undefined, [sourceText]);
    const ast = stage("vkf_parser_token_stream_smoke", tokens);
    const typedIr = stage("vkf_ast_to_ir_smoke", ast);
    const typedIrPath = path.join(workRoot, "gallery.typed-ir.json");
    await writeFile(typedIrPath, typedIr, "utf8");
    const summary = JSON.parse(stage(
      "vkf_webgpu_artifact_smoke",
      undefined,
      ["--source", source, "--typed-ir", typedIrPath],
    ));
    const [wgsl, manifest] = await Promise.all([
      readFile(summary.artifact_path, "utf8"),
      readFile(summary.manifest_path, "utf8").then(JSON.parse),
    ]);
    return { wgsl, manifest };
  })();
  return compiledGallery;
}

test("PCSS projects a finite source basis through the actual light view", async () => {
  const { wgsl } = await compileShadowedGallery();

  assert.match(
    wgsl,
    /fn vkf_shadow_projected_source_radius_uv\(/u,
    "shadow radius must be measured by projecting finite source endpoints",
  );
  assert.match(
    wgsl,
    /light_view_projection\s*\*\s*vec4<f32>\(source_center_world, 1\.0\)/u,
    "the source center must pass through the selected LightView projection",
  );
  assert.match(
    wgsl,
    /light_view_projection\s*\*\s*vec4<f32>\(source_basis_[xy]_world, 1\.0\)/u,
    "at least one finite source-basis endpoint must pass through that same LightView",
  );
  assert.match(
    wgsl,
    /let source_radius_uv\s*=\s*vkf_shadow_projected_source_radius_uv\([\s\S]*?let search_radius_uv\s*=\s*clamp\(\s*source_radius_uv,/u,
    "blocker search must consume the projected finite-source footprint",
  );
  assert.match(
    wgsl,
    /let filter_radius_uv\s*=\s*clamp\(\s*source_radius_uv\s*\*\s*penumbra_ratio,/u,
    "PCF filtering must scale that same projected footprint by blocker geometry",
  );
  assert.doesNotMatch(
    wgsl,
    /0\.5\s*\*\s*(?:source_radius|penumbra_world)\s*\/\s*max\(receiver_distance/u,
    "world-radius/distance is not a projection through the actual light camera",
  );
});

test("a zero-radius source takes one hard-shadow comparison before PCSS loops", async () => {
  const { wgsl } = await compileShadowedGallery();
  const sourceRadiusIndex = wgsl.indexOf("let source_radius =");
  const blockerLoopIndex = wgsl.indexOf(
    "VKF_SHADOW_BLOCKER_SAMPLE_COUNT",
    sourceRadiusIndex,
  );
  const filterLoopIndex = wgsl.indexOf(
    "VKF_SHADOW_FILTER_SAMPLE_COUNT",
    sourceRadiusIndex,
  );
  assert.notEqual(sourceRadiusIndex, -1, "shader must read the finite source radius");
  assert.notEqual(blockerLoopIndex, -1, "area lights must retain blocker search");
  assert.notEqual(filterLoopIndex, -1, "area lights must retain PCF filtering");

  const hardLightPrefix = wgsl.slice(
    sourceRadiusIndex,
    Math.min(blockerLoopIndex, filterLoopIndex),
  );
  assert.match(
    hardLightPrefix,
    /if\s*\(source_radius\s*<=\s*(?:0\.0|1\.0e-\d+)\)\s*\{[\s\S]*?return\s+textureSampleCompareLevel\(/u,
    "a point source must return one hardware comparison instead of paying 16+32 taps",
  );
});

test("shadow compare depth has one explicit world/light-view calibrated bias", async () => {
  const { wgsl, manifest } = await compileShadowedGallery();
  const shadowPipeline = manifest.runtime_surface?.render_plan?.pipelines
    ?.find(({ id }) => id === "shadow_depth");
  assert.ok(shadowPipeline, "compiled plan must retain its shadow-depth pipeline");
  assert.deepEqual(
    {
      depth_bias: shadowPipeline.depth_bias,
      depth_bias_slope_scale: shadowPipeline.depth_bias_slope_scale,
    },
    { depth_bias: 0, depth_bias_slope_scale: 0 },
    "raster bias must be disabled when compare depth owns calibrated receiver bias",
  );
  assert.match(
    wgsl,
    /fn vkf_shadow_receiver_bias\([\s\S]*?world_position:\s*vec3<f32>[\s\S]*?light_view_projection:\s*mat4x4<f32>[\s\S]*?texel_size:\s*vec2<f32>/u,
    "the sole receiver bias must be explicit in world/light-view units",
  );
  assert.match(
    wgsl,
    /let compare_depth\s*=\s*depth\s*-\s*vkf_shadow_receiver_bias\(/u,
  );
  assert.doesNotMatch(
    wgsl,
    /let receiver_bias\s*=\s*max\(0\.75, 3\.0 \* slope\) \* texel_depth;/u,
    "a fixed NDC receiver offset must not survive beside the calibrated path",
  );
});
