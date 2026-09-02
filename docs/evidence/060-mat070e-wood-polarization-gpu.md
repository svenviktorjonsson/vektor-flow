# MAT070E: wood polarization GPU record

Status: private 0.6 production tracer. No public VKF syntax, material property,
schema, ABI, diagnostic, compiler lowering, or shader changed.

## Missing arena field

The existing scene-local material arena resolves base color, alpha,
transparency, depth write, light model, and texture. It has no private field for
wavelength samples, Stokes vectors, spectral absorption, or the generated
roughness associated with those samples. Extending its author-facing material
shape in this packet would prematurely choose a public material API.

MAT070E therefore follows the existing private renderer-part descriptor seam
already used by procedural rock material. It retains part identity and geometry
while adding one opaque, versioned `wood_polarization_gpu` descriptor.

## Internal f32 layout

Descriptor kind: `wood-polarization-gpu:v1`.

```text
header vec4<f32>:
  base_color.r, base_color.g, base_color.b, generated_roughness

each spectral record, 2 * vec4<f32>:
  wavelength_nm, local_incidence_cosine, absorbed_intensity,
    degree_of_polarization
  reflected_stokes.I, reflected_stokes.Q,
    reflected_stokes.U, reflected_stokes.V
```

The descriptor stores one contiguous `Float32Array`, so it can be copied to a
GPU storage buffer without repacking. Repeated descriptors from identical
procedural truth have byte-identical f32 buffers. Source-to-buffer comparisons
use `Math.fround`, documenting the sole precision boundary.

Spectral records are explicitly budgeted from 1 through 64. MAT070E requests
three records and rejects a budget of two before buffer allocation.

## TDD evidence

RED:

```text
node --test tests/js/vf-wood-polarization-sample.test.mjs
ERR_MODULE_NOT_FOUND: vf-wood-polarization-gpu.mjs
```

GREEN:

```text
node --test tests/js/vf-wood-polarization-sample.test.mjs
2 passed, 0 failed
```

Relevant regression:

```text
node --test \
  tests/js/vf-wood-polarization-sample.test.mjs \
  tests/js/vf-rough-polarization-transport.test.mjs \
  tests/js/vf-wood-cut-material-packet.test.mjs \
  tests/js/vf-wood-material-energy.test.mjs \
  tests/js/vf-rock-material-gpu.test.mjs
23 passed, 0 failed
```

## Acceptance-gate impact

The generated wood polarization sample now reaches a versioned GPU-facing
buffer contract with deterministic f32 bytes. Conservative estimated 0.6.0
completion is **49.1%**, up **0.3 percentage points** from MAT070D's 48.8%.
Actual GPU upload, WGSL consumption, compiler wiring, and released-scene image
evidence remain open, so this packet does not claim end-to-end rendering.
