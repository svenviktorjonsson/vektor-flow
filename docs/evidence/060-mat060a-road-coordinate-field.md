# 0.6.0 MAT060A — road coordinate-field evidence

## Scope

- Base: `08306087` (`MAT050AD`).
- Branch: `codex/0.6/060-mat060a-road-coordinate-field`.
- Adds one private road coordinate-field reference oracle and its focused test.
- No public VKF syntax, constructor, API, schema, ABI, package export, shader,
  renderer entrypoint, gallery, fixture, media, or 0.4/0.5 path changes.

## Plan fit

MAT-060 requires construction layers and appearance to share a road coordinate
frame. This first private slice gives geometry and material consumers the exact
same bounded coordinate working set. A road with 12 billion potential
longitudinal/lateral/layer cells realizes only its two demanded cells.

This JavaScript module is a correctness oracle used by tests. It is not a
product-runtime dependency or package export. Later target packets must lower
the frozen internal behavior to compiled WASM/native code and shaders before
the release acceptance experience can use it.

## Observable behavior

Two demanded cells use longitudinal, centered lateral, and layer-center depth
coordinates. Their world positions derive from one orthonormal road frame.
Geometry and material receive the same immutable wrapper and typed buffers,
preventing independently sampled coordinates from drifting apart.

The two-cell working set owns two three-component `Float32Array` coordinate
planes and one two-element `Uint16Array`, totaling 52 vector bytes. The
remaining 11,999,999,998 potential cells allocate nothing.

## RED / GREEN

- Baseline `08306087`: demand-refined geometry and wood-growth coordinate
  suites passed 15/15 (exit 0, 1.480 s) on Node.js 24.11.0 / Windows x64.
- RED `d2ffbd8e`: the focused test failed only because
  `vf-road-coordinate-field.mjs` did not exist (exit 1, 0.417 s).
- GREEN `f51f2135`: the bounded shared-coordinate behavior passed 1/1
  (exit 0, 1.053 s).

## Executable evidence

```text
node --test tests/js/vf-road-coordinate-field.test.mjs tests/js/vf-demand-refined-geometry.test.mjs tests/js/vf-wood-growth-coordinates.test.mjs
```

- 16/16 pass, 0 fail, exit 0, 1.973 s.
- `git diff --check 08306087..f51f2135` is clean.
- The diff before this receipt contains only the private reference oracle and
  its focused test, so no offscreen capture applies.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-road-coordinate-field.mjs` | `87f147ca0b77a9df13885d99db8976d499753c02` | `3F5C5FCE29C876F266B95397C8441014BD8405280C12B5A733DC803C6C7A7ACF` |
| `tests/js/vf-road-coordinate-field.test.mjs` | `10ea2ee99a4fb2951d36e7b9e8b25b54513c485b` | `840DF158692D6F5E924A51E120E1CFF84AEA59438FCF3528AA144572C32B9301` |

## Acceptance and recovery

MAT060A starts the road tracer with one deterministic, lazy, bounded coordinate
truth shared by coarse geometry and material demand. It does not yet establish
road geometry, aggregate, binder, markings, cracks, traffic/exposure fields,
wetness, refinement, cache eviction, CPU/WGSL/native parity, performance
ratchets, public controls, or release integration.

Re-evaluated estimated 0.6.0 completion is **47.8%**, up **0.4 percentage
points** from MAT050AD's 47.4%. Recovery is `git revert` of commits after
`08306087`; only the private road oracle, focused test, and this receipt are
owned.
