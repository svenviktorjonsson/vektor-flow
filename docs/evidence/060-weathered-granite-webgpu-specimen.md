# Weathered granite WebGPU specimen

Date: 2026-09-06. Branch: `pre-gen`.

## Scope

This private static-review fixture realizes one conditioned fieldstone through
the existing `field_mesh` and real WebGPU material path. It adds no VKF syntax,
public constructor, schema, ABI, default, or diagnostic, and contains no motion
or physics.

The same geology identity conditions broad asymmetric form, six bounded
fracture/chip fields, fine erosion, mineral distribution, albedo, roughness,
normal relief, and displacement. The closed indexed mesh has a planar 72-vertex
support ring and no ellipsoid or sphere primitive. Its granite shader variant
uses continuous normalized local projection, footprint-filtered multi-scale
mineral grains, sparse veins and fissures, and preserves the older rock shader
variant unchanged.

## RED to GREEN

RED first failed because no weathered-granite specimen module existed. Initial
GREEN geometry passed numerical gates but visual QA rejected a pinched/faceted
cap and brown shadow-led material. A first per-fragment granite pass was also
rejected locally for a cylindrical UV seam, periodic bands, and an inverted
apex (`0.93h` below its final ring). The accepted local candidate uses denser
bounded rings, a corrected apex, continuous local material coordinates, and
sparse non-periodic fissure/vein fields.

## Deterministic geometry/material evidence

- 2,594 vertices; 5,184 triangles; 238,600 vector bytes (under 256 KiB).
- Every indexed edge has exactly two incident triangles; minimum triangle area
  is `0.0001873247657864388`; all values are finite.
- Minimum height is exactly zero; 72 planar support vertices; support radius
  `1.27274190586998`; projected center of mass lies inside support.
- Radial coefficient of variation `0.09182874286016397`; opposite-silhouette
  asymmetry `0.11767139679829014`.
- Maximum chip depth `0.13145888453582302`; maximum neighboring radial step
  `0.083772751222568`.
- Baked channel spans: albedo `0.7520108482120833`, roughness
  `0.26968860626220703`, normal perturbation `0.12326939907836906`, displacement
  `0.45373765764760016`; geology/roughness correlation `-0.4961089103560474`.
- Same seed is byte-identical; changed seed changes specimen bytes.
- GPU mineral detail is footprint-filtered; geometry and all realized channel
  arrays remain under the hard 256 KiB specimen budget.

## Gates

| Gate | Result |
| --- | --- |
| Focused specimen tests | 3/3 GREEN |
| Complete rock/stone JavaScript cohort | 37/37 GREEN |
| Full JavaScript suite | 662/681; 19 pre-existing R7 tree/wood RED |
| Real WebGPU captures | 3/3 GREEN, 1318 x 777 |
| Runtime/provider/init/WGPU errors | 0/0/0/0 |
| `git diff --check` | GREEN |
| Physics | 0 |

## Captures

- Full production-lit specimen: `060-weathered-granite-specimen-full.png`,
  382,928 bytes, SHA-256
  `78DE06D2CEBA8FC37FA36BC002270BF90E1F32FFDF4A4EB535309AEA68BB1323`.
- Side silhouette: `060-weathered-granite-specimen-side.png`, 358,156 bytes,
  SHA-256
  `F0C566BF3245AEB2774D1F8C8C655480C30A61E2A3488C62DFE3820EE02DF014`.
- Neutral material close-up: `060-weathered-granite-specimen-neutral.png`,
  715,750 bytes, SHA-256
  `ECD4384F152A1FB48EB880AA4AF991CBBB40103BE47CD7DEFE66C21A9CD887B6`.

All three were visually inspected at native resolution. The final candidate has
no UV seam, inverted apex, periodic banding, or shadow-only texture. The neutral
capture retains visible mineral, vein, fissure, roughness, and relief variation.
