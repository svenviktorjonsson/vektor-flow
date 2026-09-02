# MAT070G: spectral visible-color integration

Status: private 0.6 colorimetry tracer. No public VKF syntax, material
property, schema, ABI, diagnostic, compiler lowering, renderer, or gallery
changed.

## Standard basis and integration

The reference seam uses the CIE 1931 2-degree standard colorimetric observer.
Its 380--780 nm table is an exact 5 nm subset of the official 1 nm CIE data:

```text
dataset: CIE 1931 colour-matching functions, 2 degree observer
DOI: 10.25039/CIE.DS.xvudnb9b
source: https://files.cie.co.at/CIE_xyz_1931_2deg.csv
source MD5: 17cca777db64b17170f06f67ce9d3ab7
```

Input radiance is piecewise linear between strictly ascending wavelength
records. Trapezoidal integration multiplies it by x-bar, y-bar, and z-bar at
each 5 nm observer sample. XYZ is normalized so an equal-energy spectrum over
the represented visible interval has `Y = 1`.

XYZ converts to linear sRGB with the exact rational matrix published by W3C
CSS Color 4:

<https://www.w3.org/TR/css-color-4/#color-conversion-code>

The result retains unclipped XYZ and linear RGB as physical evidence. Separate
display-facing XYZ and linear RGB vectors are bounded to `[0, 1]`, and
`outOfGamut` reports whether either required clipping. This is a linear-light
conversion only: no transfer curve, tone mapping, or chromatic adaptation is
silently applied.

## Observable invariants

The focused tracer proves that:

- equal-energy visible radiance integrates to normalized `Y = 1`;
- a 440--460 nm band is blue-dominant in bounded linear RGB;
- all display-facing XYZ and linear RGB channels remain in `[0, 1]`;
- 850--900 nm radiance yields exactly zero visible XYZ/RGB while retaining its
  infrared radiance integral; and
- descending wavelength records and negative radiance are rejected.

## TDD evidence

RED:

```text
node --test tests/js/vf-spectral-visible-color.test.mjs
ERR_MODULE_NOT_FOUND: web/vf-ui/vf-spectral-visible-color.mjs
```

GREEN:

```text
node --test tests/js/vf-spectral-visible-color.test.mjs
1 passed, 0 failed
```

Relevant MAT070 regression:

```text
16 passed, 0 failed
```

That run covers visible color, polarized wood, the private GPU record and WGSL
consumer, and rough/absorbing spectral transport.

## Acceptance-gate impact

The private 0.6 transport path now has a researched spectral-to-visible seam
instead of a wavelength-range debug color. Conservative estimated 0.6.0
completion is **49.8%**, up **0.3 percentage points** from MAT070F's 49.5%.
Production renderer consumption, compiler wiring, full-resolution
color-matching integration, tone mapping, and released-scene evidence remain
open.
