# 060-MAT010E spatial-correlation evidence

- Packet: `060-MAT010E`, 0.6 MAT-010
- Base: `2c848d9a1a100907104cb3ab641050578c22c461`
- Branch: `codex/0.6/060-mat010e-spatial-correlation`
- Environment: Windows NT 10.0.26200.0, Node.js v24.11.0
- Scope: internal deterministic 2D spatial-correlation reference tracer only;
  no VKF syntax, public package API, schema, runtime, renderer, or material
  hookup

## Internal behavior

- `sampleSpatialCorrelation2Reference(node, position, options)` normalizes a 2D
  position by its positive correlation length, reads four demand-keyed lattice
  corners, and applies separable quintic interpolation.
- Each query performs exactly four Philox-backed scalar demands. It stores no
  grid, population, cache, or mutable cursor; cost and temporary storage are
  independent of coordinate magnitude and unrealized field extent.
- Hierarchical generator/version/seed/domain/path/LOD/channel identity comes
  from the immutable MAT010C node. Signed lattice cells map deterministically
  into the two u32 sample-counter lanes.
- Cells are explicitly bounded to `[-2^31, 2^31-2]` on each axis so every
  queried cell and its positive neighbor have unique signed-32 identities.
- Positions and scalar options are strictly finite; correlation length must be
  positive and amplitude non-negative. No malformed query reaches lattice
  sampling.

## RED/GREEN slices

All focused cycles used
`node --test tests/js/vf-spatial-correlation.test.mjs`.

1. Continuous field tracer
   - RED: `vf-spatial-correlation.mjs` did not exist.
   - GREEN: one pinned query read four corners and produced its exact quintic
     interpolation result.
   - Commit: `2969949 feat(random): add spatial correlation tracer`
2. Bounded validation
   - RED: malformed positions and unbounded cells returned NaN or aliased u32
     coordinates instead of failing.
   - GREEN: strict vector/scalar checks and the signed lattice bound reject
     those queries before demand.
   - Commit: `7e43970 fix(random): bound spatial field queries`
3. Hierarchical key characterization
   - GREEN: recreated identity is exact, a sibling hierarchy differs, scaling
     position and correlation length equally preserves the value, and identity
     snapshots remain frozen.
   - Commit: `d66201d test(random): prove spatial key stability`
4. Locality characterization
   - GREEN: 8,192 deterministic probes pin strong nearby correlation and
     negligible distant correlation without retaining a population.
   - Commit: `02d4809 test(random): pin spatial locality oracle`
5. Traversal/chunk characterization
   - GREEN: reverse traversal and uneven 3/38/23 chunks reproduce 64 field
     values exactly.
   - Commit: `23e8d3a test(random): prove spatial traversal order`
6. Worker partitioning
   - RED: the real worker fixture did not exist.
   - GREEN: three worker-thread partitions reproduce the main-thread values
     exactly after identity reconstruction.
   - Commit: `eaee642 test(random): prove spatial worker parity`
7. Bounded demand characterization
   - GREEN: a pinned query roughly two billion cells from the origin completes
     through the same four-corner path, with no intervening grid.
   - Commit: `d08eadc test(random): prove bounded spatial demand`

## Pinned numerical and locality oracles

- Node path `environment:alpine/species:grass/patch:7`, channel
  `moisture-field`, position `[3.25, -1.5]`, and correlation length 2 normalize
  to `[1.625, -0.75]`.
- Its four lattice values are `[0.9703522599302232, -0.8109226217493415,
  0.6690884670242667, -0.7219561780802906]`. Quintic weights
  `[0.72479248046875, 0.103515625]` give normalized field
  `-0.32260995055390373`; mean 10 and amplitude 3 give
  `9.032170148338288`.
- Across 8,192 deterministic positions, offset `[0.05, 0.02]` at unit
  correlation length has Pearson correlation `0.9947067344658742`; distant
  offset `[37.5, 19.25]` has `-0.001725963388763766`.
- Position `[2000000000.25, -2000000000.75]` samples to
  `-0.48314400662804147`, proving demand is not proportional to distance from
  the origin.

## Test receipts

- Focused MAT010A/B/C/D/E command:
  `node --test tests/js/vf-spatial-correlation.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-demand-random.test.mjs tests/js/vf-demand-random-wgsl.test.mjs`
- Exit/duration: 0 after 0.95 s; 34 tests passed.
- Full command: `npm test`
- Exit/duration: 1 after 14.51 s; 407 passed and 3 failed.
- Every MAT010A/B/C/D/E test passed in the complete process.
- The three failures reproduce integration-base mismatches outside all owned
  paths: generated HTML component catalog, symbolic document scope, and
  symbolic named function/constant geometry.

## Handoff

- Owned paths: `web/vf-ui/vf-spatial-correlation.mjs`,
  `tests/js/vf-spatial-correlation.test.mjs`,
  `tests/fixtures/vf-spatial-correlation-worker.mjs`, and this receipt.
- SHA-256:
  - module: `cf8099376361d7fac2e977b46477bef5d5fa7f026c0b0b0bcec9436f35fa4728`
  - tests: `1ae586f30abca7d570612a06cf7188acd40669c873393affbeca26873bd43ba2`
  - worker fixture: `d8042a1213e64f534123f5ed215396e36859914459b54c9e440cc757d40ceb22`
- Git blobs:
  - module: `2a368a670497f792a51e74103e7da0786b25316d`
  - tests: `7ccb19be83f8335ba8eca9ef686164b7f817fc1e`
  - worker fixture: `e984839ac5e9b2b4be46b5718afb76a02653c8d1`
- Recovery: the module remains internal and unwired. Reverting this packet
  cannot alter current rendering, material output, or VKF behavior.
