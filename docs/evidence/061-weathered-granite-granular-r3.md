# Weathered granite granular microrelief R3

Date: 2026-09-06. Base: `132b0038e56ac0da0559127ad460b9550dd2eac4`.
Branch: `pre-gen`.

## Scope

This private R3 material variant replaces the rejected directional-striation
look with a conditioned triplanar, isotropic scalar height field. Three
footprint-filtered bands create broad mineral relief, grain peaks, and sparse
pits. A finite gradient drives the surface normal; spatial roughness remains in
`[0.70, 0.93]`; specular strength stays low. An eight-step maximum horizon
march follows the primary light through stable stone coordinates and attenuates
direct/specular energy only. Albedo contains subdued nondirectional mineral
variation, never a baked light direction.

R3 also replaces the mechanically level perimeter with a deterministic bounded
support undulation. It changes no topology or triangle count. The granular
enabled and disabled material variants retain byte-identical geometry.

No VKF syntax, public API, fallback renderer, geometry subdivision for
microrelief, motion, or physics was added.

## RED to GREEN

RED first lacked a granular material reference and renderer variant. The first
GREEN compile remained visually too close to the disabled baseline. Iteration
corrected local/world tangent-light conversion, separated directional shadow
energy from subdued albedo, reduced broad-band dominance and pit density, and
made the matched side-light proof readable at phone scale. Native-resolution
self-review finds no uniform parallel brush field: overhead keeps short normal
breakup, left/right move the illuminated and occluded grain response, and the
matched disabled view removes horizon-shadow pits.

## Exact evidence

- Geometry: 2,594 vertices, 5,184 triangles, 238,600 vector bytes.
- Vertex SHA-256, granular enabled and disabled:
  `3EAAB3E69D572CFDDA5DD692B64AB551DD8CBF543400D0AE3AD42D498B02353B`.
- Index SHA-256, granular enabled and disabled:
  `979D57B1FCA84DEA356D02DF49A30A6F95785120C06AABDBCBD85F791EE6266E`.
- Pinned 64 x 64 probe: orientation-energy ratio `1.04649818443091`;
  peak/pit fractions `0.083251953125` / `0.119384765625`.
- Left/right grazing shadow fractions `0.374267578125` / `0.3818359375`;
  overhead `0.018310546875`.
- Image-space paired left/right shadow reversal fraction
  `0.512451171875`.
- Roughness range `[0.70, 0.8986274940385186]`; maximum horizon work eight
  steps.
- Support perimeter: 17 exact contacts across 8 angular bins; height span
  `0.055`; minimum triangle area `0.0001873247657864388`.
- Same overhead capture repeated byte-identically, SHA-256
  `EC961792F6B5F6B649081B242272E39482ABC963BAF01AB8583C25F1C45310E7`.

One matched two-frame headless sample measured enabled mean renderer total
`7.05 ms` and disabled `6.90 ms`; final-frame totals were `2.20 ms` and
`1.90 ms`. This is a noisy measurement, not a performance claim. No
optimization was applied. Horizon work has a static eight-step maximum.

## Gates

| Gate | Result |
| --- | --- |
| Focused specimen/material tests | 13/13 GREEN |
| Complete rock/stone/specimen JavaScript cohort | 45/45 GREEN |
| Enabled/disabled geometry buffers | exact GREEN |
| Repeat overhead capture bytes | exact GREEN |
| Real WebGPU proof | 4/4 GREEN, 1318 x 777 |
| Runtime/provider/init/WGPU errors | 0/0/0/0 |
| Physics | 0 |

## Captures

- Overhead: `060-weathered-granite-granular-overhead.png`, 505,785 bytes,
  SHA-256
  `EC961792F6B5F6B649081B242272E39482ABC963BAF01AB8583C25F1C45310E7`.
- Left grazing: `060-weathered-granite-granular-left.png`, 306,979 bytes,
  SHA-256
  `A15EEEE94CAC9FC3AB21FA1B3DFD3C674CF88623B7E1E11C560106235522A96A`.
- Right grazing: `060-weathered-granite-granular-right.png`, 481,405 bytes,
  SHA-256
  `3A7B971987E9829AFE0A204C4CE6894580516575F3815E7B4E6F496BFDD46A0F`.
- Matched left-light microshadow-disabled baseline:
  `060-weathered-granite-granular-disabled.png`, 363,687 bytes, SHA-256
  `EB434BC8D2568210F2F747CA31AC9D5BF29A8E2B7244B9B996B7ACE5D7CBFC8F`.
