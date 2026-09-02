# 0.6.0 MAT060M — road refinement working-set evidence

## Scope

- Base: `ae2d7999` (`MAT060L`).
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Adds one private retained road-cell refinement working set and focused test.
- No public VKF syntax, constructor, API, schema, ABI, package export, shader,
  renderer entrypoint, gallery, fixture, media, or 0.4/0.5 path changes.

## Plan fit

The 0.6 acceptance experience requires distant bounded structure, demand-only
refinement, deterministic regeneration, and memory release after demand moves.
MAT060M canonicalizes road-cell demands independently of traversal order,
retains unchanged cell packets, evicts dropped cells, and regenerates evicted
coordinates exactly from MAT060A's road-coordinate truth.

This is a private reference working set rather than public scheduling API.
Projected-error selection, shared cell boundaries, field composition, renderer
packets, and author controls remain separate work.

## Observable behavior

Three unordered demands under a two-cell budget materialize the same two
canonical cells in stable order. Reversing demand order retains both packet
objects. Moving demand retains one, evicts one, and creates one. Empty demand
releases all 52 vector bytes; re-demanding the first evicted cell creates a new
packet with byte-identical coordinates, position, and layer index.

Each active cell packet owns only 26 vector bytes. The working set exposes the
300,000,000,000-cell potential domain without realizing an intervening grid.
Private WeakMap provenance rejects forged or cross-field previous state, and a
65,536-cell budget ceiling rejects unbounded materialization.

## RED / GREEN

- Baseline `ae2d7999`: MAT060A-L, conditioned-distribution, and spatial-field
  suites passed 40/40 (exit 0, 1.679 s) on Node.js 24.11.0 / Windows x64.
- RED 1: the focused behavior failed only because
  `vf-road-refinement-working-set.mjs` did not exist (exit 1, 0.185 s).
- GREEN 1: retention, eviction, release, and deterministic regeneration passed
  1/1 (exit 0, 0.259 s).
- RED 2: the existing behavior stayed green and forged-state rejection failed
  with a missing expected exception (1/2 pass, exit 1, 0.383 s).
- GREEN 2: refinement behavior and bounded-state rejection passed 2/2 (exit 0,
  0.246 s).

## Executable evidence

```text
node --test tests/js/vf-road-refinement-working-set.test.mjs tests/js/vf-road-shoulder-field.test.mjs tests/js/vf-road-rut-field.test.mjs tests/js/vf-road-water-field.test.mjs tests/js/vf-road-edge-breakdown-field.test.mjs tests/js/vf-road-snow-field.test.mjs tests/js/vf-road-dirt-field.test.mjs tests/js/vf-road-repair-field.test.mjs tests/js/vf-road-marking-field.test.mjs tests/js/vf-road-crack-field.test.mjs tests/js/vf-road-construction-field.test.mjs tests/js/vf-road-wear-field.test.mjs tests/js/vf-road-coordinate-field.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs
```

- 42/42 pass, 0 fail, exit 0, 1.309 s.
- `git diff --check` is clean.
- The packet is a private nonvisual correctness oracle, so deterministic
  offscreen capture does not apply.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-road-refinement-working-set.mjs` | `432d69e187aa090fbeed8db2c40725d3c83031c0` | `12D0A01C199876FF9215F1B358B86CCA92CDF6834942F854A72F81C8B5BFD2E4` |
| `tests/js/vf-road-refinement-working-set.test.mjs` | `1e4660accae2b851c536c9d55b3f0d59574103bf` | `552668DD4C762AB7A400118634D90CBEEB6B49B550671C68B38EFEDF640832DE` |

## Acceptance and recovery

MAT060M establishes bounded road-cell retention, eviction, and deterministic
regeneration. It does not yet establish projected-error selection, connected
boundaries, composed road material packets, renderer consumption,
CPU/WGSL/native parity, research-fitted presets, public controls, or release
integration.

Re-evaluated estimated 0.6.0 completion is **62.0%**, up **0.5 percentage
points** from MAT060L's 61.5%. Recovery is `git revert` of this packet commit;
only the private refinement oracle, focused test, and this receipt are owned.
