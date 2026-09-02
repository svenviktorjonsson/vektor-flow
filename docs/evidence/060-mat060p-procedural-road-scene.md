# 0.6.0 MAT060P — procedural road scene evidence

## Scope

- Base: `1eb4fd9e` (`MAT060O`).
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Adds one private retained procedural-road scene/frame coordinator and focused
  test.
- No public VKF syntax, constructor, API, schema, ABI, package export, shader,
  gallery, fixture, media, or 0.4/0.5 path changes.

## Plan fit

MAT060M-O established bounded road demand and retained renderer packets but did
not invoke them through a frame lifecycle. MAT060P composes the existing road
refinement, construction lowering, construction/wear composition, and generic
procedural-material frame scheduler into one retained private scene.

The scene accepts explicit internal cell demand. Camera/projected-error
selection, later-effect composition, GPU draw-pipeline implementation, and
public author controls remain separate work.

## Observable behavior

A first frame with two demanded cells submits two lit construction/wear meshes
and exactly 464 upload bytes through the shared frame scheduler. Reversed
demand retains both renderer packet objects and submits zero upload bytes. An
empty-demand frame removes both renderer IDs, submits no replacement bytes,
and releases the retained road working set from 464 to zero vector bytes.

Three submitted frames receive deterministic frame indices and timestamps.
Scene teardown destroys the draw pipeline through the shared scheduler. A
malformed request is rejected before refinement, construction, or wear state
changes, preventing unscheduled demand from corrupting the retained frame.

## RED / GREEN

- Baseline `1eb4fd9e`: MAT060A-O, conditioned-distribution, and spatial-field
  suites passed 46/46 (exit 0, 1.436 s) on Node.js 24.11.0 / Windows x64.
- RED 1: the focused behavior failed only because
  `vf-procedural-road-scene.mjs` did not exist (exit 1, 0.268 s).
- GREEN 1: first upload, steady retention, release, and teardown passed 1/1
  (exit 0, 0.413 s).
- RED 2: a rejected frame mutated retained road demand before scheduler
  validation (1/2 pass, exit 1, 0.427 s).
- GREEN 2: valid lifecycle and rejection atomicity passed 2/2 (exit 0, 0.380
  s).

## Executable evidence

```text
node --test tests/js/vf-procedural-road-scene.test.mjs tests/js/vf-procedural-material-scene-frame.test.mjs tests/js/vf-road-wear-renderer-packets.test.mjs tests/js/vf-road-construction-renderer-packets.test.mjs tests/js/vf-road-refinement-working-set.test.mjs tests/js/vf-road-shoulder-field.test.mjs tests/js/vf-road-rut-field.test.mjs tests/js/vf-road-water-field.test.mjs tests/js/vf-road-edge-breakdown-field.test.mjs tests/js/vf-road-snow-field.test.mjs tests/js/vf-road-dirt-field.test.mjs tests/js/vf-road-repair-field.test.mjs tests/js/vf-road-marking-field.test.mjs tests/js/vf-road-crack-field.test.mjs tests/js/vf-road-construction-field.test.mjs tests/js/vf-road-wear-field.test.mjs tests/js/vf-road-coordinate-field.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs
```

- 49/49 pass, 0 fail, exit 0, 1.663 s.
- `git diff --check` is clean.
- This slice reaches a deterministic scene/frame request but uses an injected
  reference draw pipeline; offscreen image capture remains the next visual
  evidence gate.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-procedural-road-scene.mjs` | `48ad7c867dcd353feb6b2e7f2bad45ffb53a65c0` | `51FF49DA67BB76FD11DED9B1FCED61696AB4E19A6F030B6EF20D671C8CDD50D9` |
| `tests/js/vf-procedural-road-scene.test.mjs` | `3fc8be94ae9851259777edd74f15dbaf415d4439` | `F5D28DF647A5CF22DB285630BAFD59BC7DC10A89608170EF0A877E58CB18AA02` |

## Acceptance and recovery

MAT060P establishes retained road packet submission, zero-upload steady frames,
deterministic release, teardown, and rejected-request atomicity. It does not yet
capture a road frame, compose later effects, select projected camera demand,
prove connected boundaries, compile CPU/WGSL/native parity, or provide
research-fitted presets and public controls.

Re-evaluated estimated 0.6.0 completion is **63.8%**, up **0.7 percentage
points** from MAT060O's 63.1%. Recovery is `git revert` of this packet commit;
only the private road scene, focused test, and this receipt are owned.
