# MAT000A material reference manifest

Date: 2026-09-03

## Scope

This packet adds a private, versioned provenance catalog for measured optical
references. It changes no VKF syntax, public API, renderer, compiler, UI,
schema, or ABI. No source dataset or other bulky asset is vendored.

The manifest deliberately does not convert reflectance spectra into invented
roughness, index of refraction, or a complete BRDF. Every entry records what is
measured, how it was measured, its uncertainty statement, and what a later fit
must not claim.

## Sources and licensing

Four material domains are covered by five entries:

- Stone uses USGS Version 7 `splib07a` under CC0 1.0. Usable fields
  are sample identity, wavelength, FWHM, and spectral reflectance.
- Road/asphalt uses the same release and license. Usable fields are material
  identity, wavelength, FWHM, and spectral reflectance.
- Bark/wood uses the same release and license. Usable fields are plant or
  material identity, wavelength, FWHM, and spectral reflectance.
- Leaf/vegetation uses the same release and license. Usable fields are
  measurement level, wavelength, FWHM, and spectral reflectance.
- Canopy uses ACCP Seedling Canopy Reflectance Version 1 under the NASA Earth
  Science Data and Information Policy. Usable fields are wavelength,
  reflectance, Douglas-fir standard deviation, treatment, and canopy-density
  class.

USGS data and documentation:

- Data DOI: <https://doi.org/10.5066/F7RR1WDJ>
- Version 7 report: <https://doi.org/10.3133/ds1035>
- Data release and CC0 declaration:
  <https://www.usgs.gov/data/usgs-spectral-library-version-7-data>
- The original measured library is `splib07a`; its ASCII release retains
  wavelength positions and channel FWHM. The official catalog covers rocks,
  minerals, artificial materials, leaves, bark, vegetation plots, and airborne
  forest observations.

NASA/ORNL canopy data and documentation:

- Dataset DOI and Version 1 landing record:
  <https://doi.org/10.3334/ORNLDAAC/423>
- Measurement guide:
  <https://daac.ornl.gov/ACCP/guides/S_can_sp.html>
- Dataset metadata license URL:
  <https://science.nasa.gov/earth-science/earth-science-data/data-information-policy>
- Douglas-fir and bigleaf maple seedling canopies were measured from roughly
  400 to 2500 nm under natural sunlight. The guide records instruments,
  calibration, repeated rotations, per-band Douglas-fir standard deviations,
  approximate GER signal-to-noise, smoothing, and maple wind noise.

## Uncertainty discipline

USGS Version 7 has no honest library-wide scalar uncertainty. Consumers must
retain each spectrum's instrument, measurement geometry, sample/purity
metadata, measured channel FWHM, artifact notes, and invalid-band sentinels.

The ACCP canopy dataset supplies per-band standard deviation for Douglas-fir.
Its guide reports GER signal-to-noise of about 100 from 800 to 1100 nm and
about 20 over 450 to 700 nm and longer near infrared. No scalar accuracy is
claimed. The manifest also records that its controlled seedlings are not a
measured mature-forest BRDF.

## Executable evidence

The RED compile failed because the manifest header did not exist:

```text
fatal error: 'native/material/vf_material_reference_manifest.hpp'
file not found
```

The focused strict test then passed:

```text
material reference manifest v1: entries=5 domains=4
```

It proves exact domain coverage, manifest version, measured classification,
explicit no-fit status, unique stable identities, and rejection of missing
license, license URL, uncertainty, measured fields, or limitations.

The complete strict native material suite passed 58/58 with:

```text
clang++ -std=c++20 -O2 -Wall -Wextra -Werror -pedantic -I.
```

## Remaining MAT-000 gates

This catalog makes source selection and legal/measurement limitations
executable. It does not download or fit values. Remaining MAT-000 work is to
pin exact sample subsets, fit versioned generator parameters, publish
goodness-of-fit and uncertainty reports, and add directional BRDF/roughness,
transmission, and IOR measurements where spectral reflectance is insufficient.
