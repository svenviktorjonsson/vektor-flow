# Weathered granite mineral composition R4

Date: 2026-09-06. Base: `f58710cb39c027f31b541ef39af928b2769f755b`.
Branch: `pre-gen`.

## Scope

R4 keeps the R3 geometry and directional horizon microshadow path, then adds a
light-independent granite composition field. Three separately conditioned,
triplanar distributions produce warm feldspar, pale quartz, and sparse fine
mica at different scales. Mineral identity also varies roughness, while the
existing scalar microheight alone controls light-direction response. A bounded
nondirectional warm bounce term softens occluded cavity floors.

No albedo term uses light direction. No vertices, indices, public VKF syntax,
fallback renderer, motion, or physics were added. No performance claim is made.

## RED to GREEN

RED proved the R3 material had no feldspar population or mineral-composition
metrics. The first GREEN render was rejected locally because mica covered
10.47% and read as large black leopard spots. Final tuning reduced mica to
3.61%, reduced its scale and contrast, and raised bounded cavity bounce. The
native captures were inspected at full size: pink/tan feldspar, pale quartz,
and fine dark mica remain legible on a phone-sized specimen while R3
left/right microshadow reversal remains visible.

## Exact evidence

- Pinned 64 x 64 mineral fractions: feldspar `0.416259765625`, quartz
  `0.27880859375`, mica `0.0361328125`.
- Mineral luminance span `0.3375209207999999`; chroma span
  `0.12669999999999992`; roughness range `[0.64, 0.93]`.
- Light dependency of mineral field: `false`.
- R3 directional proof retained: paired reversal `0.512451171875`; left/right
  shadow fractions `0.374267578125` / `0.3818359375`; overhead
  `0.018310546875`; maximum horizon steps `8`.
- Geometry remains 2,594 vertices / 5,184 triangles. Enabled and disabled use
  identical geometry buffers.
- Vertex SHA-256:
  `3EAAB3E69D572CFDDA5DD692B64AB551DD8CBF543400D0AE3AD42D498B02353B`.
- Index SHA-256:
  `979D57B1FCA84DEA356D02DF49A30A6F95785120C06AABDBCBD85F791EE6266E`.
- Same overhead capture repeated byte-identically, SHA-256
  `2585370D1A6266607EA5F37401984E67EF299FBD56245C53E294C886A739448B`.

## Gates

| Gate | Result |
| --- | --- |
| Focused specimen/material tests | 14/14 GREEN |
| Complete rock/stone/specimen JavaScript cohort | 46/46 GREEN |
| R3 directional microshadow metrics | unchanged GREEN |
| Enabled/disabled geometry | exact GREEN |
| Repeat overhead capture | byte-exact GREEN |
| Real WebGPU proof | 4/4 GREEN, 1318 x 777 |
| Physics | 0 |

## Captures

- Overhead: `062-weathered-granite-mineral-overhead.png`, 638,884 bytes,
  SHA-256
  `2585370D1A6266607EA5F37401984E67EF299FBD56245C53E294C886A739448B`.
- Left grazing: `062-weathered-granite-mineral-left.png`, 487,950 bytes,
  SHA-256
  `0ACC7639BBE8D8C2CF7D29F5DE6862DD78C0AE9083F8E79FCFFC54CE74074815`.
- Right grazing: `062-weathered-granite-mineral-right.png`, 624,192 bytes,
  SHA-256
  `823911DEAE0E16F20DCB3D944A6B7D50F98B5396F32473A843067650D4621858`.
- Matched left-light microshadow-disabled baseline:
  `062-weathered-granite-mineral-disabled.png`, 489,766 bytes, SHA-256
  `CDB7C2E4FDC7080F5F3B3236C11988248F8F871B659844C3208C1281D21E6136`.
