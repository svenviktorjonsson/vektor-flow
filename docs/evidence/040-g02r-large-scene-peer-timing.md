# 040-G02R large-scene peer timing

Recorded: `2026-08-31`

## Scope

- Base: `354f849`.
- Timing harness: `5b9b7f7`, fair isolated clock: `69f3f56`.
- Retained fixed-state optimization: `701f091`, `9dc5985`.
- Explicit shared GPU completion: `5cd8c81`.
- Exact-count RED/GREEN: `0895b07`, `66727ca`.
- No public VKF API, syntax, schema, ABI, or scene contract changed.
- Every browser run used Edge `--headless=new` and a test-owned profile. A
  visible browser is forbidden by the helper.

## Frozen measurement contract

- Global correctness preflight passes before any timing starts.
- All lanes run on the same host, browser, and hardware GPU renderer.
- Loopback HTTP supplies COOP/COEP isolation; the observed clock quantum must
  be at most `0.01 ms`.
- Each timing lane records exactly 60 warmup frames and exactly 120 samples.
- Every sample contains exactly one render and one explicit GPU completion.
- Correctness, warmup, sample, and total completion counts must match exactly;
  over-counted work cannot be published as the 60/120 protocol.
- The rotated workload order and common framebuffer-region oracle remain
  unchanged.

## Real hardware result

Environment:

```text
Windows_NT 10.0.26200 x64
Intel Core Ultra 7 255U
Microsoft Edge 152 / HeadlessChrome 152
WebGL 2.0 / ANGLE Intel Graphics D3D11
1280x720, DPR 1
minimum positive clock delta: 0.004999995 ms
```

| Workload | Implementation | Median ms | VKF / peer |
| --- | --- | ---: | ---: |
| 100k static | VKF | 0.0200 | - |
| 100k static | deck.gl 9.3.11 | 1.0025 | 0.01995 |
| 100k static | VTK.js 36.10.0 | 0.2175 | 0.09195 |
| 100k static | Plotly scattergl 4.0.0 | 0.0200 | 1.00000 |
| 1M retained pan | VKF | 0.0350 | - |
| 1M retained pan | deck.gl 9.3.11 | 0.6150 | 0.05691 |
| 1M retained pan | VTK.js 36.10.0 | 0.2175 | 0.16092 |

All five published comparable ratios are strictly below the 0.4 `<1.5x`
ratchet. Plotly's public relayout remains non-comparable for the retained 1M
camera-only workload, as frozen by 040-G02Q; it is not timed or claimed there.

## TDD and diagnostic history

RED findings retained as raw evidence:

1. the first timing attempt used a software renderer and was withheld;
2. the first hardware correctness attempt ended with an owned-profile cleanup
   failure and was withheld;
3. the first complete fair hardware run failed the static Plotly ratchet at
   `2.5x` because VKF redundantly submitted unchanged retained state;
4. the first optimized run observed a zero-duration sample and was withheld;
5. independent review found that 121 samples and surplus GPU completions could
   still be accepted while the evidence claimed exact 60/120 work.

GREEN behavior:

- exact retained state is a no-op while camera, point size, color, or mutable
  public point data still redraws;
- every shared WebGL context uses fence, flush, finish, and fence deletion;
- exact sample, warmup, measured-frame, correctness-completion, and total-
  completion equality is enforced before publication;
- a fresh VTK 1M isolated preflight passed all five camera checkpoints and
  exited cleanly before the final full matrix;
- the final seven-lane correctness and timing matrix passed without relaxing
  the oracle or workload responsibilities.

## Commands and results

```text
npm run test:large-scene-benchmark-harness
35 passed; 2 fixtures verified; harness scaffold remains claim-free

node --test tests/js/vf-screen-point-cloud-renderer.test.mjs
7 passed

VF_LARGE_SCENE_TIMING_PORT=9870 node tests/helpers/run_large_scene_peer_timing_matrix.mjs
7/7 correctness preflights passed
7/7 exact 60/120 timing lanes passed
5/5 comparable ratios passed the strict <1.5x ratchet
performanceClaim: true

npm test
first run: 411 passed, 1 skipped, 1 unrelated physics timing flake
focused physics rerun: 38 passed
full rerun: 412 passed, 1 expected portable-archive skip, 0 failed
```

Machine-readable final evidence:
`artifacts/040-g02r-large-scene-peer-timing.json`.
Artifact SHA-256:
`d7f01bdf4d590c95a62d6785aac4f9fdd73972f1f2f281add8f7dc5d393acf59`.

The four `attempt*` artifacts preserve every withheld result and raw sample
available before the passing run; none carries a performance claim.

## Honest limits

These results establish the frozen 0.4 correctness-gated large-scene ratchet
on this recorded Intel D3D11 system. They are not a universal hardware claim,
and the deferred 0.6 `<0.5x` target remains outside this gate. Static work can
fall near the 5-microsecond clock quantum, so raw samples and the exact clock
evidence are retained rather than implying more precision than was observed.
