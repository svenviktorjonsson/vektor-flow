# 040-G01N Material UI Gallery Evidence

## Handoff

- packet: `040-G01N`
- branch: `codex/0.4/040-g01n-material-ui-gallery`
- integration base: `2ab0201`
- required integration fix: `5561a16` (`100a75b` cherry-picked)
- verified implementation head: `853e79d6cc6e8bf1b0f4305a887c7d8c11306945`
- public contract: unchanged; this packet consumes the approved `Frame.add`,
  `Frame.load`, direct member assignment, `ButtonClicked`, and
  `SliderValueChanged` contracts

## Observable result

`examples/material_ui_gallery/app.vkf` compiles into one retained scene with:

- five real `Frame.add(...)` surfaces and three lights;
- checker texture, direct lighting, shadow participation, mirror-screen
  reflection, tinted alpha glass, and a combined view;
- separate static HTML and CSS controls with no application JavaScript;
- four `ButtonClicked` branches that select visibly distinct material views;
- one `SliderValueChanged` branch that changes glass alpha in the live retained
  scene.

Native staging and WASM export the same runtime packets and compiled retained
event program. The native event runtime and the hostless browser adapter apply
the same persistent layer patches. The browser adapter is internal and does
not run in WebView2, where the native queue remains authoritative.

## RED / GREEN receipts

| Behavior | RED | GREEN |
| --- | --- | --- |
| native/WASM retained scene parity | `ffc012c` | `7bc3b12` |
| static HTML/CSS bundled with scene | `6eb60cc` | `76ec5b2` |
| direct member assignments compile to retained layer patches | `2f49975` | `69dbef9` |
| retained event patches execute in browser and native runtimes | `4149f5`, `61a7835` | `e507125` |
| executable material gallery | `77f84f5` | `56f4095` |
| WASM package contains the event program artifact | `6103d20` | `912b810` |
| hostless retained event adapter | `4e1ad67` | `3b9d62b` |
| hidden composite/frame capture tooling | `511d80b` | `d31b787`, `9c537da` |
| media freshness | `364c849` | `56e0b3d`, `853e79d` |

The explicit RED failures were missing scene/event artifacts, missing runtime
execution, missing hostless adapter/capture files, and missing freshness
manifest. The complete GREEN suite below was rerun at the handoff head.

## Hidden capture evidence

The capture builder launches Edge only with `--headless=new`. In a single
off-screen session it waits for both the renderer and static HTML controls,
clicks each real button, dispatches a real slider input event, and records:

- `Page.captureScreenshot` with `omitBackground:false` for the complete
  HTML/CSS + frame chrome + WebGPU viewport;
- `VfDisplay.__test.captureGeomFrameDataUrl("frame_0")` for the renderer-only
  oracle after every interaction.

The four button captures have four distinct SHA-256 hashes. The fifth frame
records `glass-alpha=0.72`. The committed PNG and five-frame looping GIF are
shown in `README.md`; their hashes, dimensions, source hashes, interactions,
and capture APIs are pinned by
`docs/public/images/readme-ui/material-ui-gallery.manifest.json`.

Regeneration command (build/test-only Pillow; no shipped dependency):

```powershell
$env:VKF_NATIVE_COMPILER_BIN = (Resolve-Path 'build/040-g01n-compiler/bin').Path
$env:VKF_NATIVE_SCENE_STAGER = (Resolve-Path 'build/040-g01n-compiler/bin/vkf_native_scene_artifact_stager.exe').Path
node scripts/build-material-ui-gallery-media.mjs
```

## Verification

Affected compiler/runtime/browser suite:

```text
27 tests passed, 0 failed
retained-scene-event-program-runtime-test passed
```

This includes native/WASM scene parity, HTML asset graph validation, slider and
button queue specificity, native queue parity, compiled event-patch parity,
gallery acceptance, media freshness, hostless adapter execution, and runtime
packet contract coverage.

Repository JavaScript suite:

```text
408 tests: 407 passed, 0 failed, 1 skipped
```

The skipped test is the pre-existing opt-in Windows portable archive execution
test. The first full run exposed one stale older-media hash because the new
helper temporarily modified a shared capture file; `9c537da` isolated the new
CDP implementation, restored the older helper byte-for-byte, and the complete
suite then passed.

## Owned paths

- `compiler/native/vkf_ast_to_ir_smoke.cpp`
- `compiler/native/vkf_native_scene_artifact_stager.cpp`
- `compiler/native/vkf_retained_scene_packet.hpp`
- `compiler/native/vkf_wasm_artifact_smoke.cpp`
- `native/VfOverlay/CMakeLists.txt`
- `native/VfOverlay/overlay_packet_runtime.cpp`
- `native/VfOverlay/overlay_packet_runtime.hpp`
- `native/VfOverlay/retained_scene_event_program_runtime_test.cpp`
- `web/vf-ui/vf-retained-event-adapter.js`
- `web/vf-ui/vf-runtime-packet-contract.js`
- `examples/material_ui_gallery/**`
- `tests/compiler/frame-add-scene-parity.test.mjs`
- `tests/compiler/material-ui-gallery-acceptance.test.mjs`
- `tests/compiler/retained-scene-event-patch-parity.test.mjs`
- `tests/compiler/slider-event-parity.test.mjs`
- `tests/helpers/capture_material_ui_gallery.js`
- `tests/js/material-ui-gallery-capture-contract.test.mjs`
- `tests/js/material-ui-gallery-media-freshness.test.mjs`
- `tests/js/retained-event-adapter.test.mjs`
- `scripts/build-material-ui-gallery-media.mjs`
- `tools/build_material_ui_gallery_gif.py`
- `README.md`
- `docs/public/images/readme-ui/material-ui-gallery.*`
- `docs/evidence/040-g01n-material-ui-gallery.md`

`compiler/native/vkf_lexer_cursor_smoke.cpp` is present in the branch only via
the required integration CRLF fix `5561a16` and is not owned by this packet.

## Remaining limits

- The gallery deliberately uses existing planar `Frame.add` surfaces and the
  existing mirror-screen system. It does not claim the future procedural 0.6
  material graph or arbitrary curved-mirror interpolation.
- The capture helper is build/test tooling. Shipped application execution has
  no screenshot, Pillow, or application-JavaScript dependency.
