# Weathered granite crystalline relief R5

Date: 2026-09-06. Base: `91cd06ea487e007873698a608d30530c4d76f61d`.
Branch: `pre-gen`.

## Scope

R5 preserves the R4 closed stone mesh and directional horizon-microshadow
path. It adds smaller irregular crystalline cells inside the smooth feldspar
and quartz domains, plus an independent filtered `0.0045`-scale scalar-height
band. That band participates in the same finite-difference normal and bounded
eight-step horizon evaluation as the meso relief. Sparse larger pits remain.
Bounded nondirectional cavity bounce keeps deep features readable.

No high-frequency geometry, public VKF syntax, fallback renderer, motion, or
physics was added. No performance claim is made.

## RED to GREEN

RED lacked crystalline edges, dense micro-height features, projected feature
metrics, and readable cavity bounds. An initial axis-cell render was rejected
locally for a checker pattern. A jittered Voronoi replacement removed the
grid, but its first weighting was also rejected locally as mosaic-dominant.
The final mix retains 55--58% smooth meso domains and bounds irregular
crystalline breakup to 42--45%. Full-size overhead, grazing, and close-up
captures were inspected: macro fracture, meso mineral domains/pits, and dense
fine relief remain separately readable without the rejected checker pattern.

## Exact evidence

- Pinned 64 x 64 mineral fractions: feldspar `0.4326171875`, quartz
  `0.2119140625`, mica `0.0361328125`.
- Crystal-edge fraction `0.1474609375`; mineral transition density
  `0.47371031746031744`; maximum horizontal mineral run `20`; fine-crystal
  fraction `0.57373046875`.
- Measured micro/meso peak-density ratio `4.032786885245901`.
- Measured half-height median projected radii: micro `0.0024609375`, meso
  `0.008203125` (ratio `0.3`).
- Micro-band left/right local shadow reversal `0.559814453125`; overhead
  shadow fraction `0.02783203125`; orientation-energy ratio
  `1.04886947133282`; maximum horizon steps `8`.
- Bounded cavity-bounce luminance `[0.16117871, 0.30293749673599996]`;
  roughness `[0.7, 0.8986274940385186]`.
- Geometry remains 2,594 vertices / 5,184 triangles and 238,600 bytes.
- Vertex SHA-256:
  `3EAAB3E69D572CFDDA5DD692B64AB551DD8CBF543400D0AE3AD42D498B02353B`.
- Index SHA-256:
  `979D57B1FCA84DEA356D02DF49A30A6F95785120C06AABDBCBD85F791EE6266E`.
- Repeat overhead capture is byte-identical.

## Gates

| Gate | Result |
| --- | --- |
| Complete rock/stone/granite JavaScript cohort | 47/47 GREEN |
| Angular cell + dense micro-height quantitative contract | GREEN |
| Enabled/disabled geometry | exact GREEN |
| Repeat overhead capture | byte-exact GREEN |
| Real WebGPU proof | 4/4 GREEN, 1318 x 777; zero runtime/WGPU errors |
| Physics | 0 |

## Captures

- Overhead: `064-weathered-granite-crystalline-overhead.png`, 816,868 bytes,
  SHA-256
  `B6A6804B116EC0F8AB031301163E670DA9B93262E3DCBE2CD054309D7CBF2D86`.
- Left grazing: `064-weathered-granite-crystalline-left.png`, 671,921 bytes,
  SHA-256
  `37F8057DD9B2D55A725CF61BD814D15C456AB5E39CA653B3FFE957435A4D6F72`.
- Right grazing: `064-weathered-granite-crystalline-right.png`, 806,449 bytes,
  SHA-256
  `3A5EA27F9EEAE9349752531A86EAAFB289BA6323F2A574DAE269387A597DBA06`.
- Phone-readable close-up: `064-weathered-granite-crystalline-close.png`,
  1,318,813 bytes, SHA-256
  `F0E5B1A56059EFB630BDCE146BA2A65AB6D49EAAB0D9F29EDD019B06BDB40957`.
