# 0.6.0 MAT060Q — procedural road scene capture evidence

## Scope

- Base: `e36331a1` (`MAT060P`).
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Adds one private deterministic road-scene capture adapter and focused test.
- No public VKF syntax, constructor, API, schema, ABI, package export, shader,
  gallery, fixture, media, or 0.4/0.5 path changes.

## Plan fit

MAT060P submitted bounded retained road packets through the shared frame
lifecycle but stopped before visual evidence. MAT060Q consumes an actually
completed road frame's submitted GPU RGBA bytes, writes them to an offscreen
canvas, captures the canvas through the existing media-capture boundary, and
records the resulting image bytes and SHA-256 identity.

This is a private road tracer. A production GPU draw pipeline, projected camera
demand, later-effect composition, and public author controls remain separate
work.

## Observable behavior

A completed frame containing one retained road cell and a two-pixel GPU image
captures as `image/png`, preserves all eight bytes, and reports SHA-256
`3376c46676754b0efcc0e8f57d28ebd514459eef38f772f099fe9d2b8541ab63`.
Repeating the capture produces the same identity and retains the exact source
frame.

An RGBA byte count that does not match `width * height * 4`, or a capture over
16,777,216 pixels, is rejected before a canvas is allocated.

## RED / GREEN

- Baseline `e36331a1`: MAT060A-P, conditioned-distribution, and spatial-field
  suites passed 49/49 (exit 0, 1.663 s) on Node.js 24.11.0 / Windows x64.
- RED 1: the focused capture failed only because
  `vf-procedural-road-scene-capture.mjs` did not exist (exit 1, 0.270 s).
- GREEN 1: completed-frame capture and deterministic image identity passed 1/1
  (exit 0, 0.639 s).
- RED 2: malformed dimensions reached canvas allocation rather than rejecting
  the request (1/2 pass, exit 1, 0.234 s).
- GREEN 2: deterministic capture and pre-allocation bounds passed 2/2 (exit 0,
  0.252 s).

## Executable evidence

```text
node --test tests/js/vf-procedural-road-scene-capture.test.mjs tests/js/vf-procedural-road-scene.test.mjs tests/js/vf-procedural-material-scene-frame.test.mjs tests/js/vf-road-wear-renderer-packets.test.mjs tests/js/vf-road-construction-renderer-packets.test.mjs tests/js/vf-road-refinement-working-set.test.mjs tests/js/vf-road-shoulder-field.test.mjs tests/js/vf-road-rut-field.test.mjs tests/js/vf-road-water-field.test.mjs tests/js/vf-road-edge-breakdown-field.test.mjs tests/js/vf-road-snow-field.test.mjs tests/js/vf-road-dirt-field.test.mjs tests/js/vf-road-repair-field.test.mjs tests/js/vf-road-marking-field.test.mjs tests/js/vf-road-crack-field.test.mjs tests/js/vf-road-construction-field.test.mjs tests/js/vf-road-wear-field.test.mjs tests/js/vf-road-coordinate-field.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs
```

- 51/51 pass, 0 fail, exit 0, 1.660 s.
- `git diff --check` is clean.
- Capture uses injected deterministic GPU bytes; the production GPU draw path
  remains the next visual evidence boundary.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-procedural-road-scene-capture.mjs` | `cbfb2c0a2e1081b79d95a88df4bde0c871c0aa56` | `0E195B68136179EF4AC1FFD585C8625B7E60549416CA9C7C05FFC3838F4FF2D9` |
| `tests/js/vf-procedural-road-scene-capture.test.mjs` | `fb2b17bd8c952dba494bcf520833171b88f91666` | `C2F16E20287CFD92408302E92946C6F6D846CA91B11E5DD69E01C9CD88ACD804` |

## Acceptance and recovery

MAT060Q closes deterministic offscreen evidence for a completed road scene and
adds bounded pre-allocation validation. It does not yet provide a production
GPU scene, compose later effects, select projected camera demand, prove
connected boundaries, compile CPU/WGSL/native parity, or provide
research-fitted presets and public controls.

Re-evaluated estimated 0.6.0 completion is **64.4%**, up **0.6 percentage
points** from MAT060P's 63.8%. Recovery is `git revert` of this packet commit;
only the private road capture, focused test, and this receipt are owned.
