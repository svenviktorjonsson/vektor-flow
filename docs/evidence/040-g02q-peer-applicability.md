# 040-G02Q workload-specific peer applicability

Recorded: `2026-08-31`

## Scope

- Base evidence packet: `e168c80`.
- Workload applicability and Plotly static calibration: `8ca4c25`.
- Required-gate evidence naming: `e841a30`.
- No public VKF API, renderer, syntax, schema, or ABI changed.
- Browser evidence is Edge `--headless=new` with SwiftShader and test-owned
  profiles. No visible browser is permitted.

## Contract correction

Peer applicability is now explicit per workload:

- 100k static requires VKF, deck.gl, VTK.js, and Plotly scattergl;
- 1M retained camera pan requires VKF, deck.gl, and VTK.js;
- Plotly 1M pan is non-comparable because public `Plotly.relayout` reuploads
  the immutable x/y point buffers during a camera-only update.

The manifest partitions every implementation into comparable or
non-comparable lanes with an exact reason. Published rows must include every
comparable implementation for that workload, and every VKF-to-peer ratio must
remain strictly below `1.5x`. A failed or non-applicable lane cannot contain
correctness or timing evidence.

## Plotly static calibration

Plotly's declared 2 px marker rasterized with lower coverage than the frozen
ideal 2 px disc. The static adapter therefore declares a 2.4 px Plotly marker
input calibrated against `sampled-frame-regions-v1` framebuffer coverage. It
does not call `relayout` for the fixed-camera frame.

Real headless result:

```text
Plotly scattergl 4.0.0, 100,000 points
max region error: 0.0062651798671867764 (limit 0.08)
framebuffer SHA-256: b2c5a7643b862797ee5b30e8483832b89c82737de85f1780f66bed77c0f259e8
late large uploads: 0
timing: null
```

This changes adapter calibration, not the common oracle or its tolerance.

## TDD receipt

RED:

1. the manifest had no workload-specific applicability classification;
2. reports rejected an honest `not-applicable` lane and required all four
   implementations for retained pan;
3. Plotly static failed the frozen framebuffer oracle at `0.097165 > 0.08`;
4. a diagnostic camera relayout exposed the immutable-buffer reupload that
   makes Plotly's 1M pan non-comparable.

GREEN:

- manifest validation requires a complete, disjoint applicability partition;
- retained pan rejects Plotly timing and still requires VKF, deck.gl, and
  VTK.js together;
- static Plotly passes the unchanged oracle with zero late large uploads;
- the matrix skips the non-comparable lane and never starts its browser or
  timing path.

## Commands and results

```text
npm run test:large-scene-benchmark-harness
23 tests passed; 2 fixtures verified; 0 published comparisons

npm run capture:large-scene-peer-matrix
7/7 required correctness rows passed
timingStarted: false
performanceClaim: false

npm test
404 tests: 403 passed, 1 expected portable-archive skip, 0 failed
```

Machine-readable matrix:
`artifacts/040-g02q-large-scene-applicable-peer-matrix.json`.
Artifact SHA-256:
`fe15341440ad6217871c4e43081447818c999a7110df7dd6f93d76d10eb6414c`.

## Honest limitation

All applicable correctness lanes are now ready for a distinct timing phase,
but this packet records no timings and makes no performance claim. Plotly 1M
pan remains excluded unless a public camera-update path can be demonstrated
that retains its immutable point buffers.
