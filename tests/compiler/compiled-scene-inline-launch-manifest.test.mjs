import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const stager = process.env.VKF_NATIVE_SCENE_STAGER;
const work = path.join(root, ".w", `compiled-inline-launch-${process.pid}`);

after(() => rm(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));

test("compiled retained scenes mount their build-time launch manifest without fetching it", async () => {
  assert.ok(stager, "VKF_NATIVE_SCENE_STAGER is required");
  const artifact = path.join(work, "artifact");
  const overlay = path.join(artifact, "vf-ui");
  await mkdir(work, { recursive: true });
  await cp(path.join(root, "examples", "material_ui_gallery"), artifact, { recursive: true });
  await cp(path.join(root, "web", "vf-ui"), overlay, { recursive: true });

  const wasm = path.join(work, "program.wasm");
  const wasmManifest = path.join(work, "program.wasm-manifest.json");
  const wgsl = path.join(work, "render.wgsl");
  const webGpuManifest = path.join(work, "render.webgpu-manifest.json");
  await Promise.all([
    writeFile(wasm, Buffer.from([0x00, 0x61, 0x73, 0x6d])),
    writeFile(wasmManifest, JSON.stringify({
      status: "compiled",
      runtime_surface: { retained_scene_arena: { byte_length: 1 } },
    })),
    writeFile(wgsl, "@vertex fn vs_main() -> @builtin(position) vec4f { return vec4f(); }\n"),
    writeFile(webGpuManifest, JSON.stringify({ status: "compiled" })),
  ]);

  const result = spawnSync(stager, [
    "--source", path.join(artifact, "app.vkf"),
    "--overlay-web", overlay,
    "--wasm-artifact", wasm,
    "--wasm-manifest", wasmManifest,
    "--webgpu-artifact", wgsl,
    "--webgpu-manifest", webGpuManifest,
  ], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  const session = path.dirname(path.join(overlay, ...summary.page_rel.split("/")));
  const [page, externalManifest] = await Promise.all([
    readFile(path.join(session, "vkf-scene.html"), "utf8"),
    readFile(path.join(session, "vf-launch-manifest.json"), "utf8").then(JSON.parse),
  ]);

  const inlineMatch = page.match(
    /window\.__vfCompiledLaunchManifest=(\{[\s\S]*?\})\s*;window\.__vfCompiledSceneConfig=/u,
  );
  assert.ok(inlineMatch, "compiled scene must contain its launch manifest");
  assert.deepEqual(JSON.parse(inlineMatch[1]), externalManifest,
    "inline and fallback launch manifests must remain identical");
  assert.match(page, /shell\.ensureLaunchFrameDependencies\(\)/u);
  assert.match(page, /shell\.mountLaunchFrames\(global\.__vfCompiledLaunchManifest\)/u);
  assert.doesNotMatch(page, /var frames=shell\.mountLaunchFramesFromUrl\(shell\.config\.launchManifestUrl\)/u);
  assert.match(page, /shell\.mountLaunchFramesFromUrl\(shell\.config\.launchManifestUrl\)/u,
    "the external manifest remains an exact fallback when inline data is unavailable");
});
