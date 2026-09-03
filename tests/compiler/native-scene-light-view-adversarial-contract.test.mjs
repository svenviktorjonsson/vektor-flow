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
  `light-view-adversarial-contract-${process.pid}`,
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

let compiledScenePromise;

async function compiledScene() {
  if (compiledScenePromise) return compiledScenePromise;
  compiledScenePromise = (async () => {
    await mkdir(workRoot, { recursive: true });
    const source = path.join(workRoot, "light-view-contract.vkf");
    const sourceText = [
      "scene: native_scene(",
      '    kind:"scene_3d", frame_id:"light_view_contract",',
      "    surfaces:[",
      '        (id:"key_floor", center:[-3.0, 0.0, 0.0],',
      "            size:[4.0, 4.0], casts_shadow:false,",
      "            receives_shadow:true),",
      '        (id:"fill_floor", center:[3.0, 0.0, 0.0],',
      "            size:[4.0, 4.0], casts_shadow:false,",
      "            receives_shadow:true)",
      "    ],",
      "    meshes:[(",
      '        id:"moving_caster", kind:"field_mesh",',
      "        vertices:[",
      "            -1.0, -1.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0,",
      "             1.0, -1.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0,",
      "             0.0,  1.0, 2.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0",
      "        ], indices:[0, 1, 2],",
      "        center:[0.0, 1.0, 0.0], scale:[1.0, 1.0, 1.0],",
      "        rotation:[0.0, 0.0, 0.0], casts_shadow:true",
      "    )],",
      "    lights:[",
      '        (id:"key", kind:"point", pos:[-4.0, -4.0, 6.0],',
      "            range:30.0, casts_shadow:true),",
      '        (id:"fill", kind:"point", pos:[4.0, -4.0, 6.0],',
      "            range:30.0, casts_shadow:true)",
      "    ],",
      "    shadow_receivers:[",
      '        (receiver_mesh:"key_floor", occluders:["moving_caster"],',
      '            lights:["key"]),',
      '        (receiver_mesh:"fill_floor", occluders:["moving_caster"],',
      '            lights:["fill"])',
      "    ]",
      ")",
      "",
    ].join("\n");
    await writeFile(source, sourceText, "utf8");
    const tokens = stage("vkf_lexer_cursor_smoke", undefined, [sourceText]);
    const ast = stage("vkf_parser_token_stream_smoke", tokens);
    const typedIr = stage("vkf_ast_to_ir_smoke", ast);
    const typedIrPath = path.join(workRoot, "light-view-contract.typed-ir.json");
    await writeFile(typedIrPath, typedIr, "utf8");
    const summary = JSON.parse(stage(
      "vkf_webgpu_artifact_smoke",
      undefined,
      ["--source", source, "--typed-ir", typedIrPath],
    ));
    return {
      wgsl: await readFile(summary.artifact_path, "utf8"),
      manifest: await readFile(summary.manifest_path, "utf8").then(JSON.parse),
    };
  })();
  return compiledScenePromise;
}

test("receiver-light assignment mask gates compiled shadow visibility", async () => {
  const { wgsl } = await compiledScene();
  const maskFunction = wgsl.match(
    /fn vkf_shadow_receiver_light_mask\([\s\S]*?\n\}/u,
  );

  assert.ok(
    maskFunction,
    "compiled WGSL must expose the per-object receiver/light assignment mask",
  );
  assert.match(
    maskFunction[0],
    /receiver_object_index == 0u[\s\S]*?return 1u/u,
    "key_floor must receive shadows only from light index 0",
  );
  assert.match(
    maskFunction[0],
    /receiver_object_index == 1u[\s\S]*?return 2u/u,
    "fill_floor must receive shadows only from light index 1",
  );
  assert.match(
    wgsl,
    /vkf_shadow_receiver_light_mask\(object\.object_index\)[\s\S]{0,300}?(?:1u\s*<<\s*light_index|>>\s*light_index)[\s\S]{0,300}?vkf_shadow_visibility\(/u,
    "the assignment mask must gate the shadow lookup, not merely be serialized",
  );
});

test("LightView refits current transformed bounds when object revisions change", async () => {
  const { wgsl } = await compiledScene();

  assert.ok(
    /(?:transform_revision|bounds_revision)/u.test(wgsl),
    "the object arena must expose a revision that invalidates cached LightView bounds",
  );
  const refitFunction = wgsl.match(
    /fn vkf_refit_direct_shadow_bounds\([\s\S]*?\n\}/u,
  );
  assert.ok(
    refitFunction,
    "compiled WGSL must refit LightView bounds from current object transforms",
  );
  assert.match(
    refitFunction[0],
    /derived_objects\[object_index\]\.value\.model/u,
    "the refit must transform local bounds with the current model matrix",
  );
  assert.match(
    wgsl,
    /(?:transform_revision|bounds_revision)[\s\S]{0,300}?vkf_refit_direct_shadow_bounds\(/u,
    "a transform/bounds revision change must trigger the LightView refit",
  );
});
