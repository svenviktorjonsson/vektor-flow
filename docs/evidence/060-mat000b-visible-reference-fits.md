# MAT000B visible reference fits

Date: 2026-09-03

## Scope

This packet pins a small licensed subset of four official USGS spectra and
fits only the three spectral-reflectance values already used by the private
material contracts. It changes no VKF syntax, public API, renderer, compiler,
UI, schema, or ABI. The repository stores 60 scalar observations rather than
the complete source files.

The fit does not infer roughness, index of refraction, directional BRDF,
transmission, or an sRGB color. Those properties were not measured by these
source spectra.

## Sources and reproducibility

The source files are served by the official USGS Landsat Spectral
Characteristics Viewer. They are derived viewer spectra labeled `(USL)` and
associated with the cataloged USGS Spectral Library. They are not represented
as the original `splib07a` ASCII measurements.

All four source artifacts were downloaded byte-for-byte and hashed before the
subset was transcribed:

- Limestone: [USGS JSON][limestone], 160880 bytes.

  ```text
  8C55B82A8E077210481E8DE71229BC7FEA1D5B58B300F2719F3294161FFD8FD3
  ```

- Asphalt: [USGS JSON][asphalt], 176163 bytes.

  ```text
  BF00DA8297A6A3A8E09A27FA0A5FA1A976D3922C221DC34B565640D620EF4B93
  ```

- Cedar shake: [USGS JSON][cedar], 191219 bytes.

  ```text
  AA62720B9D820F7F374075F91C331356131F496AE2365B7054158C9EDBA9E08D
  ```

- Aspen leaf A: [USGS JSON][aspen], 36455 bytes.

  ```text
  BC738232B68CEDDCEA305A10CCDA2D91684C8E621065EBD857C412FAF2CBD92D
  ```

[limestone]: https://landsat.usgs.gov/landsat/spectral_viewer/c3-master/htdocs/data/spectra/SoilsMixturesLimestone.json
[asphalt]: https://landsat.usgs.gov/landsat/spectral_viewer/c3-master/htdocs/data/spectra/ArtificialMaterialsAsphalt.json
[cedar]: https://landsat.usgs.gov/landsat/spectral_viewer/c3-master/htdocs/data/spectra/ArtificialMaterialsCedarShake.json
[aspen]: https://landsat.usgs.gov/landsat/spectral_viewer/c3-master/htdocs/data/spectra/VegetationAspenLeafA.json

The parent USGS Version 7 release is CC0 1.0:

- Data DOI: <https://doi.org/10.5066/F7RR1WDJ>
- Version 7 report: <https://doi.org/10.3133/ds1035>
- Release and license:
  <https://www.usgs.gov/data/usgs-spectral-library-version-7-data>

## Deterministic subset and fit

For each material, five observations nearest each existing private channel
center at 450, 550, and 650 nm are pinned. The ordinary 5 nm viewer spectra
use center plus or minus 5 and 10 nm. Aspen uses the nearest five available
viewer samples because its wavelength grid is nonuniform.

Each channel is the least-squares constant fit, which is the arithmetic mean
of its five observations. RMSE reports the local residual dispersion;
standard error is `RMSE / sqrt(5)`. These quantities describe goodness of fit
for the pinned local samples. They are not instrument accuracy or complete
measurement uncertainty.

| Material | Reflectance at 450, 550, 650 nm | RMSE at 450, 550, 650 nm |
| --- | --- | --- |
| Limestone | 0.157600, 0.190800, 0.213600 | 0.002417, 0.002561, 0.001020 |
| Asphalt | 0.068809, 0.085595, 0.102651 | 0.001104, 0.001603, 0.000883 |
| Cedar shake | 0.065978, 0.090324, 0.104028 | 0.001710, 0.001675, 0.000444 |
| Aspen leaf A | 0.037380, 0.087000, 0.040040 | 0.000412, 0.000469, 0.000609 |

All normalized channel RMSE values are below 5%. The private base-color proxy
retains the existing field order by mapping 650, 550, and 450 nm into its
three elements. It is not a colorimetric conversion.

The fitter canonicalizes wavelength order, rejects duplicate wavelengths,
rejects non-passive or non-finite reflectance, and requires an HTTPS source
plus the exact uppercase SHA-256 identity. Reversing all source observations
produces bit-identical fit objects.

## Access boundary

The cataloged ACCP seedling-canopy files require NASA Earthdata
authentication. Anonymous retrieval returned the login page rather than the
measured tables. No canopy values were guessed or copied from secondary
sources. Its exact fit remains blocked until an authenticated, checksummed
import can be made under the cataloged NASA data policy.

## Executable evidence

The RED compile failed before the fit contract existed:

```text
fatal error: 'native/material/vf_material_reference_fit.hpp' file not found
```

The focused strict test then passed:

```text
material reference fits: subsets=4 observations=60
```

It pins exact means and RMSE, validates local uncertainty and normalized fit
quality, proves source-order independence, retains the current spectral and
base-color field order, and rejects an invalid negative measurement.

The complete strict native material suite passed 59/59 with:

```text
clang++ -std=c++20 -O2 -Wall -Wextra -Werror -pedantic -I.
```

## Remaining MAT-000 gates

The strongest next evidence is an exact, checksummed subset from the original
`splib07a` distribution and an authenticated ACCP canopy subset with its
reported per-band standard deviations. Separate measured datasets are still
required before fitting directional BRDF, roughness, transmission, or index
of refraction.
