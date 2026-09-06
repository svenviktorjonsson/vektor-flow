# Weathered granite crater profile R7

Date: 2026-09-06. Base: `bca0492c`.
Branch: `pre-gen`.

## Scope

R7 changes only two existing scalar-height profiles. The dense R6 micro octave
now uses smoothstep lip bands around a deeper narrow negative bowl. The R6
meso positive power peak is removed; its correlated `0.025`-scale field is a
broad signed mound with amplitude `0.0032`. The same finite-difference normal,
footprint filter, and bounded eight-step directional horizon consume both.

Silhouette, geometry, granite mineral albedo, camera, and lights are unchanged.
No public VKF syntax, extra triangles, fallback renderer, motion, or physics was
added. No performance claim is made.

## RED to GREEN

RED proved no crater-depth/rim-slope or meso-curvature contract existed. GREEN
pins the smooth crater and mound profiles below. The historical positive-peak
fraction bound was tightened to match the requested removal of large sharp
knobs; pit, isotropy, shadow, mineral, and geometry gates remain intact.

Root visual QA passed the overhead and phone close-up direction before final
left/right capture. Final full-size inspection shows dense small lips and bowls,
short grazing shadows that reverse with light, and broad rounded meso relief.

## Exact evidence

- Maximum sampled micro crater depth: `0.0012256812697908509`.
- Micro rim-slope p95: `1.8279880093174914`, bounded below `2.2`.
- Left/right local shadow reversal fraction: `0.44189453125`.
- Meso curvature p95: `25.72703833063374`; ratio to R6 profile:
  `0.35012742382030754`.
- Dense micro tile empty fraction: `0`.
- Micro amplitude at the filtering cutoff: exact `0`.
- Positive-peak fraction `0.008544921875`; pit fraction `0.08251953125`.
- Geometry remains 2,594 vertices / 5,184 triangles and 238,600 bytes.
- Vertex SHA-256:
  `3EAAB3E69D572CFDDA5DD692B64AB551DD8CBF543400D0AE3AD42D498B02353B`.
- Index SHA-256:
  `979D57B1FCA84DEA356D02DF49A30A6F95785120C06AABDBCBD85F791EE6266E`.
- Repeat overhead capture is byte-identical.

## Gates

| Gate | Result |
| --- | --- |
| Complete rock/stone/granite JavaScript cohort | 49/49 GREEN |
| Crater depth/rim/directional reversal | GREEN |
| Rounded meso curvature | GREEN |
| Enabled/disabled geometry | exact GREEN |
| Repeat overhead capture | byte-exact GREEN |
| Real WebGPU proof | 4/4 GREEN, 1318 x 777; zero runtime/WGPU errors |
| Physics | 0 |

## Captures

- Overhead: `068-weathered-granite-crater-overhead.png`, 846,275 bytes,
  SHA-256
  `13ED2A3C6C4832EEDAF4FCBE74C9464C549A268C06A64358FCD35C27ED1E9067`.
- Left grazing: `068-weathered-granite-crater-left.png`, 695,581 bytes,
  SHA-256
  `E5BD0B864A3C77E9377D7FFE2A390976F92D89215A39CD855DFBDD2129F31F73`.
- Right grazing: `068-weathered-granite-crater-right.png`, 862,507 bytes,
  SHA-256
  `766199193954BA8DD4A9E66C9DD361A85F9AACB83592040D58F299A95FC4AB52`.
- Phone close-up: `068-weathered-granite-crater-close.png`, 1,495,641 bytes,
  SHA-256
  `041F8CA0EB1DD437689D455FA27293CD9F3F9C958CBB379F0C102A6C97DA22D2`.
