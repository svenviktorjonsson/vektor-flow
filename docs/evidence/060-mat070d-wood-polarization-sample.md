# MAT070D: generated wood polarization sample

Status: private 0.6 integration evidence. No public VKF syntax, constructor,
material property, schema, ABI, diagnostic, compiler lowering, or shader
changed.

## Observable tracer

One selected sample follows the existing production-facing reference path:

```text
forest -> tree geometry -> wood growth/volume -> cut surface -> material
       -> local normal + roughness -> wavelength-aware GGX Mueller transport
```

The adapter reads the generated material packet's filtered normal, perceptual
roughness, and base color. It converts the geometric incidence cosine to the
sample's local incidence cosine, then supplies that local truth to the bounded
spectral transport. Optical constants remain explicit measured input; the
adapter does not invent a spectrum from RGB.

The transport function is a private injected dependency. The reference test
uses the MAT070C GGX Mueller transport. A later compiler/GPU packet can provide
the production implementation without changing procedural material truth or
creating a test-to-production import.

## Bounds and invariants

- Exactly one requested material sample is evaluated.
- Wavelength demand is explicit and capped at 64 samples.
- Microfacet demand retains MAT070C's hard 4096-sample maximum.
- Identical material truth and request produce identical spectral samples.
- Generated roughness depolarizes a fully polarized incident state.
- Each wavelength retains nonnegative reflected and absorbed intensity.
- Reflected plus absorbed intensity equals incident intensity.

## TDD evidence

RED:

```text
node --test tests/js/vf-wood-polarization-sample.test.mjs
ERR_MODULE_NOT_FOUND: vf-wood-polarization-sample.mjs
```

GREEN:

```text
node --test tests/js/vf-wood-polarization-sample.test.mjs
1 passed, 0 failed
```

Relevant regression:

```text
node --test \
  tests/js/vf-wood-polarization-sample.test.mjs \
  tests/js/vf-rough-polarization-transport.test.mjs \
  tests/js/vf-wood-cut-material-packet.test.mjs \
  tests/js/vf-wood-material-energy.test.mjs
17 passed, 0 failed
```

## Acceptance-gate impact

This closes one real procedural-material-to-spectral-transport seam rather
than adding another isolated optical oracle. Conservative estimated 0.6.0
completion is **48.8%**, up **0.3 percentage points** from MAT070C's 48.5%.
The gain remains small because compiler/WGSL integration, complete generators,
and the released acceptance scene are still open.
