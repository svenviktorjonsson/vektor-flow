# MAT000C directional and optical fits

Date: 2026-09-03

## Scope

This packet pins the strongest legally redistributable directional and
optical evidence found for the four current material families. It changes no
VKF syntax, public API, renderer, compiler, UI, schema, or ABI. Only 12 derived
index observations and one published asphalt model-fit row are retained.

The evidence has deliberately different authority by family. The asphalt
entry is a fit to a measured road surface BRDF. Calcite and cellulose are
material constituents, not complete rough surfaces. The leaf index is an
optical constant fitted by PROSPECT from experimental leaf measurements.

## Road: measured directional BRDF

LUIS dataset version 1.0 measured a worn demolition-asphalt sample with a
gonioreflectometer at 1,264 angular configurations from 400 to 1030 nm. The
dataset is CC BY 4.0 and publishes AM1.5G-weighted BRDF, albedo, and fitted
reflection-model parameters:

- Dataset DOI: <https://doi.org/10.25835/aq5cdmx7>
- License: <https://creativecommons.org/licenses/by/4.0/>
- `reflection_model_parameters.csv`, 1131 bytes:

  ```text
  BE6C0BA5E8647980F8B41435729A7A4ACA39C2557B63B8B1311BD8091A29F321
  ```

- `materials.csv`, 2703 bytes:

  ```text
  5D38C02D0F955C1E0C0DF2BBE7F33144D48D30192046E691E5398024597DAAE9
  ```

The pinned asphalt row has albedo 0.1063, energy-normalized Oren-Nayar
roughness 0.2389, and weighted normalized RMSE 0.0298. The roughness remains
explicitly Oren-Nayar diffuse roughness. It must not silently become GGX or
another specular microfacet parameter.

This is one weathered sample rather than an asphalt-population distribution.
The published error is model-fit error, not instrument uncertainty.

## Stone: measured calcite index

The CC0 refractiveindex.info database release `v2025-02-23` records Ghosh's
measured ordinary and extraordinary calcite dispersion equations at room
temperature:

- Source DOI: <https://doi.org/10.1016/S0030-4018(99)00091-7>
- Database descriptor: <https://doi.org/10.1038/s41597-023-02898-2>
- Database license:
  <https://github.com/polyanskiy/refractiveindex.info-database/blob/v2025-02-23/LICENSE>
- `Ghosh-o.yml`, 591 bytes:

  ```text
  B7265EE3103905101E42F3CADC19F2A1BEEB06C71173891BD54514AE79C459EC
  ```

- `Ghosh-e.yml`, 595 bytes:

  ```text
  30A16E2BCE992F439A145B008645D35CDA861984F87E58E725124620D0133702
  ```

Both equations are evaluated at 450, 550, and 650 nm. The best constant scalar
fit is index 1.5755715943 and normal-incidence Fresnel F0 0.0499403350. Its
RMSE is 0.0874946616, or 5.55% normalized. This relatively large collapse
error is useful negative evidence: one scalar loses calcite birefringence.
Calcite is not claimed to represent every rock or a rough stone surface.

## Wood: measured cellulose index

The same CC0 database release records Polyanskiy's Sellmeier fit of Sultanova,
Kasarova, and Nikolov's measured cellulose optical-polymer data at 293 K:

- Source DOI: <https://doi.org/10.12693/APhysPolA.116.585>
- `Sultanova.yml`, 645 bytes:

  ```text
  2100346CBA95AA70A21712C1F86F17B84501F60B0D92A34013CB0F70178C391E
  ```

The 450, 550, and 650 nm scalar fit is index 1.4731017297, Fresnel F0
0.0365952829, and RMSE 0.0048855898, or 0.33% normalized. Cellulose is a wood
constituent; this does not measure bulk anatomical wood, bark, moisture,
cut-plane anisotropy, or surface roughness.

## Vegetation: fitted leaf-interior index

The MIT-licensed `prospect` package pins PROSPECT-PRO v2 optical constants.
The leaf refractive-index spectrum was fitted from experimental leaf
reflectance and transmittance, rather than measured as a directional surface
BRDF:

- Package paper: <https://doi.org/10.21105/joss.06027>
- Source commit: `0df0f4fa6dab1ca659e3c72b52800bf470503733`
- License:
  <https://github.com/jbferet/prospect/blob/0df0f4fa6dab1ca659e3c72b52800bf470503733/LICENSE>
- `dataSpec_PRO_v2.txt`, 226390 bytes:

  ```text
  0D60AB4D67A9FC96424C6098B88C4F22CDF36FA16BB694FF434AE064B87D8419
  ```

The pinned indices are 1.4955, 1.4739, and 1.4473 at 450, 550, and 650 nm.
Their scalar fit is 1.4722333333, Fresnel F0 0.0364866813, and RMSE
0.0197128272, or 1.34% normalized. PROSPECT publishes no per-wavelength
scalar uncertainty for this field. The fit is not a leaf-surface roughness,
species distribution, or directional canopy BRDF.

## Deterministic fitting and validation

The private fitter evaluates pinned Sellmeier-2 equations, canonicalizes
source and wavelength order, and derives the least-squares constant index,
local RMSE, local standard error, normalized RMSE, and normal-incidence
Fresnel F0. Reversing every calcite observation produces a bit-identical fit.

Artifact identities require HTTPS and uppercase SHA-256. Fits reject missing
provenance fields, out-of-range or singular equations, non-finite values,
duplicate observations, non-passive albedo, and roughness outside `[0, 1]`.

The RED compile failed before the private fit contract existed:

```text
fatal error: 'native/material/vf_material_directional_reference_fit.hpp'
file not found
```

The focused strict test passed:

```text
directional optical references: families=4 index_observations=12
brdf_directions=1264
```

The complete strict native material suite passed 60/60 with:

```text
clang++ -std=c++20 -O2 -Wall -Wextra -Werror -pedantic -I.
```

## Remaining evidence boundary

Only the road entry currently supplies a legally downloadable measured
directional surface BRDF and published model error. NIST documents NEFDS
measurements for asphalt and wood, but the public project pages do not expose
redistributable numeric records or explicit dataset terms. Bonn SVBRDF data
is free for research, not licensed for unrestricted redistribution.

No unavailable records were copied and no roughness or IOR was invented.
Further production calibration requires redistributable measured directional
stone, wood, and leaf-surface data, plus population variance and stated
instrument uncertainty. The scalar calcite warning also shows why a later
spectral/polarized contract must retain anisotropy rather than overwrite it
with one index.
