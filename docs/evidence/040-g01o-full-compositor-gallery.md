# 040-G01O Full-Compositor Gallery Evidence

## Handoff

- packet: `040-G01O`
- branch: `codex/0.4/040-g01o-full-compositor-gallery`
- integration base: `354f849`
- verified implementation head: `8f4033d`
- public contract: unchanged
- browser execution: hidden Edge `--headless=new` only

## Observable result

The committed material gallery media is produced from five real retained UI
states: the four `ButtonClicked` views and `SliderValueChanged=0.72`. Each state
has both a renderer-only capture and a full `Page.captureScreenshot` viewport.
The full viewport includes the static HTML/CSS controls, two Frame headers, and
the WebGPU canvas. All five full-compositor hashes are distinct:

| State | Full-compositor SHA-256 |
| --- | --- |
| lighting | `0bd4c907ba7735a581c2b1249361ee8ac087a6db44b236b4566903f2029ad099` |
| mirror | `4fd3d60d5ea3e772b2b8a69fa9bc54a58cd05709658aa4a5e1e6c7cf48dd690b` |
| glass | `b4d7106824c57faf7d8f44a9a436a99f3dd4243e371da0e9371078a280833ace` |
| all | `8d254eff1dbff640bcaee4c4e5c4dad8d64672af188e3d95d235cc0584a31626` |
| glass alpha 0.72 | `3545f6fba28e14e7b238f3418add048884535335ce61610fd0f77b2d15763d17` |

`material-ui-gallery.gif` is the 1376x861 five-frame full-compositor README
animation. `material-ui-gallery-renderer.gif` remains the independent 1002x708
renderer oracle. The capture builder regenerated both without changing their
media hashes; the manifest changed only for the audited compiler source hashes.
No application JavaScript, runtime screenshot library, Playwright, Puppeteer,
or Selenium dependency was added.

## RED / GREEN receipts

| Behavior | RED | GREEN |
| --- | --- | --- |
| every UI state has full-compositor and renderer evidence | `0f7696e` | `a278732` |
| reflected planar surfaces survive native source lowering | `0c2e14f` | `be46db7` |
| default timing remains separate from renderer fields | `ee656a6` | `b3c8792` |
| frame-less World `add` selects World lowering | `2aa5cf5` | `d0f74c9` |
| hidden dependency-free shipped-example runner | contract GREEN `57b43d3` | `57b43d3` |
| media freshness after compiler fixes | stale source hash | `8f4033d` |

The surface RED reproduced the missing `back_mirror` that made the projected
light invalid. The timing RED reproduced invalid embedded JavaScript for a
scene with no explicit timing block. The World RED reproduced retained scene
lowering incorrectly claiming a frame-less World-layer `add` operation.

## Shipped example audit

All executions below used the focused stager at
`build/040-g01o-compiler/bin/vkf_native_scene_artifact_stager.exe` and hidden
Edge. The general runner serves the staged overlay from a test-owned loopback
server so binary mesh arenas load without relaxing browser file-origin rules.

| Example | Compile/run result |
| --- | --- |
| `100_axis_4_panel.vkf` | source lowering; Frame chrome and canvas present; composite `35d35127…` |
| `110_mirror_showcase.vkf` | four rendered parts, mirror surface pass, four planned lights; composite `19a327e5…` |
| `111_mirror_smoke.vkf` | two rendered parts including `back_mirror`, surface pass and projected light; composite `76116a4e…` |
| `112_scene3d_smoke.vkf` | three rendered parts and one planned light; composite `b8329ea3…` |
| `114_grass_texture_cube.vkf` | 140,000 retained blade impostors; composite `e5adc42d…` |
| `115_world_embedding_native.vkf` | native/WASM packet parity and real hidden Edge execution pass |
| `material_ui_gallery/app.vkf` | native/WASM parity plus five full-compositor and renderer captures pass |
| `physics_rigid_polygons_2d.vkf` | binary arena hydration and WebGPU renderer pass; composite `2bc2f18e…` |

Every successful browser run reported zero init failures, zero runtime failures,
and no WebGPU error. The animated-example hashes above are run evidence, not
freshness pins; only the deterministic gallery hashes are committed as media
freshness requirements.

## Verification

Focused compiler/runtime/browser/media suite:

```text
10 tests passed, 0 failed
```

This includes material gallery native/WASM acceptance, surface/default-timing
source lowering, typed World native/WASM/real-Edge parity, capture and media
freshness contracts, and the shipped UI runner contract.

Repository JavaScript suite:

```text
413 tests: 412 passed, 0 failed, 1 skipped
```

The skipped test is the pre-existing opt-in Windows portable archive execution
test.

## Owned paths

- `compiler/native/vkf_native_scene_artifact_stager.cpp`
- `compiler/native/vkf_retained_scene_packet.hpp`
- `tests/compiler/native-scene-surfaces-lowering.test.mjs`
- `tests/compiler/world-native-stager.test.mjs`
- `tests/helpers/capture_material_ui_gallery.js`
- `tests/helpers/run_staged_ui_example.js`
- `tests/js/material-ui-gallery-capture-contract.test.mjs`
- `tests/js/material-ui-gallery-media-freshness.test.mjs`
- `tests/js/shipped-ui-example-runner-contract.test.mjs`
- `scripts/build-material-ui-gallery-media.mjs`
- `README.md`
- `docs/public/images/readme-ui/material-ui-gallery.png`
- `docs/public/images/readme-ui/material-ui-gallery.gif`
- `docs/public/images/readme-ui/material-ui-gallery-renderer.gif`
- `docs/public/images/readme-ui/material-ui-gallery.manifest.json`
- `docs/evidence/040-g01o-full-compositor-gallery.md`

## Remaining blocker

`examples/programs/vkf_chess_3d/main.vkf` is not stageable from the shipped
tree. It declares `native_scene_config_path: "native_scene_config.json"`, but
that file is absent. The direct source-lowering path cannot evaluate the
imported `native.overlay_scene()` function, so the exact stager diagnostic is:

```text
native_scene_config_path not found: .../examples/programs/vkf_chess_3d/native_scene_config.json
```

No placeholder scene or illustrative HTML was substituted. Closing this gap
requires either shipping a fingerprinted compiler-produced cache or extending
the native compilation path to evaluate the foldered application before
staging.
