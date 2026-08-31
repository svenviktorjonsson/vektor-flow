# 060-MAT010F marked-point evidence

- Packet: `060-MAT010F`, 0.6 MAT-010
- Base: `21c67b30addd9573461359edb7d94a68df8b5b89`
- Branch: `codex/0.6/060-mat010f-marked-points`
- Environment: Windows NT 10.0.26200.0, Node.js v24.11.0
- Scope: internal bounded 2D marked-point candidate reference only; no VKF
  syntax, public package API, schema, runtime, renderer, or material hookup

## Internal behavior

- `sampleMarkedPointCell2Reference(node, cell, options)` derives one immutable
  child demand stream for the requested signed-32 cell and examines at most the
  declared candidate slots.
- A MAT010E spatial field sampled at the cell center modulates slot acceptance:
  `clamp(baseProbability * (1 + spatialStrength * density), 0, 1)`.
- Accepted slots receive frozen 128-bit keyed IDs, positions within their source
  cell, and stable weight/orientation marks. Cell/slot order is canonical.
- Per-cell work is capped at 1,024 slots. Region queries are capped at 4,096
  cells and 65,536 candidate slots before generation or output allocation.
- `queryMarkedPointRegion2Reference` generates only intersected cells and
  filters points through half-open bounds. Neighbor cells crossed by a query
  are included; adjacent half-open regions compose without loss or duplicates.
- There is no world population, grid, cache, or mutable cursor. A distant cell
  demand derives only that cell and its bounded slots.

## RED/GREEN slices

All focused cycles used
`node --test tests/js/vf-marked-point-candidates.test.mjs`.

1. Bounded cell tracer
   - RED: `vf-marked-point-candidates.mjs` did not exist.
   - GREEN: one requested cell produced two pinned frozen candidates.
   - Commit: `4e31033 feat(random): add marked-point cell tracer`
2. Cell validation and cap
   - RED: malformed cells/options reached spatial sampling and large slot counts
     were unbounded.
   - GREEN: strict signed-cell/options validation and a 1,024-slot cap.
   - Commit: `51ee8f0 fix(random): bound marked-point cells`
3. Neighbor-cell region tracer
   - RED: module did not export `queryMarkedPointRegion2Reference`.
   - GREEN: one small cross-boundary region returned pinned candidates from all
     four intersected source cells in canonical order.
   - Commit: `25f5627 feat(random): query marked-point regions`
4. Region validation and caps
   - RED: malformed bounds silently returned empty output and broad queries had
     no work bound.
   - GREEN: finite half-open bounds, signed cell range, cell cap, and aggregate
     candidate-slot cap are checked before generation.
   - Commit: `4206d3b fix(random): bound marked-point regions`
5. Boundary composition
   - GREEN characterization: adjacent regions share no ID and concatenate to
     the exact whole-region result.
   - Commit: `ba67e3e test(random): pin point-cell boundaries`
6. Traversal/chunk/branch independence
   - GREEN characterization: reverse traversal, uneven 3/18/11 chunks,
     recreated hierarchy, and unrelated branch sampling reproduce IDs,
     positions, and marks exactly.
   - Commit: `5626a01 test(random): prove marked-point stability`
7. Worker partitioning
   - RED: the real worker fixture did not exist.
   - GREEN: three worker-thread partitions reproduce main-thread candidate
     records exactly.
   - Commit: `54e1ca3 test(random): prove marked-point worker parity`
8. Spatial and mark statistics
   - GREEN characterization: 2,304 queried cells pin accepted population,
     spatial count correlation, and mark moments without retaining the world.
   - Commit: `94a1dfd test(random): pin marked-point statistics`
9. Distant bounded demand
   - GREEN characterization: a cell at roughly plus/minus two billion derives
     only its two requested candidates.
   - Commit: `ab138a9 test(random): prove bounded point demand`
10. Validation refactor
   - GREEN: cell and region entry points share one private option validator.
   - Commit: `fe47a2b refactor(random): share point-query validation`
11. Identity robustness
   - RED: the pinned candidate contract exposed only 64 keyed identity bits.
   - GREEN: two reserved lanes widen IDs to 128 bits without changing
     acceptance, positions, or marks.
   - Commit: `75fdc01 fix(random): widen candidate identities`

## Pinned spatial and statistical oracles

- Source cell `[2, -1]`, size 10, slots 0 and 1 produce IDs
  `candidate:v1:b0709f36:2f5feefc:d53d96f0:a6505381` and
  `candidate:v1:fb1ae87e:1581e99c:78d197a6:ea1cae26`.
- Their positions are `[24.33209284907207, -2.935679443180561]` and
  `[20.41999283246696, -9.32815571082756]`. Weight marks are
  `0.30771112302318215` and `0.3901456024032086`; orientation marks are
  `4.4799549441969715` and `3.1238375664991485` radians.
- Across a 48 by 48 cell observation window with 16 slots, base probability
  0.5, correlation length 40, and spatial strength 0.9, exactly 18,365
  candidates are accepted.
- Mean weight is `0.4989402512780761`; mean orientation cosine/sine are
  `0.007599462732954929` and `-0.00263045433517926`.
- Adjacent cell-count correlation is `0.7716081897797222`; offset `[47, 31]`
  correlation is `-0.03629859300415917`.
- Cell `[2000000000, -2000000000]` produces two pinned candidates directly,
  proving demand is independent of distance from the origin.

## Test receipts

- Focused MAT010A/B/C/D/E/F command:
  `node --test tests/js/vf-marked-point-candidates.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-demand-random.test.mjs tests/js/vf-demand-random-wgsl.test.mjs`
- Exit/duration: 0 after 1.53 s; 43 tests passed.
- Full command: `npm test`
- Exit/duration: 1 after 11.91 s; 416 passed and 3 failed.
- Every MAT010A/B/C/D/E/F test passed in the complete process.
- The three failures reproduce integration-base mismatches outside all owned
  paths: generated HTML component catalog, symbolic document scope, and
  symbolic named function/constant geometry.

## Handoff

- Owned paths: `web/vf-ui/vf-marked-point-candidates.mjs`,
  `tests/js/vf-marked-point-candidates.test.mjs`,
  `tests/fixtures/vf-marked-point-worker.mjs`, and this receipt.
- SHA-256:
  - module: `80610b2b517292a4f83f046219d92e2b6655a86f69d845c0b177a4686650b095`
  - tests: `12f138a59627deebb7fe0b10dd30873eabe53fb57c1121f8ae83cc14dddc471b`
  - worker fixture: `af7fe011ed283d6f1453ae3e9a810ba92cbe3d0bd518817383802fff30aa5509`
- Git blobs:
  - module: `1a16663e87edf328d5b3e77f8315be7dc021088f`
  - tests: `f620cad2386c2095eda055abfb3331739b5412da`
  - worker fixture: `0e1016bc325e6666f72bd847617d570ea715b477`
- Recovery: the module remains internal and unwired. Reverting this packet
  cannot alter current rendering, material output, or VKF behavior.
