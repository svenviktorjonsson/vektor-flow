# 060-MAT010D conditioned-distribution evidence

- Packet: `060-MAT010D`, 0.6 MAT-010
- Base: `3ef7324f6869391c7c08ae49b963140a9d72e62c`
- Branch: `codex/0.6/060-mat010d-conditioned-distributions`
- Environment: Windows NT 10.0.26200.0, Node.js v24.11.0
- Scope: internal weighted-categorical and 2D correlated-normal reference
  kernels only; no VKF syntax, public package API, schema, runtime, renderer,
  or material hookup

## Internal behavior

- `sampleWeightedCategoricalIndex(node, sample, weights)` maps one keyed u32
  through compact non-negative weights in one bounded scan. It never expands
  weights into a repeated population and allocates no storage proportional to
  their magnitudes. Arrays and numeric typed arrays are accepted.
- Empty, all-zero, negative, non-finite, non-numeric, non-array-like, and
  overflowing weight sets are rejected before sampling.
- `correlatedNormal2ReferenceFromU32` turns one Box-Muller pair into a 2D normal
  through the Cholesky form `y = rho*z0 + sqrt(1-rho^2)*z1`. Means must be two
  finite numbers, standard deviations two finite non-negative numbers, and
  correlation finite in `[-1, 1]`.
- `sampleCorrelatedNormal2Reference` feeds that transform directly from the
  immutable hierarchical demand node. Both new samplers remain stateless and
  have no cursor, eager population, or traversal dependence.
- JavaScript `Math` defines the CPU numerical oracle. This packet does not
  claim bit-identical GPU transcendental results.

## RED/GREEN slices

All focused cycles used
`node --test tests/js/vf-conditioned-distribution.test.mjs`.

1. Weighted category tracer
   - RED: module did not export `sampleWeightedCategoricalIndex`.
   - GREEN: keyed sample `3:0` selected index 2 from weights `[1, 3, 6]`
     without expanding a population.
   - Commit: `edd302f feat(random): add weighted category sampling`
2. Compact-weight validation
   - RED: empty and malformed weight sets returned values instead of failing.
   - GREEN: strict shape/value/total validation plus compact trillion-scale
     weights.
   - Commit: `fc1ea85 fix(random): validate category weights`
3. Correlated-normal numerical transform
   - RED: module did not export `correlatedNormal2ReferenceFromU32`.
   - GREEN: the explicit u32 pair matched the pinned 2D oracle.
   - Commit: `70e1d54 feat(random): add correlated normal transform`
4. Hierarchical demand-key seam
   - RED: module did not export `sampleCorrelatedNormal2Reference`.
   - GREEN: the keyed child reached the same pinned transform.
   - Commit: `6e2849d feat(random): key correlated normal samples`
5. Correlation parameter validation
   - RED: malformed vectors and correlations produced NaN or partial output.
   - GREEN: exact 2D shape, finite values, non-negative deviations, and closed
     correlation bounds are enforced.
   - Commit: `0572607 fix(random): validate correlated normals`
6. Independence characterization
   - GREEN: reverse traversal, uneven 5/17/10 chunks, and unrelated branch
     sampling reproduce 32 category/correlated-normal pairs exactly; identities
     and hierarchy remain frozen.
   - Commit: `06c00ce test(random): prove new sampler independence`
7. Statistical characterization
   - GREEN: 65,536 keyed samples match pinned category counts and target 2D
     moments without retaining a sample population.
   - Commit: `706ab91 test(random): pin distribution statistics`
8. Refactor
   - GREEN: scalar and correlated normals share one private Philox-block and
     Box-Muller-pair implementation without changing any oracle.
   - Commit: `be9694c refactor(random): share normal primitives`

## Pinned numerical and statistical oracles

- Weighted child channel `species`, sample `3:0`, begins with u32 `8980d855`.
  Its unit value `0.5371222693938762` gives target `5.371222693938762` over
  total weight 10, selecting index 2 from `[1, 3, 6]`.
- Correlated child channel `blade-height`, sample `3:0`, begins with
  `f4d2fe28 9ffe0525`. Box-Muller gives
  `z0 = -0.211314994328257`, `z1 = -0.21123478553283764`; mean `[10, -5]`,
  deviation `[2.5, 4]`, and correlation `0.75` produce
  `[9.471712514179357, -6.192819693750724]`.
- The 65,536-sample deterministic population produces category counts
  `[6613, 19511, 39412]` for weights `[1, 3, 6]`.
- Its correlated-normal moments are mean `[9.991840419775945,
  -5.001695796916131]`, variance `[6.269534735859509,
  15.94582437606611]`, covariance `7.501957418999083`, and correlation
  `0.7502974147724998`, against targets `[10, -5]`, `[6.25, 16]`, `7.5`, and
  `0.75`.

## Test receipts

- Focused MAT010A/B/C/D command:
  `node --test tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-demand-random.test.mjs tests/js/vf-demand-random-wgsl.test.mjs`
- Exit/duration: 0 after 2.00 s; 27 tests passed.
- Full command: `npm test`
- Exit/duration: 1 after 26.12 s; 400 passed and 3 failed.
- Every MAT010A/B/C/D test passed in the complete process.
- The three failures reproduce integration-base mismatches outside all owned
  paths: generated HTML component catalog, symbolic document scope, and
  symbolic named function/constant geometry.

## Handoff

- Owned paths: `web/vf-ui/vf-conditioned-distribution.mjs`,
  `tests/js/vf-conditioned-distribution.test.mjs`, and this receipt.
- SHA-256:
  - module: `6e61b07e9aa0f1e7f73d487b744f891e5a5e4834234d42f6c5d8e839307ce679`
  - tests: `3d3bf749e9fa05e976591dffb27b70a9ec37f80869126f7e6b2aa3899d733ffa`
- Git blobs:
  - module: `5e9c7be4870e8406c573ff10efc98b3730b75d1e`
  - tests: `cca283de3788e490c904867afeb96526825f4deb`
- Recovery: the module remains internal and unwired. Reverting this packet
  cannot alter current rendering, material output, or VKF behavior.
