# 040-G09 integration-head large-scene peer timing

Recorded: `2026-08-31`

## Scope

- Integration base: `f708dcc43dc5390c6f062d3d1215628385f10ad8`.
- Tested source: `a498512873c1c3200822972b06780eeaf665c055`.
- The tested source is a descendant of the integration base and includes only
  benchmark-runner hardware-mode and hidden-browser lifecycle repairs.
- Package version reported by the evidence: `0.4.0`.
- No public VKF syntax, semantics, API, diagnostic, schema, ABI, workload, or
  peer applicability contract changed.

## Frozen protocol and environment

- Seven workload-applicable lanes ran in the manifest's rotated order.
- All seven correctness preflights completed before any timing lane started.
- Every timing lane used exactly 60 warmup frames and exactly 120 measured
  samples, with one completed GPU frame per sample.
- Static lanes recorded exactly 181 GPU completions: one correctness
  checkpoint, 60 warmups, and 120 measured samples.
- Retained-pan lanes recorded exactly 185 GPU completions: five correctness
  checkpoints, 60 warmups, and 120 measured samples.
- Every browser process used Edge `--headless=new`, a test-owned profile, and
  the hardware path without the SwiftShader flag. No visible window was used.
- Every preflight and timing lane reported the same renderer:
  `ANGLE (Intel, Intel(R) Graphics (0x00007D41) Direct3D11 vs_5_0 ps_5_0, D3D11)`.
- Host: Windows 10.0.26200 x64, Intel Core Ultra 7 255U, Edge 152,
  1280x720 physical pixels, DPR 1.

## Fresh measured result

| Workload | Peer | VKF median ms | Peer median ms | VKF / peer |
| --- | --- | ---: | ---: | ---: |
| 100k static | deck.gl 9.3.11 | 0.0350 | 1.0075 | 0.03474 |
| 100k static | VTK.js 36.10.0 | 0.0350 | 0.1525 | 0.22951 |
| 100k static | Plotly scattergl 4.0.0 | 0.0350 | 0.0250 | 1.39999 |
| 1M retained pan | deck.gl 9.3.11 | 0.0750 | 1.5950 | 0.04702 |
| 1M retained pan | VTK.js 36.10.0 | 0.0750 | 0.3625 | 0.20690 |

All five comparable ratios are strictly below the active 0.4.0 `<1.5x`
ratchet. Plotly remains not applicable to the retained one-million-point pan
because its public relayout path reuploads immutable point data.

## Verification

```text
node --test benchmarks/large-scene-visualization/peer-adapter-contract.test.mjs
9 passed, 0 failed

npm run test:large-scene-benchmark-harness
37 passed, 2 fixtures verified, scaffold remained claim-free

VF_LARGE_SCENE_GPU_MODE=hardware
VF_LARGE_SCENE_TIMING_PORT=9980
VF_LARGE_SCENE_TIMING_OUTPUT=docs/evidence/artifacts/040-g09-large-scene-peer-timing.json
node tests/helpers/run_large_scene_peer_timing_matrix.mjs

7/7 correctness preflights passed
7/7 exact 60/120 timing lanes passed
5/5 strict ratios passed
status: measured
performanceClaim: true
```

Machine-readable evidence:
`artifacts/040-g09-large-scene-peer-timing.json`.

Artifact SHA-256:
`75f85052863422ffb77bf687cb64e76ef30fca2783dda7e16111f474e3c9b46d`.

The artifact retains all raw samples, correctness checkpoint hashes, exact
completion counts, clock evidence, environment identity, source commit, and
published report. Results from earlier source commits are superseded for the
0.4 integration-head acceptance decision.
