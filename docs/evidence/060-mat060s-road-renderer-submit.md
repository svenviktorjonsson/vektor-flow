# 0.6.0 MAT060S — road renderer submission evidence

## Scope

- Base: `91d1dd54` (`MAT060R`).
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Adds one private road render-pass submitter and focused deterministic
  offscreen-capture test.
- No public VKF syntax, constructor, API, schema, ABI, package export, shared
  0.4 renderer, shader, gallery, fixture, media, or 0.4/0.5 path changes.

## Plan fit

MAT060R retained uploaded road vertex, index, and material resources but stopped
before command encoding. MAT060S binds each retained material buffer, attaches
the vertex and index buffers, emits one indexed draw per road packet, submits
the completed command buffer, reads back RGBA pixels, and feeds the completed
frame into MAT060Q's deterministic offscreen capture.

The reference device and readback are deterministic mocks. A bundled WGSL
pipeline and a real headless WebGPU device remain separate work.

## Observable behavior

One retained quad encodes exactly one `drawIndexed(6, 1, 0, 0, 0)`, submits the
finished command buffer once, and performs readback only after submission. The
two-pixel RGBA result survives completed-frame capture byte-for-byte and its
SHA-256 equals the hash of the readback bytes.

A malformed retained resource is rejected before creating a command encoder,
bind group, pass, or queue submission.

## RED / GREEN

- Baseline `91d1dd54`: MAT060A-R, conditioned-distribution, and spatial-field
  suites passed 53/53 (exit 0, 2.227 s) on Node.js 24.11.0 / Windows x64.
- RED 1: the focused submit/capture behavior failed only because
  `vf-road-renderer-submit.mjs` did not exist (exit 1, 0.307 s).
- GREEN 1: indexed pass, submission, readback, and deterministic capture passed
  1/1 (exit 0, 1.881 s).
- RED 2: a malformed resource created and partially encoded a command before an
  incidental property error (1/2 pass, exit 1, 0.519 s).
- GREEN 2: indexed capture and pre-encoding rejection passed 2/2 (exit 0, 0.655
  s).

## Executable evidence

```text
node --test tests/js/vf-road-renderer-submit.test.mjs tests/js/vf-road-renderer-pipeline.test.mjs tests/js/vf-procedural-road-scene-capture.test.mjs tests/js/vf-procedural-road-scene.test.mjs tests/js/vf-procedural-material-scene-frame.test.mjs tests/js/vf-road-wear-renderer-packets.test.mjs tests/js/vf-road-construction-renderer-packets.test.mjs tests/js/vf-road-refinement-working-set.test.mjs tests/js/vf-road-shoulder-field.test.mjs tests/js/vf-road-rut-field.test.mjs tests/js/vf-road-water-field.test.mjs tests/js/vf-road-edge-breakdown-field.test.mjs tests/js/vf-road-snow-field.test.mjs tests/js/vf-road-dirt-field.test.mjs tests/js/vf-road-repair-field.test.mjs tests/js/vf-road-marking-field.test.mjs tests/js/vf-road-crack-field.test.mjs tests/js/vf-road-construction-field.test.mjs tests/js/vf-road-wear-field.test.mjs tests/js/vf-road-coordinate-field.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs
```

- 55/55 pass, 0 fail, exit 0, 2.410 s.
- `git diff --check` is clean.
- The command sequence is verified through a mock device; real hidden WebGPU
  shader execution and platform-tolerant image evidence remain open.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-road-renderer-submit.mjs` | `cea351a1abba1c2869df9fc1f707d24e640394c4` | `FAA2D08FD82AD599A930DA99F7D570DD23D55F57A94AC7D9F27FED361B4A9B78` |
| `tests/js/vf-road-renderer-submit.test.mjs` | `fab12ad442e6e9d35e588aa8e2ff855cdc2b5fe9` | `8B0E6AFA32DAF6A8AE2CBC45275C5A1F1991126E415F8AC873E36185F060D0D5` |

## Acceptance and recovery

MAT060S closes private indexed render-pass encoding, queue submission,
readback ordering, and deterministic offscreen capture for retained road
resources. It does not yet run a bundled road WGSL pipeline on real WebGPU,
compose later effects, select projected camera demand, prove connected
boundaries, compile CPU/WGSL/native parity, or provide research-fitted presets
and public controls.

Re-evaluated estimated 0.6.0 completion is **65.6%**, up **0.6 percentage
points** from MAT060R's 65.0%. Recovery is `git revert` of this packet commit;
only the private road submitter, focused test, and this receipt are owned.
