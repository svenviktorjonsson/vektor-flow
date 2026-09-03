# MAT010A researched preset bundles

Date: 2026-09-03

## Scope

This packet consumes the licensed MAT-000 visible-spectrum, optical-index,
and directional-road fits into four deterministic private preset bundles. It
changes no VKF syntax, public API, renderer, compiler, UI, schema, or ABI.

The bundles preserve measurement authority and error alongside fitted values.
They do not use fit residuals as procedural population variance. Measurement
error, model-collapse error, and natural variation are different quantities.

## Generated bundles

Every family receives its existing 450, 550, and 650 nm spectral-reflectance
fit, the 15-observation local RMSE and standard error, the exact source
artifact identity, license, measurement conditions, fit method, and generator
version.

- Stone adds the scalar calcite index fit with scope `constituent`. Its 5.55%
  collapse error remains attached, warning that one scalar loses calcite
  birefringence. It is not labeled as a whole-stone measurement.
- Road adds measured worn-asphalt albedo and energy-normalized Oren-Nayar
  roughness with weighted normalized RMSE 0.0298. The field is named
  `oren_nayar_roughness` and its semantic is `oren_nayar_diffuse`; no optical
  index or GGX roughness is inferred.
- Wood adds the cellulose optical-index fit with scope `constituent`. It is
  not labeled as a bulk wood, bark, moisture, or cut-plane measurement.
- Vegetation adds the PROSPECT index with scope `leaf_interior_model`. It is
  not labeled as measured leaf-surface roughness or a canopy BRDF.

Preset construction re-runs the deterministic MAT-000 fits rather than
duplicating their numerical output. Requesting families in reverse order and
then restoring canonical order produces exactly equal preset objects.

## Validation boundary

Validation requires measured spectral provenance, licenses, source versions,
fit method, conditions, uncertainty statements, 15 observations, passive
spectral values, and finite nonnegative fit errors.

Optical evidence must match the preset family and declared scope. The road
bundle rejects any constituent-index attachment. Directional values require
passive albedo, bounded Oren-Nayar roughness, nonnegative weighted normalized
RMSE, and the exact diffuse semantic.

These constraints make silent semantic conversions fail validation. A later
renderer adapter must explicitly choose how, or whether, to translate
Oren-Nayar diffuse roughness to a different shading model.

## Executable evidence

The RED compile failed before the private preset contract existed:

```text
fatal error: 'native/material/vf_material_researched_preset.hpp'
file not found
```

The focused strict test passed:

```text
researched material presets: families=4 spectral_observations=60
optical_observations=12
```

It proves exact calibrated values, provenance and uncertainty retention,
family-order independence, deterministic regeneration, semantic separation,
and rejection of invalid uncertainty or cross-family optical evidence.

The complete strict native material suite passed 61/61 with:

```text
clang++ -std=c++20 -O2 -Wall -Wextra -Werror -pedantic -I.
```

## Remaining MAT-010 work

These bundles provide calibrated centers, not measured natural population
distributions. The existing hierarchical generators still require a separate
and explicitly sourced policy for how geological class, asphalt condition,
wood anatomy and moisture, species, age, and surface state vary around them.
Renderer consumption also remains a separate integration gate and must not
erase the preserved parameter semantics.
