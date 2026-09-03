import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const stager = process.env.VKF_NATIVE_SCENE_STAGER;
const work = path.join(root, ".w", `ply-load-${process.pid}`);

after(() => rm(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));

test("native scene load embeds an indexed ASCII PLY with smooth normals", async () => {
  assert.ok(stager, "VKF_NATIVE_SCENE_STAGER is required");
  const source = path.join(work, "scene.vkf");
  const asset = path.join(work, "tetra.ply");
  const overlay = path.join(work, "vf-ui");
  await mkdir(work, { recursive: true });
  await cp(path.join(root, "web", "vf-ui"), overlay, { recursive: true });
  await writeFile(asset, [
    "ply", "format ascii 1.0", "element vertex 4",
    "property float x", "property float y", "property float z",
    "element face 4", "property list uchar int vertex_indices", "end_header",
    "0 0 0", "1 0 0", "0 1 0", "0 0 1",
    "3 0 2 1", "3 0 1 3", "3 1 2 3", "3 2 0 3", "",
  ].join("\n"));
  await writeFile(source, [
    'tetra: load("tetra.ply")',
    "native_scene:(frame_id:\"ply_load\", meshes:[(",
    '  id:"tetra", kind:"field_mesh", vertices:tetra.vertices,',
    '  indices:tetra.faces, topology:"triangle-list", color:[0.2,0.4,0.6,0.8]',
    ")])", "",
  ].join("\n"));

  const result = spawnSync(stager, ["--source", source, "--overlay-web", overlay], {
    cwd: root, encoding: "utf8", windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  const page = await readFile(path.join(overlay, ...summary.page_rel.split("/")), "utf8");
  const config = JSON.parse(page.match(/window\.__vfNativeSceneConfig=(\{.*?\});window\.__vfNativeSceneArenaUrl=/su)[1]);
  const mesh = config.scene_ir.meshes.find(({ id }) => id === "tetra").properties;
  assert.equal(mesh.vertices.length, 40, "four position/normal/RGBA vertices are embedded");
  assert.equal(mesh.indices.length, 12, "four triangle faces are embedded");
  assert.equal(mesh.vertices.type, "float32");
  assert.equal(mesh.indices.type, "uint32");
  assert.equal(mesh.topology, "triangle-list");
  assert.equal(
    mesh.__vf_compiled_mesh_arena,
    true,
    "load(Ply) must stage render-ready packed geometry instead of repeating mesh math in JavaScript",
  );
  assert.equal(mesh.__vf_compiled_material_color, true);
  const arenaName = page.match(/window\.__vfNativeSceneArenaUrl="([^"]+)"/u)[1];
  const arenaBytes = await readFile(path.join(path.dirname(path.join(overlay, ...summary.page_rel.split("/"))), arenaName));
  const arenaBuffer = arenaBytes.buffer.slice(arenaBytes.byteOffset, arenaBytes.byteOffset + arenaBytes.byteLength);
  const packedVertices = new Float32Array(arenaBuffer, mesh.vertices.byteOffset, mesh.vertices.length);
  for (let vertex = 0; vertex < 4; vertex += 1) {
    const channels = packedVertices.slice(vertex * 10 + 6, vertex * 10 + 10);
    for (const [channel, expected] of [0.2, 0.4, 0.6, 0.8].entries()) {
      assert.ok(
        Math.abs(channels[channel] - expected) < 1e-6,
        "the compiler must bake the static material color into the packed vertex arena",
      );
    }
  }
});
