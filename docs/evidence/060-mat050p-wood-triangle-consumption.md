# 0.6.0 MAT050P — wood triangle-consumption evidence

## Scope

- Base: `47f72ac5` (`MAT050O`).
- Branch: `codex/0.6/060-mat050o-wood-ggx-furnace`.
- Adds a private renderer-ready reference adapter from one retained procedural
  wood-cut material packet to complete indexed triangle faces.
- Corrects the private wood-cut grid face winding so every face agrees with
  the retained `axisU x axisV` surface normal.
- No public VKF syntax, API, schema, ABI, shared 0.4 renderer, fixture, media,
  example, manifest, or golden changes.

## Observable behavior

One real MAT010-through-MAT050 wood side-grain cut produces a 5 x 5 material
grid. The adapter consumes its 25 vertices as 32 complete triangle faces and
retains, without copying:

- positions and indices;
- procedural base-color, tangent-normal, and roughness planes; and
- the orthonormal cut-plane tangent, bitangent, normal, and handedness frame.

The test visits all 32 triangles, proves every retained vertex is referenced,
and requires every geometric cross product to have positive signed area
against the packet normal. This exposed an inherited winding mismatch:
`[topLeft, bottomLeft, topRight]` computes `axisV x axisU`, opposite the stored
`axisU x axisV` normal. The corrected faces are
`[topLeft, topRight, bottomLeft]` and
`[topRight, bottomRight, bottomLeft]`.

The adapter validates its fixed triangle budget before retention and rejects
any index outside the retained vertex set before a packet can reach an upload
consumer. These are private acceptance semantics, not a public renderer ABI.

## RED / GREEN

- RED `9a3adb32`: the focused test failed at module resolution because the
  private triangle consumer did not exist (exit 1, 0.364 s).
- GREEN `fafda45a`: the zero-copy adapter and corrected face winding passed the
  focused surface/consumer pair, 4/4 (exit 0, 0.485 s).
- RED `e5ef66d5`: an out-of-range face index was accepted and the robustness
  test failed with `Missing expected exception` (exit 1, 0.747 s).
- GREEN `833d7edf`: face indices are validated against the retained vertex
  count before packet retention; the focused pair passes 5/5 (exit 0,
  0.333 s).

## Executable evidence

Full private MAT010-through-MAT050P procedural chain:

```text
node --test tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-forest-population.test.mjs tests/js/vf-tree-geometry-plan.test.mjs tests/js/vf-wood-growth-coordinates.test.mjs tests/js/vf-wood-volume-field.test.mjs tests/js/vf-wood-cut-plane-grid.test.mjs tests/js/vf-wood-cut-surface-packet.test.mjs tests/js/vf-wood-cut-material-packet.test.mjs tests/js/vf-wood-material-energy.test.mjs tests/js/vf-wood-material-renderer-packet.test.mjs
```

- 48/48 pass, 0 fail, exit 0, 10.826 s on Node.js 24.11.0 / Windows
  x64.
- The existing complete-hemisphere isotropic and anisotropic GGX oracles
  remain green at every procedural refinement level.
- `git diff --check 47f72ac5..833d7edf` is clean.

## Hidden capture

Offscreen Edge/WebGPU shared-renderer boundary capture:

```text
node tests/helpers/capture_mirror_scene.js tests/fixtures/rock-material-field-smoke.html .w/mat050p-renderer-boundary.png 0 9489 rock_material_field_frame
```

- The helper completed with one running renderer, no initialization/runtime
  failures, and no WebGPU error.
- PNG size: 58,298 bytes.
- SHA-256:
  `20C7B5A2E8B1BA73F2CA56AEB5B22159F3D5F1AA8D07B3AAA5066A5DEC8F0B7A`.
- This exactly matches MAT050O, proving the private face-consumer work did not
  alter the frozen shared renderer boundary.
- The transient capture was removed after verification.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-wood-cut-surface-packet.mjs` | `8c0bb80854fef37643855666e6e1cc93272bcd85` | `1B25832899A0E3AEB11BF7A17566A307BB7F55D1583980743DF33942474FF5DD` |
| `web/vf-ui/vf-wood-material-renderer-packet.mjs` | `ec6e418be967e17467b90ce053ccabb28d6b8d69` | `98B922ADA08845C34AB1DDFACD4A10B594957EFDD448DAC4720460FD18AB2540` |
| `tests/js/vf-wood-cut-surface-packet.test.mjs` | `83e67757e5e38b35510a964054f4415607f42f65` | `B8817FF810DD0083AFD87FC09B0B3455D0D1360C925E8CB481E5A8941E19F92F` |
| `tests/js/vf-wood-material-renderer-packet.test.mjs` | `0f9f4db58820c11a31558bc50760578b9e6220b0` | `3A668B7C7A62EDDEF4AE5F9805C39958375BD74F5BD0A74C042CE2469E2FD7C0` |

## Acceptance and recovery

MAT050P advances the 0.6 procedural-material acceptance path from an offline
energy oracle to a bounded, complete-triangle renderer-consumption packet.
Estimated 0.6.0 completion is **40.5%**, up **0.5 percentage points** from
MAT050O's 40.0%.

It does not submit wood packets to WebGPU, change shared culling or mirror
shading, freeze measured wood anisotropy, expose author controls, or define a
public compact-PBR contract. Those remain separate renderer, research, and
Language Design Authority packets. Recovery is `git revert` of commits after
`47f72ac5`; only the private wood surface/material consumer, their focused
tests, and this evidence receipt are owned.
