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
  `shadow-view-robustness-${process.pid}`,
);

after(() => rm(workRoot, { recursive: true, force: true }));

function tool(name) {
  assert.ok(
    nativeBin,
    "VKF_NATIVE_COMPILER_BIN must name the focused native build directory",
  );
  return path.join(nativeBin, process.platform === "win32" ? `${name}.exe` : name);
}

function stage(name, input, args = []) {
  const result = spawnSync(tool(name), args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    input,
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || `${name} failed`);
  return result.stdout;
}

async function compileFixture(name, sourceText) {
  await mkdir(workRoot, { recursive: true });
  const source = path.join(workRoot, `${name}.vkf`);
  const typedIrPath = path.join(workRoot, `${name}.typed-ir.json`);
  await writeFile(source, sourceText, "utf8");
  const tokens = stage("vkf_lexer_cursor_smoke", undefined, [sourceText]);
  const ast = stage("vkf_parser_token_stream_smoke", tokens);
  const typedIr = stage("vkf_ast_to_ir_smoke", ast);
  await writeFile(typedIrPath, typedIr, "utf8");
  const summary = JSON.parse(stage("vkf_webgpu_artifact_smoke", undefined, [
    "--source",
    source,
    "--typed-ir",
    typedIrPath,
  ]));
  return {
    wgsl: await readFile(summary.artifact_path, "utf8"),
    manifest: await readFile(summary.manifest_path, "utf8").then(JSON.parse),
  };
}

const insideBoundsScene = [
  "scene: native_scene(",
  '    kind:"scene_3d", frame_id:"inside_bounds",',
  "    surfaces:[(",
  '        id:"floor", center:[0.0, 0.0, 0.0], size:[8.0, 8.0],',
  "        casts_shadow:false, receives_shadow:true",
  "    )],",
  "    meshes:[(",
  '        id:"blocker", kind:"field_mesh",',
  "        vertices:[",
  "            -2.0, -2.0, 0.0, 0.0, -1.0, 0.0, 1.0, 1.0, 1.0, 1.0,",
  "             2.0, -2.0, 0.0, 0.0, -1.0, 0.0, 1.0, 1.0, 1.0, 1.0,",
  "             2.0,  2.0, 2.0, 0.0, -1.0, 0.0, 1.0, 1.0, 1.0, 1.0,",
  "            -2.0,  2.0, 2.0, 0.0, -1.0, 0.0, 1.0, 1.0, 1.0, 1.0",
  "        ], indices:[0, 1, 2, 0, 2, 3], casts_shadow:true",
  "    )],",
  "    lights:[(",
  '        id:"inside", kind:"point", pos:[0.0, 0.0, 1.0],',
  "        target:[0.0, 1.0, 1.0], range:20.0, casts_shadow:true",
  "    )],",
  "    shadow_receivers:[(",
  '        receiver_mesh:"floor", occluders:["blocker"], lights:["inside"]',
  "    )]",
  ")",
  "",
].join("\n");

const verticalReflectedEmitterScene = [
  ": .ui.display",
  "display: Display(dim:2)",
  "frame: display.add_frame(pos:[0.08, 0.08], size:[0.84, 0.84])",
  "frame.add_camera(pos:[0, -5, 3], target:[0, 0, 0], up:[0, 0, 1])",
  "horizontal_mirror: frame.add(x:[[-2, 2], [-2, 2]], y:[[-2, -2], [2, 2]], z:[[0, 0], [0, 0]], id:\"horizontal_mirror\", color:[0.34, 0.34, 0.34, 1], reflectivity:1.0, casts_shadow:true, receives_shadow:true)",
  "source: frame.add(x:[[-0.1, 0.1], [-0.1, 0.1]], y:[[-0.1, -0.1], [0.1, 0.1]], z:[[3, 3], [3, 3]], id:\"source\", color:[1, 1, 1, 1], emission:[1, 1, 1])",
  "view: frame.push()",
  "",
].join("\n");

function outsideBoundsScene(name, position) {
  return [
    "scene: native_scene(",
    `    kind:"scene_3d", frame_id:"${name}",`,
    "    surfaces:[(",
    '        id:"floor", center:[0.0, 3.25, 0.0], size:[7.4, 14.0],',
    "        casts_shadow:false, receives_shadow:true",
    "    )],",
    "    meshes:[(",
    '        id:"blocker", kind:"field_mesh",',
    "        vertices:[",
    "            -1.0, 0.0, 0.0, 0.0, -1.0, 0.0, 1.0, 1.0, 1.0, 1.0,",
    "             1.0, 0.0, 0.0, 0.0, -1.0, 0.0, 1.0, 1.0, 1.0, 1.0,",
    "             1.0, 0.0, 3.55, 0.0, -1.0, 0.0, 1.0, 1.0, 1.0, 1.0,",
    "            -1.0, 0.0, 3.55, 0.0, -1.0, 0.0, 1.0, 1.0, 1.0, 1.0",
    "        ], indices:[0, 1, 2, 0, 2, 3],",
    "        center:[0.0, 3.25, 0.0], casts_shadow:true",
    "    )],",
    "    lights:[(",
    `        id:"source", kind:"point", pos:[${position.join(", ")}],`,
    "        target:[0.0, 0.3, 1.5], range:100.0, casts_shadow:true",
    "    )],",
    "    shadow_receivers:[(",
    '        receiver_mesh:"floor", occluders:["blocker"], lights:["source"]',
    "    )]",
    ")",
    "",
  ].join("\n");
}

