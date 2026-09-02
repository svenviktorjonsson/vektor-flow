# MAT070H: polarized wood spectral visible color

Status: private 0.6 end-to-end material tracer. No public VKF syntax,
material property, schema, ABI, diagnostic, compiler lowering, renderer, or
gallery changed.

## End-to-end seam

The existing generated wood sample supplies roughness and wavelength-specific
absorbing Fresnel/Stokes transport. Its versioned f32 GPU record crosses the
existing WGSL compute consumer. The new private adapter reads the reflected
Stokes intensity and absorbed intensity from GPU output, associates them with
the descriptor wavelengths, and sends those radiance records through the CIE
1931 visible-color integrator from MAT070G.

The result contains bounded linear RGB plus the physical unclipped color
evidence, reflected/absorbed/incident visible integrals, reflected/absorbed/
incident infrared integrals, and the maximum per-sample energy error. The CIE
conversion contributes no RGB for wavelengths outside 380--780 nm, while the
infrared radiance integrals retain that energy.

The adapter accepts at most the 64 records already enforced by the private GPU
descriptor. It rejects descriptor energy violations, GPU parity failures,
non-physical Stokes output, and fewer than two wavelength records.

## TDD evidence

RED:

```text
node --test --test-name-pattern="polarized wood GPU records integrate" \
  tests/js/vf-wood-polarization-sample.test.mjs
ERR_MODULE_NOT_FOUND: web/vf-ui/vf-wood-polarization-visible.mjs
```

Focused GREEN:

```text
5 passed, 0 failed
```

Off-screen WebGPU GREEN:

```json
{"outcome":"pass","records":3,"maxAbsoluteError":0,
 "linearRgb":[0.2869574148,0.1844956818,0.0552520860],
 "reflectedInfraredRadianceIntegral":22.9239769459,
 "maxSampleEnergyError":2.9802322388e-8}
```

The fixture used headless Edge and produced no visible browser or application
window. The existing temporary-profile cleanup reported a deferred Windows
file lock after the successful evidence result; it did not affect GPU parity
or test output.

Relevant MAT070 regression evidence is recorded after visible-color,
absorbing-Fresnel, rough-GGX, wood-generation, GPU-record, and GPU-consumer
tests pass together:

```text
17 passed, 0 failed
```

## Acceptance-gate impact

The researched color basis now consumes an actual generated rough wood sample
after its spectral polarization record has crossed WebGPU. Conservative
estimated 0.6.0 completion is **50.2%**, up **0.4 percentage points** from
MAT070G's 49.8%. Main-renderer consumption, compiler wiring, tone mapping, and
released-scene capture evidence remain open.
