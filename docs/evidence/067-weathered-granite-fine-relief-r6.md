# Weathered granite fine relief R6

Date: 2026-09-06. Base: `73d8c09a4a54a6a22aa851cfb5ede967ceb80670`.
Branch: `pre-gen`.

## Scope

R6 changes only the existing R5 conditioned isotropic micro-height octave. Its
wavelength is `0.0027`, filtered support is `0.0032`, signed amplitude is
`0.00030`, and its compact fourth-power peak uses threshold `0.12` and
amplitude `0.0011`. Macro/meso relief, granite mineral albedo, silhouette,
camera, and lighting remain unchanged. The finer scalar height still feeds the
existing finite-difference normals and bounded eight-step directional horizon.

No geometry, public VKF syntax, fallback renderer, motion, or physics was
added. No performance claim is made.

## RED to GREEN

RED added density, measured radius, tile uniformity, amplitude, and directional
reversal requirements. The first `0.00225` preview was rejected locally because
the renderer footprint attenuated it until the surface read smoother. The final
parameter-only correction uses the support and compact peak above. No new
placement algorithm or material architecture was introduced.

## Exact evidence

- Feature density relative to R5: `3.4375`.
- Measured median peak-radius ratio relative to R5: `0.43636363636363645`.
- Six-by-six tile density coefficient of variation: `0.21222940963506826`;
  empty-tile fraction: `0`.
- Maximum micro-height amplitude ratio relative to R5: `0.5614186462740173`.
- Left/right local shadow reversal fraction: `0.541748046875`.
- Placement remains `conditioned-isotropic-octave`; maximum horizon steps `8`.
- Geometry remains 2,594 vertices / 5,184 triangles and 238,600 bytes.
- Vertex SHA-256:
  `3EAAB3E69D572CFDDA5DD692B64AB551DD8CBF543400D0AE3AD42D498B02353B`.
- Index SHA-256:
  `979D57B1FCA84DEA356D02DF49A30A6F95785120C06AABDBCBD85F791EE6266E`.
- Repeat overhead capture is byte-identical.

## Gates

| Gate | Result |
| --- | --- |
| Complete rock/stone/granite JavaScript cohort | 48/48 GREEN |
| Density/radius/tile-uniformity/amplitude contract | GREEN |
| Enabled/disabled geometry | exact GREEN |
| Repeat overhead capture | byte-exact GREEN |
| Real WebGPU proof | 4/4 GREEN, 1318 x 777; zero runtime/WGPU errors |
| Physics | 0 |

## Captures

- Overhead: `066-weathered-granite-fine-overhead.png`, 794,325 bytes,
  SHA-256
  `55F715BAFDAEA9AF1FEA59122949FC70DD5BB337EEEC7C9CB33AE7E4FB543F31`.
- Left grazing: `066-weathered-granite-fine-left.png`, 658,219 bytes,
  SHA-256
  `E1027BF0EFA3AE8A3E22E0A7A68EA59BA33D634DEFB3BA8A409AE630330EB5F3`.
- Right grazing: `066-weathered-granite-fine-right.png`, 791,792 bytes,
  SHA-256
  `AFD903A553EFFB77E0E6450552809F437C1F51B582CB2114006E3AE2B63CB09B`.
- Phone close-up: `066-weathered-granite-fine-close.png`, 1,304,719 bytes,
  SHA-256
  `6F36AA0B0C7D181D355182EC0804007FC5CBB313FEB6CB96500D610594ED5363`.
