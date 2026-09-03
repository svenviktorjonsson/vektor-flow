# MAT010D measured stone-mineral conditioning

Date: 2026-09-03

## Scope

This private packet conditions the calibrated MAT-010A stone spectrum on
three measured dominant-mineral identities. It changes no VKF syntax, public
API, renderer, compiler, UI, schema, or ABI.

Asphalt wetness was evaluated first but did not pass the evidence gate. The
2024 laboratory paper reports that its raw data are available only on
request. The licensable PANGAEA artifact contains eleven dry asphalt
measurements but no wet asphalt pair. Image-classification datasets and
digitized plot curves would add uncontrolled illumination, viewing-angle, or
digitization uncertainty, so no asphalt-wetness parameter was inferred.

The bounded fallback is mineral composition. It is supported by exact CC0
spectra already pinned for MAT-000. The conditions are not mislabeled as
whole-rock geological classes.

## Source and reproducibility

All twelve records come from the official USGS Spectral Library Version 7:

- dataset: <https://doi.org/10.5066/F7RR1WDJ>
- documentation: <https://doi.org/10.3133/ds1035>
- license: CC0-1.0, documented by the
  [USGS release](https://www.usgs.gov/data/
  usgs-spectral-library-version-7-data)
- artifact: `ASCIIdata_splib07a.zip`
- artifact SHA-256:
  `D232645740869A82AAFCAD5839448C50B1DC72965CE042D1374F29B7A798A91C`

The three conditions use four ASDFRc measurements each:

- albite HS324, identified as plagioclase feldspar;
- microcline HS103, identified as alkali feldspar;
- hornblende HS177, identified as amphibole.

Every embedded member retains the archive-relative path and SHA-256 of its
exact source file. All use the archive's shared 2151-channel ASD wavelength
axis. The fit is the arithmetic mean of the five raw channels nearest each
450, 550, and 650 nm center:

| Band | Source wavelengths, micrometres |
| --- | --- |
| 450 nm | 0.448, 0.449, 0.450, 0.451, 0.452 |
| 550 nm | 0.548, 0.549, 0.550, 0.551, 0.552 |
| 650 nm | 0.648, 0.649, 0.650, 0.651, 0.652 |

## Conditioned hierarchy

Each condition first fits its four specimen-fraction measurements. A member
factor is the member spectrum divided by its condition mean. These factors
have arithmetic mean one per band. The condition means are then divided by
the three-condition mean, producing condition factors that also have
arithmetic mean one per band.

The measured condition means are:

| Condition | 450 nm | 550 nm | 650 nm |
| --- | ---: | ---: | ---: | ---: |
| Albite HS324 | 0.7363394260 | 0.7739678675 | 0.7816856180 |
| Microcline HS103 | 0.6441642100 | 0.7180007730 | 0.7380011945 |
| Hornblende HS177 | 0.0797571395 | 0.1040712925 | 0.1162327710 |

The unbiased within-condition standard deviations of member factors are:

| Condition | 450 nm | 550 nm | 650 nm |
| --- | ---: | ---: | ---: | ---: |
| Albite HS324 | 0.1112790345 | 0.1178527692 | 0.1377121690 |
| Microcline HS103 | 0.0860491990 | 0.0615255312 | 0.0559931915 |
| Hornblende HS177 | 0.4860085585 | 0.6828906991 | 0.7697664672 |

The separately retained RMS relative standard errors of the local fits are:

| Condition | 450 nm | 550 nm | 650 nm |
| --- | ---: | ---: | ---: | ---: |
| Albite HS324 | 0.0006268589 | 0.0002473106 | 0.0001460822 |
| Microcline HS103 | 0.0026735316 | 0.0004442565 | 0.0001478815 |
| Hornblende HS177 | 0.0017773993 | 0.0011609705 | 0.0005078045 |

Local fit error is never sampled as procedural variation. Cross-band member
identity is preserved instead of choosing unrelated RGB values.

## Private generator consumption

The stone-level condition is explicit. A deterministic hash of the existing
stone identity and condition selects one of the four measured specimen
fractions. Every later surface demand for that stone therefore shares the
same measured member; traversal order and surface tessellation do not change
composition.

The measured factor is applied around the calibrated stone spectrum while
retaining the established population, instance, and local surface hierarchy
as relative modulation. Only spectral reflectance and its RGB projection are
changed. Roughness, reflectivity, geometry, and local identity remain
unchanged because this evidence does not measure those effects. The adapter
depends only on the committed measured-preset layer; it does not import the
unfinished stone or road renderer stack.

Pure mineral specimen fractions are evidence for dominant composition, not
whole-rock lithology, mineral abundance, weathering, or a universal
geological-class prior. Asphalt wetness, wood anatomy and moisture, and leaf
age remain explicit evidence gaps.

## Executable evidence

The RED compile failed before the private contracts existed:

```text
fatal error: 'native/material/vf_stone_mineral_conditioned_distribution.hpp'
file not found
```

The focused strict test passes with:

```text
conditioned stone minerals: conditions=3 members=12
source_sha=D232645740869A82AAFCAD5839448C50B1DC72965CE042D1374F29B7A798A91C
fit_error_sampled=false
```

It proves exact source fits, hash-pinned provenance, two-level mean-one
conditioning, separate fit uncertainty, deterministic per-stone member
selection, traversal independence, generator consumption, passive energy,
spectral-to-RGB consistency, duplicate rejection, and unknown-condition
rejection.

The official ScienceBase artifact was independently downloaded again from
item `586e8c88e4b0f5ce109fccae`. Its 21,812,828 bytes have the catalogued MD5
`BFE74068D85811E52E5E07D017720A17` and the pinned SHA-256 above. Recomputing
from that archive reproduced all twelve entry hashes, visible-band means, and
local-fit standard errors exactly.

The complete current native material suite passes `64/64` with:

```text
clang++ -std=c++20 -O2 -Wall -Wextra -Werror -pedantic -I.
```