function hasFullSphereCoverage(manifest, lightId) {
  const shadowPasses = manifest.runtime_surface.render_plan.passes.filter(
    ({ kind, light_id }) => kind === "shadow_depth" && light_id === lightId,
  );
  const cubeFaces = new Set(shadowPasses
    .map(({ shadow_view }) => shadow_view?.cube_face)
    .filter((face) => Number.isInteger(face)));
  return shadowPasses.length >= 6 &&
      [0, 1, 2, 3, 4, 5].every((face) => cubeFaces.has(face)) ||
    shadowPasses.some(({ shadow_view }) =>
      shadow_view?.coverage === "full_sphere" &&
      ["dual_paraboloid", "octahedral"].includes(shadow_view?.projection));
}

test("point light inside scene bounds declares full-sphere shadow coverage", async () => {
  const { manifest } = await compileFixture("inside-bounds", insideBoundsScene);
  const shadowPasses = manifest.runtime_surface.render_plan.passes.filter(
    ({ kind, light_id }) => kind === "shadow_depth" && light_id === "inside",
  );
  const cubeFaces = new Set(shadowPasses
    .map(({ shadow_view }) => shadow_view?.cube_face)
    .filter((face) => Number.isInteger(face)));
  const sixFaceCoverage = shadowPasses.length >= 6 &&
    [0, 1, 2, 3, 4, 5].every((face) => cubeFaces.has(face));
  const equivalentCoverage = shadowPasses.some(({ shadow_view }) =>
    shadow_view?.coverage === "full_sphere" &&
    ["dual_paraboloid", "octahedral"].includes(shadow_view?.projection)
  );

  assert.ok(
    sixFaceCoverage || equivalentCoverage,
    "a point light inside receiver/caster bounds cannot use one perspective view",
  );
});

test("near-outside point light crossing the fitted view plane uses full-sphere coverage", async () => {
  const { manifest } = await compileFixture(
    "near-outside-bounds",
    outsideBoundsScene("near_outside_bounds", [-4.0, 0.3, 4.8]),
  );
  assert.ok(
    hasFullSphereCoverage(manifest, "source"),
    "a point light must not clamp behind-eye bounds into an exploded one-view frustum",
  );
});

test("far point light with every fitted corner in front retains one view", async () => {
  const { manifest } = await compileFixture(
    "far-outside-bounds",
    outsideBoundsScene("far_outside_bounds", [-40.0, -40.0, 40.0]),
  );
  const shadowPasses = manifest.runtime_surface.render_plan.passes.filter(
    ({ kind, light_id }) => kind === "shadow_depth" && light_id === "source",
  );
  assert.equal(shadowPasses.length, 1);
  assert.equal(shadowPasses[0].shadow_view?.coverage, "fitted_scene");
});

test("vertical reflected emitter selects a nonzero adaptive up basis", async () => {
  const { wgsl } = await compileFixture(
    "vertical-projected-basis",
    verticalReflectedEmitterScene,
  );
  const helper = wgsl.match(
    /fn vkf_adaptive_shadow_up\([\s\S]*?\n\}/,
  )?.[0] ?? "";
  const projectedView = wgsl.match(
    /let projected_view = vkf_look_at\([\s\S]*?\n\s*\);/,
  )?.[0] ?? "";

  assert.match(helper, /abs\([^)]*\.z\)\s*>\s*0\.[89]/);
  assert.match(helper, /vec3<f32>\(0\.0, 1\.0, 0\.0\)/);
  assert.match(projectedView, /vkf_adaptive_shadow_up\(/);
  assert.doesNotMatch(
    projectedView,
    /vec3<f32>\(0\.0, 0\.0, 1\.0\)/,
    "vertical light direction crossed with fixed +z yields a zero basis",
  );
});

test("reflected-emitter near plane is aperture-owned, not viewer-camera-owned", async () => {
  const { wgsl } = await compileFixture(
    "projected-near-plane",
    verticalReflectedEmitterScene,
  );
  const projectedNear = wgsl.match(
    /let projected_near_plane =[\s\S]*?;\n\s*let projected_far_plane/,
  )?.[0] ?? "";

  assert.match(projectedNear, /vkf_aperture_near_plane\(/);
  assert.doesNotMatch(
    projectedNear,
    /raw_camera\[/,
    "changing the viewer near plane must not move a projected-light aperture",
  );
});
