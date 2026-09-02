# MAT070F: wood polarization GPU consumption

Status: private 0.6 GPU-consumption tracer. No public VKF syntax, material
property, schema, ABI, diagnostic, compiler lowering, or gallery changed.

## Observable GPU tracer

The compute shader consumes the exact `wood-polarization-gpu:v1` f32 buffer
from MAT070E. One invocation reads one wavelength record and emits two
`vec4<f32>` values:

```text
reflected_rgb.r, reflected_rgb.g, reflected_rgb.b, reflected_stokes.I
reflected_stokes.Q, reflected_stokes.U, reflected_stokes.V,
  absorbed_intensity
```

The output therefore keeps the complete reflected Stokes state beside an
observable RGB value and its absorption term. The CPU fixture reads the same
input bytes, produces the expected f32 output, and verifies GPU readback with a
`1e-6` absolute tolerance.

This tracer intentionally does not freeze production spectral colorimetry.
Visible wavelengths use the generated base color scaled by reflected
intensity. Wavelengths outside 380--780 nm produce zero RGB while their Stokes
and absorbed-energy lanes remain available. A later researched color-matching
packet can replace this debug RGB observation without changing the record.

## Physical invariants

For every spectral record:

```text
I >= 0
sqrt(Q^2 + U^2 + V^2) <= I
I + absorbed = incident intensity
```

The fixture rejects non-physical source records. The readback verifier checks
byte-layout parity, finite outputs, Stokes physicality, and preservation of the
source energy total.

## TDD and hardware evidence

RED 1: the requested WGSL consumer exports did not exist.

RED 2: the off-screen fixture did not exist.

The first hidden WebGPU compilation then found a real shader error:

```text
'meta' is a reserved keyword
```

Renaming that local to `spectral_meta` produced the hardware GREEN result:

```json
{"outcome":"pass","detail":"3 spectral records matched",
 "records":3,"maxAbsoluteError":0,
 "roughness":0.6901960968971252,"infraredRgb":[0,0,0]}
```

The fixture ran through `run_headless_webgpu_fixture.cjs` with headless Edge;
no visible browser or application window was opened.

Focused Node evidence:

```text
node --test tests/js/vf-wood-polarization-sample.test.mjs
4 passed, 0 failed
```

Relevant regression:

```text
25 passed, 0 failed
```

The regression covers MAT070F, MAT070E/D/C, wood cut material and energy, and
the established rock GPU descriptor/parity seam.

## Acceptance-gate impact

The generated wood sample now crosses an actual off-screen WebGPU compute
pipeline and returns byte-layout-correct RGB, Stokes, and energy evidence.
Conservative estimated 0.6.0 completion is **49.5%**, up **0.4 percentage
points** from MAT070E's 49.1%. Main renderer consumption, compiler wiring,
researched spectral color conversion, and released-scene evidence remain open.
