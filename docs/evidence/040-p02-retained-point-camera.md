# 040-P02 retained point-camera update

Recorded: `2026-08-31`

## Scope

- Base: `1a1a2c98d0817efa3ce9cd15f6ee319509666640`.
- Renderer implementation: `bac1ced`.
- VKF benchmark adapter and oracle: `ee7c2e0`.
- Hidden GPU capture: `bf7c87d`.
- Harness wiring: `6eec0e4`.
- No public VKF API, syntax, schema, ABI, or shader semantics changed.
- Browser verification used Edge `--headless=new` with SwiftShader and a
  test-owned profile. A visible browser is forbidden by the helper.

## Delivered behavior

- A private retained-data marker uploads the exact packed point fixture once.
- A camera pan updates only the projection uniform and issues another draw.
- One million packed `x,y` points retain the same typed-array and GPU-buffer
  identities across camera frames.
- Ordinary public world-point calls retain their mutable-buffer contract and
  reupload when called again.
- The benchmark adapter follows the camera formula and fixture hashes frozen by
  the 040-P01 contract. It records correctness only; peer adapters and timing
  remain absent.

## TDD receipt

RED sequence:

1. the million-point pan test observed 241 buffer writes instead of one;
2. the public mutable-buffer regression test proved a global identity cache
   would incorrectly suppress its second upload;
3. adapter tests failed until the private retained seam, browser-safe fixture
   generator, exact camera path, and ideal-disc region oracle existed;
4. the real hidden capture initially exposed an owned-profile cleanup race,
   fixed with bounded graceful shutdown and retry cleanup.

GREEN behavior:

- 240 unit-test pan frames retain one allocation, one buffer, and one write;
- camera frames 0 and 60 project and capture different output while retaining
  the point buffer;
- the 8x8 subpixel ideal-disc oracle passes both camera frames within the
  manifest error bound and rejects a wrong camera;
- the helper removes only its validated test-owned profile and never targets a
  user browser process.

## Commands and results

```text
npm run test:large-scene-benchmark-harness
12 tests passed; 2 fixtures verified; 0 published comparisons

node --test tests/js/vf-screen-point-cloud-renderer.test.mjs
6 tests passed

npm run capture:retained-point-camera
headless WebGL2/SwiftShader; exit 0
1,000,000 points; 8,000,000 source bytes
1 buffer allocation; 1 buffer write; 2 draws
frame 0 SHA-256: 9ce05c2fd296832b348e8fb41a39dba22bcd0355d2d9784cb98b8531ba49f124
frame 60 SHA-256: 1989b73b73475e2c61be501ffea364e51b770cb83da29569890e08ee8c84b7de
oracle frame 0 max region error: 0.04578751525769828
oracle frame 60 max region error: 0.047167129032492344

npm test
398 tests: 397 passed, 1 expected portable-archive skip, 0 failed
```

Machine-readable capture result:
`artifacts/040-p02-retained-point-camera-headless.json`.
Artifact SHA-256:
`9b2d84b968ff6d1f1df6f6765651206d2bd1461206ef4a5591ccbf248a7d3114`.

## Honest limitation

This slice proves correctness and retained upload behavior, not speed. The GPU
capture runs on SwiftShader and records no timing (`performanceClaim: false`).
Equivalent deck.gl, VTK.js, and Plotly adapters are still required before any
peer row can be measured or published under the 0.4 `<1.5x` ratchet.
