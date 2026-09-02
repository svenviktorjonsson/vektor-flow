# 0.6.0 MAT060N — road construction renderer-packet evidence

## Scope

- Base: `80a5a6d8` (`MAT060M`).
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Adds one private retained road construction-to-renderer adapter and focused
  test.
- No public VKF syntax, constructor, API, schema, ABI, package export, shader,
  gallery, fixture, media, or 0.4/0.5 path changes.

## Plan fit

MAT060M retained bounded road-cell demand but stopped before renderer
consumption. MAT060N derives each demanded cell's forward/lateral frame from
MAT060A, evaluates MAT060C's aggregate/binder composition, and lowers one
construction cell to a lit, shadow-casting `field_mesh` quad with deterministic
geometry, material channels, and object identity.

This private adapter intentionally lowers only the construction truth. The
ordering and physical composition of cracks, repairs, markings, dirt, water,
snow, ruts, and shoulders remain future internal integration work rather than
being guessed as a public material contract.

## Observable behavior

Two demanded road cells become two 216-byte renderer packets, each containing
four packed position/normal/color vertices, six triangle indices, and bounded
aggregate, binder, void, albedo, roughness, and displacement channels. Their
first upload is exactly 432 bytes. Reversed demand order retains both packet
objects and uploads zero bytes. Replacing one demand retains one packet,
removes one ID, and uploads only the new packet.

One pinned packet proves the road frame, +Z normal, construction relief, color,
composition fractions, roughness, and stable 32-bit object identity. Private
WeakMap provenance rejects forged retained adapter state and cross-coordinate
or cross-construction reuse.

## RED / GREEN

- Baseline `80a5a6d8`: MAT060A-M, conditioned-distribution, and spatial-field
  suites passed 42/42 (exit 0, 1.103 s) on Node.js 24.11.0 / Windows x64.
- RED 1: the focused behavior failed only because
  `vf-road-construction-renderer-packets.mjs` did not exist (exit 1, 0.191 s).
- GREEN 1: field-mesh lowering, retained identity, and upload deltas passed 1/1
  (exit 0, 0.214 s).
- RED 2: the existing behavior stayed green while forged-state rejection
  produced an uncontracted internal TypeError (1/2 pass, exit 1, 0.242 s).
- GREEN 2: renderer lowering and explicit adapter provenance passed 2/2 (exit
  0, 0.229 s).

## Executable evidence

```text
node --test tests/js/vf-road-construction-renderer-packets.test.mjs tests/js/vf-road-refinement-working-set.test.mjs tests/js/vf-road-shoulder-field.test.mjs tests/js/vf-road-rut-field.test.mjs tests/js/vf-road-water-field.test.mjs tests/js/vf-road-edge-breakdown-field.test.mjs tests/js/vf-road-snow-field.test.mjs tests/js/vf-road-dirt-field.test.mjs tests/js/vf-road-repair-field.test.mjs tests/js/vf-road-marking-field.test.mjs tests/js/vf-road-crack-field.test.mjs tests/js/vf-road-construction-field.test.mjs tests/js/vf-road-wear-field.test.mjs tests/js/vf-road-coordinate-field.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs
```

- 44/44 pass, 0 fail, exit 0, 1.659 s.
- `git diff --check` is clean.
- The packet verifies deterministic numeric renderer buffers but does not own a
  scene/frame invocation, so offscreen capture does not apply yet.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-road-construction-renderer-packets.mjs` | `dbf6a81c4466d9a92a03faea52d0a1829ffb2907` | `D64A3D58A3E0B8FDF8DE76CC347319853F3F3D4AC1F294633144DAA44C1B8C76` |
| `tests/js/vf-road-construction-renderer-packets.test.mjs` | `d64b5b72115ea7a208481baffd8e551d2b41ac1f` | `DC120313437ED481AC445BE771F92F282E310C7085B395DD62930EA091DE4AC2` |

## Acceptance and recovery

MAT060N establishes retained construction-field renderer packets and bounded
upload deltas for demanded road cells. It does not yet compose later road
effects, invoke a retained scene/frame, select demand from projected error,
prove connected boundaries, compile CPU/WGSL/native parity, or provide
research-fitted presets and public controls.

Re-evaluated estimated 0.6.0 completion is **62.6%**, up **0.6 percentage
points** from MAT060M's 62.0%. Recovery is `git revert` of this packet commit;
only the private renderer adapter, focused test, and this receipt are owned.
