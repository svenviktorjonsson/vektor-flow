# MAT070I: wood spectral presentation mapping

Status: private 0.6 presentation tracer. No public VKF syntax, material
property, schema, ABI, diagnostic, compiler lowering, renderer, or gallery
changed.

## Linear-light boundary

The spectral material path retains `unclippedLinearRgb` as its lighting value.
The presentation adapter copies that value unchanged into `linearHdrRgb`.
Exposure and tone mapping operate on a separate presentation branch only.
Negative CIE out-of-gamut components become zero at that boundary, never in
the spectral lighting result.

Exposure is linear-light multiplication by `2 ** exposureStops`, bounded to
the explicit range -16 through 16 stops. Input HDR magnitude is bounded to
`1e12` per channel, which keeps the entire operation finite.

The tone operator is a peak-channel Reinhard map. It computes one mapped peak
and one scale for all three channels:

```text
display_peak = peak / (1 + peak)
display_rgb = exposed_rgb * display_peak / peak
```

One common scale preserves positive-channel ratios, so neutral colors remain
neutral and hue does not drift. The peak target is capped at the largest
representable double below one. This avoids the observed floating-point edge
where an extreme finite highlight rounded to exactly `1.0`.

## TDD evidence

RED 1:

```text
ERR_MODULE_NOT_FOUND:
  web/vf-ui/vf-wood-polarization-presentation.mjs
```

RED 2 found a numeric edge:

```text
1e12 at +16 stops mapped to exactly 1.0
```

GREEN uses the bounded display peak and proves monotonic exposure, neutral
axis preservation, exact positive-channel ratios, finite extreme highlights,
and unchanged source HDR.

Off-screen WebGPU GREEN:

```json
{"outcome":"pass","records":3,"maxAbsoluteError":0,
 "linearHdrRgb":[0.2869574148,0.1844956818,0.0552520860],
 "displayLinearRgb":[0.3646416050,0.2344417606,0.0702097533],
 "maxSampleEnergyError":2.9802322388e-8}
```

The fixture ran in headless Edge with no visible window. The established
Windows temporary-profile cleanup again deferred one locked directory after
successful evidence; GPU and test results were unaffected.

Relevant MAT070 regression evidence is recorded after the spectral-color,
absorbing-Fresnel, rough-GGX, wood GPU, and presentation tests pass together:

```text
18 passed, 0 failed
```

## Acceptance-gate impact

The private generated-material tracer now preserves linear HDR through
lighting and applies bounded display mapping only after GPU-backed spectral
integration. Conservative estimated 0.6.0 completion is **50.5%**, up **0.3
percentage points** from MAT070H's 50.2%. Main-renderer consumption, compiler
wiring, user-selected display policy, and released-scene capture evidence
remain open.
