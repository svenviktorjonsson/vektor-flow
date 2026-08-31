# MAT030K demanded grass material realization cache evidence

Date: 2026-09-01

## Packet

- Base: `5bb68fa8b73f595046841625288e16c6c65c9228` (MAT030J).
- Branch: `codex/0.6/060-mat030k-grass-material-lod`.
- Scope: retain deterministic conditioned-node and coarse material realizations for adjacent grass camera demands.
- Public VKF syntax/API/schema changes: none. No renderer, display, compiler, or 0.4-owned file changed.

## Observable contract

- A grass cell's conditioned node, Philox stream words, field/patch material sample, height, roughness, and base color are realized only when that cell is demanded.
- The immutable realization is keyed by canonical integer cell identity and reused by expanded, instanced, batched, and GPU-descriptor paths.
- Reuse cannot change generator results. Existing cell IDs, stream words, material floats, blade records, retained signatures, shadow LOD, draw batching, and upload receipts remain byte-identical.
- The per-field LRU is capped at 8,192 entries: exactly two maximum 4,096-cell demand windows. Adjacent full views therefore coexist instead of sequential traversal evicting the previous view while it is being reused.
- Cells beyond the fixed cap evict least-recently-used realizations and regenerate exactly from their stable key if demanded again.
- The cache stores no expanded blade geometry. Per-blade Philox sampling remains GPU-owned and bounded by the existing 65,536-blade cap.

## RED to GREEN

1. The new cache contract failed because every packet build repeated child conditioning and three spatial-field evaluations for every cell. `eb1d658` adds the bounded realization LRU and routes all material packet factories through it.
2. The first performance assertion correctly exposed a speedup but also added competing timed work to the default parallel suite. `7242124` keeps the regression test deterministic and moves timing to isolated evidence runs.
3. Alternating two maximum views exposed scan pollution at a one-view cache cap. `a84dd53` retains two bounded adjacent windows, eliminating the eviction cascade without making memory dependent on world size.

## Bounded performance evidence

All measurements used the GPU descriptor factory, detail 0, a 4,096-cell/4,096-blade demand, Node 24.11.0, and the same host. MAT030J and MAT030K modules ran in the same process after one warm-up. Each figure is mean ± population standard deviation over the listed samples.

### Cold demand

Six interleaved fresh-field samples:

| Path | Mean | Std | Min | Max |
| --- | ---: | ---: | ---: | ---: |
| MAT030J uncached | 571.40 ms | 130.69 ms | 376.15 ms | 748.92 ms |
| MAT030K cold cache fill | 581.53 ms | 146.59 ms | 456.36 ms | 874.89 ms |

Cold fill is 1.018x the prior mean, well inside the observed variance. It still uploads the exact bounded 196,808 bytes and produces 4,096 blades.

### Adjacent camera pan

After the first view, the second 64×64 cell window shifts by one cell and introduces 64 new cells. Seven alternating samples:

| Path | Mean | Std | Min | Max |
| --- | ---: | ---: | ---: | ---: |
| MAT030J repeated realization | 413.67 ms | 67.59 ms | 311.43 ms | 557.97 ms |
| MAT030K adjacent-view cache | 28.56 ms | 14.04 ms | 13.46 ms | 59.93 ms |

The measured mean speedup is 14.48x. Work remains bounded by one descriptor loop plus at most 64 new material realizations for that pan. This is an isolated CPU material-realization measurement, not an end-to-end frame-throughput claim.

## Executable evidence

Affected material/display/renderer chain:

```text
node --test tests/js/vf-grass-material-realization-cache.test.mjs tests/js/vf-grass-blade-gpu-compute.test.mjs tests/js/vf-grass-material-instances.test.mjs tests/js/vf-grass-camera-demand-runtime.test.mjs tests/js/vf-grass-view-demand.test.mjs tests/js/vf-grass-material-field.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-demand-random.test.mjs tests/js/vf-demand-random-wgsl.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-display-grass-gpu-pass-through.test.cjs tests/js/vf-display-rock-material-pass-through.test.cjs tests/js/vf-geom-grass-gpu-compute.test.mjs tests/js/vf-geom-grass-blade-instances.test.mjs tests/js/vf-geom-grass-shadow.test.mjs tests/js/vf-geom-shared-grass-template.test.mjs tests/js/vf-geom-clustered-light-wiring.test.mjs tests/js/vf-geom-retained-part-identity.test.cjs tests/js/vf-geom-render-evidence.test.cjs
tests 71; pass 71; fail 0
```

Offscreen captures after caching:

| Scene | PNG bytes | SHA-256 | MAT030J parity |
| --- | ---: | --- | --- |
| zero-light horizon | 26,322 | `4D51B1365A376B258829505AEFDA8D9561A404D5AA90441EE557EE40322D77E7` | exact |
| near lit shadows | 154,171 | `165AF490C81AE4BEEF87E1D3DBED489D67B86BEB364C4B1888775F8EC5F0BE8B` | exact |
| far lit shadow LOD | 81,011 | `612F7A80ACA9DBE6670FAC3EE90E3C65C3C251FE6FAB7F40599075E7CC9315F6` | exact |

All three headless WebGPU captures reported no shader, initialization, provider, or runtime failure. Transient PNGs were removed.

Repository suite after the final two-view cap:

```text
npm test
tests 500; pass 497; fail 3
```

The same inherited generated HTML catalog drift and two symbolic sign/endpoint failures remain. The unrelated loaded 100,000-particle threshold failed on one earlier loaded run and passed its isolated target at 58.09 ms; it passed in the final full run. No MAT030K-owned test failed.

## Content hashes

| Path | Git blob | working-tree SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-grass-material-field.mjs` | `f09a4dbf6eba273989972ee214374f4732b3e7ea` | `68E02451FC752CEBA0239055DD6C4FE99F7C4631143AB69931D7F1A8A60B80BF` |
| `tests/js/vf-grass-material-realization-cache.test.mjs` | `2ec0b3c278d97b3a8210521b4fd74867c569c8e1` | `149CF0D1E4B5BDEFF9084BD4DA2740FECF59CE66E46B3B9A5DE03890A8E0F69B` |

## Remaining boundary

This packet intentionally preserves the existing coarse cell material at every blade-density level. Adding higher-frequency color/roughness refinement would change established blade attributes and therefore needs a separate image-stable transition strategy, such as filtered per-fragment evaluation with temporal coverage. MAT030K does not promote a cache size, material LOD threshold, or transition control to the VKF API.

Recovery: drop commits after base `5bb68fa`; no other worktree is required.
