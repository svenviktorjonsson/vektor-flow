# 040-G02Q large-scene peer adapters

Recorded: `2026-08-31`

## Scope

- Base: `2ab020112666112ff4ca05919854c3bca2ae9d7d`.
- Exact peer packages: deck.gl `9.3.11`, VTK.js `36.10.0`, and
  Plotly.js `4.0.0`.
- Adapter implementation: `c4dcbcc`.
- Correctness-first browser matrix: `c1b62c5`.
- No public VKF API, syntax, schema, ABI, or renderer contract changed.
- Every browser run used Edge `--headless=new`, SwiftShader, DPR 1, and a
  test-owned profile. The helpers never launch a visible browser.

## Delivered behavior

- All four implementations consume the frozen fixtures, camera path, colors,
  viewport, and screen-space point contract.
- deck.gl consumes packed binary x/y positions; VTK.js and Plotly make their
  required planar preparation copies exactly once.
- Each correctness checkpoint waits for explicit GPU completion before
  framebuffer readback.
- Timing is a separate phase and cannot start until every implementation and
  workload has passed the common region oracle and retained-upload gate.
- The matrix records exact package, browser, WebGL renderer, source commit,
  framebuffer hashes, and retained-upload evidence.

## TDD receipt

RED sequence:

1. partial peer publication was accepted by the original contract;
2. peer lifecycle, explicit GPU completion, and browser adapters were absent;
3. deck.gl supplied a layer before its asynchronous device setup and produced
   an empty LayerManager/framebuffer;
4. the VTK Geometry profile lacked the OpenGL SphereMapper override and
   produced a blank framebuffer;
5. Plotly produced valid output colors and dimensions but failed the common
   coverage oracle on both workloads.

GREEN behavior:

- measured workload publication now requires VKF plus all three frozen peers;
- correctness-only matrix execution destroys each adapter without starting
  warmup or timing;
- deck.gl waits for the first natural post-device render before retained
  camera redraws;
- VTK explicitly registers SphereMapper and preserves circular impostors;
- VKF, deck.gl, and VTK.js pass both frozen workloads with zero late large
  point uploads.

## Real matrix result

Environment:

```text
Edge 152 / HeadlessChrome 152
WebGL 2.0
ANGLE Vulkan SwiftShader Device (Subzero)
1280x720, DPR 1
```

| Implementation | 100k static | 1M retained pan |
| --- | ---: | ---: |
| VKF | pass, max error 0.043452 | pass, max error 0.027544 |
| deck.gl 9.3.11 | pass, max error 0.010487 | pass, max error 0.005078 |
| VTK.js 36.10.0 | pass, max error 0.036268 | pass, max error 0.021416 |
| Plotly scattergl 4.0.0 | fail, 0.097165 > 0.08 | fail, 0.080729 > 0.08 |

Result: `6/8` valid correctness rows, `0/8` publishable timing rows,
`timingStarted: false`, and `performanceClaim: false`.

A diagnostic Plotly marker-size probe improved coverage enough to reach the
next gate, where public `Plotly.relayout` performed a large point-buffer upload
after initialization. The probe was reverted. The benchmark does not weaken
the frozen oracle or silently treat Plotly's extra data movement as an
equivalent camera-only update.

## Commands and results

```text
npm run test:large-scene-benchmark-harness
21 tests passed; 2 fixtures verified; 0 published comparisons

VF_LARGE_SCENE_CORRECTNESS_ONLY=1 node tests/helpers/run_large_scene_peer_benchmark.js
deck.gl 100k real headless lane passed; timing: null

npm run capture:large-scene-peer-matrix
6/8 correctness rows; timing not started; no performance claim

npm test
404 tests: 403 passed, 1 expected portable-archive skip, 0 failed
```

Machine-readable matrix:
`artifacts/040-g02q-large-scene-peer-matrix.json`.
Artifact SHA-256:
`72783fd035f88359ca5894c300e03b02415d03dfa0cb76173a4e2fcad1c9dd3b`.

## Honest limitation

This packet delivers real adapters and correctness evidence, not a published
speed comparison. Plotly's frozen rows are unavailable because their rendered
coverage fails the shared oracle; its public camera relayout path also showed
a retained-data violation in the diagnostic probe. Under the 0.4 all-peer
gate, no timing may be published until those rows are both visually correct
and camera-only in data movement.
