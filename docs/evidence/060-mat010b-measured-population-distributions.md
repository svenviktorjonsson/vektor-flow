# MAT010B measured population distributions

Date: 2026-09-03

## Scope

This packet adds private, measured spectral population shapes around the four
calibrated MAT-010A centers. It changes no VKF syntax, public API, renderer,
compiler, UI, schema, or ABI.

The packet does not equate fit residuals with population variation. Each of
18 source records contributes two separate quantities:

- its mean reflectance in the five raw channels nearest 450, 550, and 650 nm;
- the standard error of that local constant fit.

Between-record variation is fitted only from the first quantity. Local fit
error is retained independently as the root-mean-square relative standard
error.

## Source and reproducibility

All records come from the official USGS Spectral Library Version 7 data
release:

- dataset: <https://doi.org/10.5066/F7RR1WDJ>
- documentation: <https://doi.org/10.3133/ds1035>
- license: CC0-1.0, documented by the
  [USGS data release](https://www.usgs.gov/data/
  usgs-spectral-library-version-7-data)
- artifact: `ASCIIdata_splib07a.zip`
- artifact SHA-256:
  `D232645740869A82AAFCAD5839448C50B1DC72965CE042D1374F29B7A798A91C`

Every embedded member records the archive-relative file path and the
SHA-256 of that exact text entry. The wavelength axis is the archive's
`splib07a_Wavelengths_ASD_0.35-2.5_microns_2151_ch.txt` record. Invalid-band
sentinels are absent from all selected visible windows.

The bounded supports are:

- stone: four clinozoisite-epidote HS299 specimen records;
- road: one old road asphalt, three asphalt shingles, and one roof tar;
- wood: five cedar shake states from fresh through weathered or mossy;
- leaf: four Aspen surfaces spanning top, bottom, and yellowing states.

These are observed sample-series supports, not universal priors. In
particular, the road members are manufactured surfaces, the stone members do
not span geological classes, cedar weathering is not wood anatomy or
moisture, and Aspen state/surface is not species, age, or canopy BRDF. Those
limitations travel with each private distribution.

## Centered measured factors

For each spectral band, the arithmetic mean of the measured members is
computed first. Every empirical member becomes a multiplicative factor
`member / measured_mean`. The factors therefore have exact arithmetic mean
one and can be applied around the existing calibrated preset without moving
its center. This retains measured cross-band member identity instead of
sampling three unrelated scalar distributions.

The unbiased standard deviations of these factors are:

| Family | 450 nm | 550 nm | 650 nm |
| --- | ---: | ---: | ---: |
| Stone | 0.6897799221 | 0.7032529570 | 0.4985524085 |
| Road | 0.6979954312 | 0.6293560525 | 0.5641368530 |
| Wood | 0.2792103467 | 0.1595024368 | 0.3583780899 |
| Leaf | 0.6416275403 | 0.4052647500 | 0.6638371797 |

The separately retained RMS relative standard errors of the local fits are:

| Family | 450 nm | 550 nm | 650 nm |
| --- | ---: | ---: | ---: |
| Stone | 0.0028415406 | 0.0011787951 | 0.0013954383 |
| Road | 0.0015433096 | 0.0018784247 | 0.0004223581 |
| Wood | 0.0036494304 | 0.0034974075 | 0.0030051304 |
| Leaf | 0.0024483872 | 0.0023390464 | 0.0037705715 |

The orders-of-magnitude separation is evidence that local fit error was not
used as procedural population amplitude. It is not a claim that either
quantity is a complete instrument-error model.

## Executable evidence

The RED compile failed before the private population contract existed:

```text
fatal error: 'native/material/vf_material_population_distribution.hpp'
file not found
```

The focused strict test passes with:

```text
measured population distributions: families=4 members=18
fit-error-separate=true
```

It proves family coverage, exact member counts, hash-pinned provenance,
passive measured values, mean-one factors, exact member reconstruction,
independent fit-error aggregation, deterministic reverse traversal, and
duplicate-member rejection.

## Remaining MAT-010 work

These empirical factors can now drive the established keyed hierarchical
generators without inventing variance. Separate evidence is still needed for
geological-class conditioning, asphalt wear and wetness, wood anatomy and
moisture, and leaf species, age, and canopy support. Renderer consumption
remains a later integration gate and must preserve these limitations.
