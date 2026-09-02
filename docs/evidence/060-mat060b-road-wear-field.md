# 0.6.0 MAT060B — road wear-field evidence

## Scope

- Base: `c1b0b3c6` (`MAT060A`).
- Branch: `codex/0.6/060-mat060b-road-wear-field`.
- Adds one private correlated road wear-field reference oracle and focused test.
- No public VKF syntax, constructor, API, schema, ABI, package export, shader,
  renderer entrypoint, gallery, fixture, media, or 0.4/0.5 path changes.

## Plan fit

MAT-060 requires the same traffic and exposure fields to affect geometry and
appearance. MAT060B samples deterministic spatially correlated traffic and
weather drivers from MAT060A's longitudinal/lateral coordinates. Those shared
drivers produce geometry displacement and material albedo, roughness, and
wetness without building an intervening road grid.

The JavaScript module is a private correctness oracle, not a product-runtime
dependency or package export. Compiled WASM/native and shader consumers remain
required before release integration.

## Observable behavior

A three-cell MAT060A working set is passed to a two-sample wear budget. MAT060B
borrows coordinate, world-position, and layer-index views from the original
buffers and realizes only two cells. Geometry and material share the exact
same coordinate view.

Traffic and exposure use independently keyed, spatially correlated fields.
Their combined wear darkens and lowers the road surface, reduces roughness,
and conditions wetness. Recreating both fields from the same identity produces
an identical working set.

The two-sample result owns 64 vector bytes: traffic/exposure drivers,
displacement, RGB albedo, roughness, and wetness. Borrowed MAT060A coordinate
buffers are not copied or counted. The other 11,999,999,998 potential road
cells allocate nothing.

## RED / GREEN

- Baseline `c1b0b3c6`: MAT060A, conditioned-distribution, and spatial-field
  suites passed 19/19 (exit 0, 0.849 s) on Node.js 24.11.0 / Windows x64.
- RED `e98cec4e`: the focused test failed only because
  `vf-road-wear-field.mjs` did not exist (exit 1, 0.301 s).
- GREEN `d4c81387`: shared correlated geometry/PBR behavior passed 1/1
  (exit 0, 0.635 s).

## Executable evidence

```text
node --test tests/js/vf-road-wear-field.test.mjs tests/js/vf-road-coordinate-field.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs
```

- 20/20 pass, 0 fail, exit 0, 1.013 s.
- `git diff --check c1b0b3c6..d4c81387` is clean.
- The pre-receipt diff contains only the private reference oracle and focused
  test, so no offscreen capture applies.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-road-wear-field.mjs` | `850b460eb35e4cfcf06c68ac36f0cf4f9c37e20d` | `55C3B386CB99FD71D8D953457077FD864BE32F5CBD894897C86861CD7ACE92C6` |
| `tests/js/vf-road-wear-field.test.mjs` | `d1cf23fc06f80df453367c8682033bc96a7fdf91` | `E0BBEDC6962B95091F432122ED4375D8B49DD085E9D76272940DC5C89DFF6829` |

## Acceptance and recovery

MAT060B satisfies the first private tracer proof that one traffic/exposure
truth drives road geometry and several PBR channels under explicit demand and
memory bounds. It does not yet establish aggregate, binder, markings, cracks,
repairs, drainage, snow, layer geometry, refinement, cache eviction,
CPU/WGSL/native parity, performance ratchets, public controls, or release
integration.

Re-evaluated estimated 0.6.0 completion is **48.3%**, up **0.5 percentage
points** from MAT060A's 47.8%. Recovery is `git revert` of commits after
`c1b0b3c6`; only the private wear oracle, focused test, and this receipt are
owned.
