# 040-G10 UI audit closure

## Handoff

- packet: `040-G10`
- branch: `codex/0.4/040-g10-ui-closure`
- integration base: `f708dcc`
- public syntax/API/schema/ABI: unchanged
- browser execution: hidden Edge `--headless=new` only

## Shipped source examples

The release tree now contains three source-level UI examples:

| Example | Ordinary `add` operations | Static load |
| --- | ---: | ---: |
| `examples/material_ui_gallery` | 5 | 1 |
| `examples/ui_plot_card` | 2 | 1 |
| `examples/ui_status_board` | 3 | 1 |

Each example keeps authored HTML and CSS in separate files. No authored HTML
contains a script element or inline event handler. The material gallery remains
the event-driven example: four buttons and one range input enter the normal
compiled VKF queues. The two smaller examples make the ordinary geometry plus
static-document composition inspectable without the gallery's material setup.

The npm archive input includes all three complete example trees. The Windows
portable release stages them under `samples/ui/`. Linux and macOS portable
archives do not advertise them because those 0.4 packages intentionally reject
the excluded UI module.

## Paired hidden capture

`scripts/build-material-ui-gallery-media.mjs` regenerated the transparent
overlay evidence from the shipped material gallery and one hidden Edge
session. Each of the five VKF interaction states produced:

1. a renderer-only PNG through
   `VfDisplay.__test.captureGeomFrameDataUrl`; and
2. a full viewport PNG through DevTools `Page.captureScreenshot`.

The committed final-state pair is:

| Capture | Size | SHA-256 |
| --- | --- | --- |
| full compositor | 1376x861 | `3545f6fba28e14e7b238f3418add048884535335ce61610fd0f77b2d15763d17` |
| renderer only | 1002x708 | `6815f4ec274800f0f944a02b4af57d7a7b7e2f57709a8ff39d2827804864bdbc` |

The full capture visibly contains static HTML/CSS controls, both frame headers,
and the WebGPU canvas. The manifest records these observations for every state,
pins all executable sources and four media files, and keeps the two capture
hashes distinct. Both sequences also ship as directly playing five-frame GIFs.

No visible window, application JavaScript, browser automation dependency, or
C++ UI semantic behavior was added.

## RED / GREEN receipts

| Behavior | RED | GREEN |
| --- | --- | --- |
| several shipped source UI examples plus archive inputs | `6d0aefd` | `f684b58`, `4a72d4f` |
| paired renderer/full-compositor overlay evidence | `a09d74b` | `31110e7` |

The first RED failed because `ui_plot_card` and `ui_status_board` did not exist
and no UI source tree entered package inputs. The second RED failed because the
old manifest had no `composite_api` and only renderer media.

## Verification

Focused source, capture, and freshness contracts:

```text
node --test \
  tests/js/material-ui-gallery-media-freshness.test.mjs \
  tests/js/shipped-ui-example-runner-contract.test.mjs \
  tests/js/shipped-ui-examples-contract.test.mjs \
  tests/js/transparent-overlay-media-freshness.test.mjs

5 passed, 0 failed
```

All three VKF files were independently sent through the release lexer, parser,
and typed-IR lowering binaries. The observed `add`/`load` counts match the table
above. `npm pack --dry-run --json` listed all nine VKF/HTML/CSS example files in
the `0.4.0` archive.

## Owned paths

- `examples/material_ui_gallery/**` (consumed, unchanged)
- `examples/ui_plot_card/**`
- `examples/ui_status_board/**`
- `package.json`
- `scripts/package-native-release.ps1`
- `scripts/build-material-ui-gallery-media.mjs`
- `tests/js/shipped-ui-examples-contract.test.mjs`
- `tests/js/transparent-overlay-media-freshness.test.mjs`
- `docs/public/images/readme-ui/material-ui-gallery.manifest.json`
- `docs/public/images/readme-ui/ui-transparent-overlay-offscreen*`
- `README.md`
- `docs/evidence/040-transparent-overlay-acceptance.md`
- `docs/evidence/040-g10-ui-audit-closure.md`
