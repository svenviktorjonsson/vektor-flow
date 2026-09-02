# 0.6.0 MAT060R — road renderer pipeline evidence

## Scope

- Base: `bc8882ba` (`MAT060Q`).
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Adds one private retained road GPU-resource pipeline and focused integration
  test through the existing scene scheduler and offscreen capture boundary.
- No public VKF syntax, constructor, API, schema, ABI, package export, shared
  0.4 renderer, gallery, fixture, media, or 0.4/0.5 path changes.

## Plan fit

MAT060Q captured deterministic GPU RGBA bytes from a completed road frame but
used an injected draw object. MAT060R makes the road scene own a retained GPU
resource lifecycle: each changed field mesh uploads vertex, index, and compact
wear-material buffers, while unchanged packets retain those same resources
across scheduled frames.

The submitted pixel remains injected by the reference submit boundary. A real
WebGPU command encoder, render pass, shader, and device-level image readback
remain separate work.

## Observable behavior

The first scheduled frame for one demanded road cell creates three buffers and
uploads 216 bytes: 160 vertex bytes, 24 index bytes, and 32 compact material
bytes. The second unchanged frame reuses the exact retained resource object,
creates no buffers, uploads no bytes, and produces the same deterministic
offscreen image SHA-256.

Scene teardown destroys all three buffers exactly once. A malformed delta that
tries to remove a retained packet before replacing it with a forged mesh is
rejected before any retained state or GPU resource changes.

## RED / GREEN

- Baseline `bc8882ba`: road-scene capture, MAT060A-Q,
  conditioned-distribution, and spatial-field suites passed 51/51 (exit 0,
  1.638 s) on Node.js 24.11.0 / Windows x64.
- RED 1: the focused integration failed only because
  `vf-road-renderer-pipeline.mjs` did not exist (exit 1, 0.199 s).
- GREEN 1: retained uploads, reuse, teardown, and deterministic capture passed
  1/1 (exit 0, 0.840 s).
- RED 2: a forged delta removed valid retained GPU resources before failing
  with an incidental property error (1/2 pass, exit 1, 0.414 s).
- GREEN 2: retained capture and atomic malformed-delta rejection passed 2/2
  (exit 0, 0.263 s).

## Executable evidence

```text
node --test tests/js/vf-road-renderer-pipeline.test.mjs tests/js/vf-procedural-road-scene-capture.test.mjs tests/js/vf-procedural-road-scene.test.mjs tests/js/vf-procedural-material-scene-frame.test.mjs tests/js/vf-road-wear-renderer-packets.test.mjs tests/js/vf-road-construction-renderer-packets.test.mjs tests/js/vf-road-refinement-working-set.test.mjs tests/js/vf-road-shoulder-field.test.mjs tests/js/vf-road-rut-field.test.mjs tests/js/vf-road-water-field.test.mjs tests/js/vf-road-edge-breakdown-field.test.mjs tests/js/vf-road-snow-field.test.mjs tests/js/vf-road-dirt-field.test.mjs tests/js/vf-road-repair-field.test.mjs tests/js/vf-road-marking-field.test.mjs tests/js/vf-road-crack-field.test.mjs tests/js/vf-road-construction-field.test.mjs tests/js/vf-road-wear-field.test.mjs tests/js/vf-road-coordinate-field.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs
```

- 53/53 pass, 0 fail, exit 0, 2.400 s.
- `git diff --check` is clean.
- Device calls are deterministic mocks; actual headless WebGPU render-pass
  evidence remains the next GPU gate.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-road-renderer-pipeline.mjs` | `4a14b1005b5fcdd58e017ddb16adbd3001fcf8fb` | `6C6172B2D8ED67BE0DBBC1823934099DCFC1ADDEDCB3DCFCDDE9A4A3C1EB8D47` |
| `tests/js/vf-road-renderer-pipeline.test.mjs` | `9e719dbfd4889f5b322489ff3f09ab865a6b2593` | `E0A5083677B8821BA58B968966D9482472CB1AEC673E9396D4A6E290FA2CF668` |

## Acceptance and recovery

MAT060R establishes retained road vertex/index/material GPU resources across
captured frames with bounded ownership and atomic rejection. It does not yet
encode a real WebGPU render pass, compose later effects, select projected
camera demand, prove connected boundaries, compile CPU/WGSL/native parity, or
provide research-fitted presets and public controls.

Re-evaluated estimated 0.6.0 completion is **65.0%**, up **0.6 percentage
points** from MAT060Q's 64.4%. Recovery is `git revert` of this packet commit;
only the private road renderer pipeline, focused test, and this receipt are
owned.
