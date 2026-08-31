# 060-MAT020C view-demand evidence

- Packet: `060-MAT020C`, 0.6 MAT-020
- Base: `62a988cb04d35ea0e51c598d810fa168a9cbd44f`
- Branch: `codex/0.6/060-mat020c-view-demand`
- Environment: Windows NT 10.0.26200.0, Node.js v24.11.0
- Scope: internal deterministic view-demand reference only; no VKF syntax,
  public package API, schema, runtime, renderer, camera, or material hookup

## Internal behavior

- `selectEllipsoidViewDemandReference` classifies coarse faces of the closed
  convex ellipsoid reference against a pinned perspective camera.
- A face with a strictly negative view-facing dot is safely back-facing for
  this convex closed tracer and is excluded. Near-tangent faces remain
  candidates rather than being culled speculatively.
- A visible edge incident to a back face is a silhouette edge. Silhouette
  candidates sort before visible interior candidates, then by measured
  projected silhouette sagitta, projected edge sagitta, conservative bound,
  and binary face ID.
- Thresholding uses a conservative screen-space bound. For an ellipsoid edge
  with normalized angular span `theta`, world deviation is bounded by
  `maxRadius * (1 - cos(theta / 2))`. A perspective Jacobian bound uses the
  ellipsoid's minimum positive view depth and horizontal support radius.
- The measured midpoint sagitta is retained as ranking evidence but never
  substitutes for the conservative threshold bound.
- Budget is an explicit integer from 0 through 64. Selection slices the stable
  rank only after thresholding and can never emit more demands than budget.
- A complete face traversal may arrive forward, reversed, or partitioned into
  chunks. Duplicate, absent, or foreign face identities fail before scoring;
  valid traversals produce identical frozen selection records.

## RED/GREEN slices

All selector cycles used
`node --test tests/js/vf-ellipsoid-view-demand.test.mjs`.

1. Visible silhouette selection
   - RED: `vf-ellipsoid-view-demand.mjs` did not exist.
   - GREEN: an axis camera safely culled four back faces, retained four
     silhouette faces, and spent a budget of two in stable order.
   - Commit: `3910e0a feat(geometry): select silhouette demand`
2. Explicit budget bound
   - RED: negative, fractional, and oversized budgets were silently coerced by
     array slicing.
   - GREEN: strict integer validation with an internal cap of 64.
   - Commit: `942263b fix(geometry): bound view refinement`
3. Camera and error oracle
   - GREEN characterization: near/far cameras pin measured errors,
     conservative bounds, and threshold crossings.
   - Commit: `3c2dbae test(geometry): pin projected error bounds`
4. Silhouette priority
   - GREEN characterization: three visible boundary faces outrank a visible
     interior face under a budget of three.
   - Commit: `3897b60 test(geometry): pin silhouette priority`
5. Traversal and chunk independence
   - RED: traversal chunks were ignored and incomplete or duplicate coverage
     was not rejected.
   - GREEN: forward, reverse, and 1/5/2 chunks produce identical output while
     malformed coverage fails atomically.
   - Commit: `d97bd98 feat(geometry): stabilize chunked demand`
6. Projection validation
   - RED: string/negative error thresholds and degenerate cameras reached
     projection arithmetic.
   - GREEN: shape, camera vectors, FOV, viewport, error, view basis, and
     wholly-positive ellipsoid depth are validated before scoring.
   - Commit: `6c8c399 fix(geometry): validate view demand`

## Pinned camera and error oracles

- Shape radii are `[3, 2, 1.5]`; camera target is the origin, up is
  `[0, 0, 1]`, vertical FOV is `pi/3`, and viewport height is 1,080 pixels.
- At eye `[8, 0, 0]`, the first face has:
  - silhouette error `60.533910158706625` pixels;
  - projected edge error `108.09023430565387` pixels; and
  - conservative error bound `230.11397265001793` pixels.
- Moving the eye to `[16, 0, 0]` gives:
  - silhouette error `30.266955079353313` pixels;
  - projected edge error `36.849502683549346` pixels; and
  - conservative error bound `72.94398963969292` pixels.
- Threshold 230 retains the near candidates and 231 rejects them. Threshold
  72 retains the far candidates and 73 rejects them.
- From eye `[8, 8, 8]`, the three silhouette faces are demanded before
  interior `face:+x:+y:+z`, whose measured projected error is
  `38.242090004204954` pixels.

## Test receipts

- Focused combined command:
  `node --test tests/js/vf-demand-refined-geometry.test.mjs tests/js/vf-ellipsoid-view-demand.test.mjs`
- Exit/duration: 0 after 287.90 ms; 19 tests passed.
- Selector-only tests: 6 passed.
- Full command: `npm test`
- Exit/duration: 1 after 11.48 s; 435 passed and 3 failed.
- Every MAT020A/B/C test passed in the complete process.
- The three failures reproduce integration-base mismatches outside all owned
  paths: generated HTML component catalog, symbolic document scope, and
  symbolic named function/constant geometry.

## Handoff

- Owned paths: `web/vf-ui/vf-ellipsoid-view-demand.mjs`,
  `tests/js/vf-ellipsoid-view-demand.test.mjs`, and this receipt.
- SHA-256:
  - module: `db05e3101c7b1599c34ff4062af2f43ead7c4cc19feb186b00b5abc49c5bfdea`
  - tests: `10c83e3039d43cbbbc3979e1c2f85a37bd082738d5c041002be262e2fb6426e9`
- Git blobs:
  - module: `54b98be0710aa8c676c6f95f5adc769ed015b3bb`
  - tests: `2e827ff74e68894e10564a969252b6f597b172b2`
- Recovery: the selector remains internal and unwired. Reverting this packet
  cannot alter current rendering, materials, runtime, camera behavior, or VKF
  behavior.
