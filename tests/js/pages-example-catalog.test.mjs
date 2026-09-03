import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReadmeExampleCatalog,
  discoverReadmeReferencedVkfPaths,
} from "../../tools/build-pages-example-catalog.mjs";

const repoRoot = new URL("../../", import.meta.url);

test("Pages catalogue contains every repository README example exactly once", async () => {
  const [catalog, referenced] = await Promise.all([
    buildReadmeExampleCatalog(repoRoot),
    discoverReadmeReferencedVkfPaths(repoRoot),
  ]);
  const paths = catalog.examples.map(({ path }) => path);

  assert.ok(catalog.examples.length >= 100);
  assert.equal(new Set(paths).size, paths.length);
  for (const path of referenced) {
    assert.ok(paths.includes(path), `catalogue is missing README example ${path}`);
  }
  for (const required of [
    "examples/generated/readme/core/01-bindings.vkf",
    "examples/generated/readme/stdlib/12-symbolic.vkf",
    "examples/scene_gallery/01-line-plot/app.vkf",
    "examples/scene_gallery/20-rigid-body-snapshot/app.vkf",
    "examples/material_ui_gallery/app.vkf",
    "examples/symbolic/03_calculus_and_sums.vkf",
    "examples/programs/vkf_chess_3d/main.vkf",
  ]) assert.ok(paths.includes(required), `catalogue is missing ${required}`);
});

test("Pages catalogue assigns stable hierarchical groups and source hashes", async () => {
  const catalog = await buildReadmeExampleCatalog(repoRoot);
  const byPath = new Map(catalog.examples.map((entry) => [entry.path, entry]));

  assert.deepEqual(
    byPath.get("examples/generated/readme/core/01-bindings.vkf").groups,
    ["Language", "Core"],
  );
  assert.deepEqual(
    byPath.get("examples/scene_gallery/02-lit-surface/app.vkf").groups,
    ["Visual", "3D", "Static"],
  );
  assert.deepEqual(
    byPath.get("examples/scene_gallery/20-rigid-body-snapshot/app.vkf").groups,
    ["Visual", "2D", "Animation"],
  );
  assert.match(
    byPath.get("examples/material_ui_gallery/app.vkf").sourceSha256,
    /^[a-f0-9]{64}$/u,
  );
  assert.equal(
    byPath.get("examples/material_ui_gallery/app.vkf").title,
    "Material UI Gallery",
  );
  assert.equal(
    byPath.get("examples/scene_gallery/03-mirror/app.vkf").media.path,
    "media/docs/public/images/scene-gallery/03-mirror.png",
  );
  assert.equal(
    byPath.get("examples/generated/readme/core/01-bindings.vkf").media,
    null,
  );
  assert.equal(
    byPath.get("examples/native_core/hello_native.vkf").browserRunnable,
    true,
  );
  assert.equal(
    byPath.get("examples/generated/readme/core/01-bindings.vkf").browserRunnable,
    false,
  );
  assert.deepEqual(
    byPath.get("examples/material_ui_gallery/app.vkf").media,
    {
      path: "media/docs/public/videos/stanford-bunny-rotating-lights-360.mp4",
      type: "video",
      sha256: "13d91284aa7bb986c500a9a5e53a3b89796cf625a6c4a63e51272de707e87402",
    },
  );
});
