# MAT010C measured leaf-species conditioning

Date: 2026-09-03

## Scope

This private packet conditions the calibrated MAT-010A leaf spectrum on nine
measured tree species. It changes no VKF syntax, public API, renderer,
compiler, UI, schema, or ABI.

Only leaf species is admitted in this bounded packet. The available evidence
does not isolate geological class, asphalt wetness, wood anatomy or moisture,
or leaf age without confounding support or inaccessible raw measurements.
Those effects remain explicit gaps rather than guessed generator parameters.

## Source and reproducibility

The measurements come from the University of Reading Research Data Archive:

- dataset: <https://doi.org/10.17864/1947.231>
- artifact:
  [Leaf_reflectance_nine_species.xlsx](https://researchdata.reading.ac.uk/231/7/Leaf_reflectance_nine_species.xlsx)
- artifact SHA-256:
  `0F840434030A9CA50B13063861C2A81D924AC85A0AF2245E0464079D87A35EAF`
- version: Deng 2019; University of Reading dataset 1947.231
- license: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

The source reports laboratory leaf-reflectance spectra from 400 to 2500 nm
for nine named species. Each species mean represents 5–10 sampled trees with
ten leaves per tree. The workbook also reports a spectral standard mean error
for every species and wavelength.

For each 450, 550, and 650 nm band, the fit is the arithmetic mean of the five
source rows nearest that center:

| Band | Source wavelengths, nm |
| --- | --- |
| 450 | 447.0, 448.5, 450.0, 451.5, 453.1 |
| 550 | 546.6, 548.1, 549.6, 551.0, 552.5 |
| 650 | 646.5, 647.9, 649.3, 650.7, 652.1 |

The workbook is not stored in the repository. Its exact hash, artifact URL,
fit method, named species, fitted values, and limitations are versioned in the
private contract.

## Conditioned distribution

The nine measured species means are averaged per band. Each species receives
one cross-band factor:

```text
species_factor[band] = species_mean[band] / nine_species_mean[band]
```

The factors have arithmetic mean one per band, so applying them around the
existing calibrated leaf preset does not move that preset's center. Cross-band
species identity is preserved; RGB channels are never sampled independently.

The measured nine-species means are:

| Band | Reflectance |
| --- | ---: |
| 450 nm | 0.04062333531388643 |
| 550 nm | 0.08778172572721032 |
| 650 nm | 0.03529003238276197 |

The unbiased standard deviations of the species factors are:

| Band | Between-species standard deviation |
| --- | ---: |
| 450 nm | 0.12947850145892933 |
| 550 nm | 0.31543361392212416 |
| 650 nm | 0.20324489607510890 |

The RMS source-reported relative mean errors are retained separately:

| Band | RMS relative reported mean error |
| --- | ---: |
| 450 nm | 0.02237184874793727 |
| 550 nm | 0.03017611342870816 |
| 650 nm | 0.03914050014857703 |

These reported errors are uncertainty metadata. They are not sampled as
procedural population variation and do not alter generator output.

## Private generator consumption

The private canopy adapter applies a selected species factor to foliage only.
It retains the existing individual and local-surface hierarchy as a relative
modulation around the calibrated spectral center. It does not change bark,
roughness, reflectivity, geometry, developmental identity, or residency.

The species selection is explicit. An unknown species is rejected instead of
being mapped modulo nine or silently approximated. The measured support is
healthy sampled UK urban-tree leaves; it is not an age, moisture, seasonal,
canopy-BRDF, or universal species prior.

## Executable evidence

The RED compile failed before the two private contracts existed:

```text
fatal error: 'native/material/vf_leaf_species_conditioned_distribution.hpp'
file not found
```

The focused strict test passes with:

```text
conditioned leaf species: species=9
source_sha=0F840434030A9CA50B13063861C2A81D924AC85A0AF2245E0464079D87A35EAF
uncertainty_sampled=false
```

It proves exact species coverage, hash-pinned provenance, mean-one factors,
exact source-fit reconstruction, independently retained uncertainty,
explicit generator consumption, foliage-only scope, passive energy,
traversal-order independence, duplicate rejection, and unsupported-species
rejection.

The complete strict native material suite passes `63/63` with C++20,
`-Wall -Wextra -Werror -pedantic`.
