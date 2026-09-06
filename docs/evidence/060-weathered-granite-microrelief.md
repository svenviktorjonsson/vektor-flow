# Weathered granite shader microrelief

Date: 2026-09-06. Base: `a3ee955895f19aefdc45e165ad8483d1e1d14f49`.
Branch: `pre-gen`.

## Scope

This private material variant adds deterministic high-frequency granite relief
without subdividing or changing specimen geometry. Three footprint-filtered
height bands drive a finite-gradient tangent normal, bounded spatial roughness,
and an eight-step maximum horizon march toward the primary light. Horizon
occlusion fades at normal incidence, zero macro incidence, and unresolved pixel
footprints. It attenuates direct/specular light above the existing ambient floor;
albedo contains no baked lighting.

The baseline, microrelief, and microshadow-disabled descriptors use the same
conditioned geology stream. No VKF syntax, public API, renderer fallback,
geometry allocation, motion, or physics was added.

## RED to GREEN

RED failed because the microrelief reference and material variants did not
exist. The first shader GREEN compiled but visual QA rejected horizon masking
that darkened ambient and produced macro-scale black blotches. The corrected
shader preserves ambient, gates horizon work by macro incidence, and confines
occlusion to direct/specular response. The final four captures were inspected at
native resolution: overhead relief is readable, left/right grazing highlights
reverse, and fine self-shadow breakup is absent from the matched disabled view.

## Exact evidence

- Geometry baseline and enabled: 2,594 vertices, 5,184 triangles.
- Vertex SHA-256, both:
  `DA19BB6E922638D29AA966E180E9F8C7E09B3DC5DA16C55C03F8C4E9DC1B712B`.
- Index SHA-256, both:
  `979D57B1FCA84DEA356D02DF49A30A6F95785120C06AABDBCBD85F791EE6266E`.
- Pinned 48 x 48 probe: left/right grazing shadowed fractions
  `0.17708333333333334` / `0.1970486111111111`; overhead/disabled `0` / `0`.
- High-frequency lighting energy: overhead `0.05571725859386064`, left
  `0.07019786057434953`, right `0.0746542336376742`, disabled
  `0.026771954286267528`.
- Maximum tangent slope `0.14107404174738666`; roughness range
  `[0.5622526525889087, 0.8191866399559175]`; normal-length error below `1e-6`.
- Footprint-filtered distant probe energy is below 45% of the close probe.
- Same overhead capture repeated byte-identically, SHA-256
  `3DC91D664DD03611421682FC2B1D493C72A34EED10C05657D09F5F08625180F2`.

Before optimization, a matched two-frame capture sample measured enabled mean
renderer total `12.25 ms` versus microshadow-disabled `8.95 ms` (about 37%
higher). This is a noisy headless measurement, not a performance claim; no
optimization was applied. Shader horizon work is statically bounded at eight
steps, each sampling three footprint-filtered bands.

## Gates

| Gate | Result |
| --- | --- |
| Focused specimen/microrelief tests | 6/6 GREEN |
| Complete rock/stone/specimen JavaScript cohort | 43/43 GREEN |
| Geometry buffers/count baseline equality | exact GREEN |
| Repeat overhead capture byte equality | exact GREEN |
| Real WebGPU four-view proof | 4/4 GREEN, 1318 x 777 |
| Runtime/provider/init/WGPU errors | 0/0/0/0 |
| `git diff --check` | GREEN |
| Physics | 0 |

## Captures

- Overhead: `060-weathered-granite-microrelief-overhead.png`, 367,846 bytes,
  SHA-256
  `3DC91D664DD03611421682FC2B1D493C72A34EED10C05657D09F5F08625180F2`.
- Left grazing: `060-weathered-granite-microrelief-left.png`, 333,608 bytes,
  SHA-256
  `92C1ABA7C8179111C619DA71629D52CD5856C60F8A79F628FD0EF9E2E7792655`.
- Right grazing: `060-weathered-granite-microrelief-right.png`, 315,007 bytes,
  SHA-256
  `C99095CB795013031B0522D5CA0DEEB33E3F5F73B0085AC868BC82D8D0F1B055`.
- Matched left-light microshadow-disabled baseline:
  `060-weathered-granite-microrelief-disabled.png`, 337,520 bytes, SHA-256
  `155D4B1B7E2DECBF10DAF35F0B9907D47D992D51FE91AD976059B98B42C143DD`.
