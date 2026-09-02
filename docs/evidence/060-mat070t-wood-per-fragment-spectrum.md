# MAT070T: wood per-fragment spectral record

Status: private 0.6 procedural-material tracer. No public VKF syntax, public
material API, schema, ABI, diagnostic, shared compiler behavior, shared 0.4.1
renderer/runtime, rabbit example, or gallery changed.

## Spectral geometry transport

The actual lit wood geometry now carries three reflected and three absorbed
spectral intensities per vertex. Their wavelengths remain in one aligned scene
record because all vertices share the same bounded wavelength basis. The
private vertex layout grows from 40 to 64 bytes:

```text
ndc_xy, base_rgb, normal_xyz, alpha_xy,
reflected_450_600_850, absorbed_450_600_850
```

Every generated endpoint satisfies `reflected + absorbed = 1`. Linear
interpolation therefore preserves the same passive-energy partition at every
fragment. A shader-side passive scale also bounds small interpolation error.
The 850 nm lane is retained in the fragment record but excluded from visible
display scaling by the explicit 380 through 780 nm visibility test.

The existing per-fragment normal and anisotropic GGX response remains in the
same shader path. The fragment's visible spectral ratio now scales the
presentation record before the final display mapping.

The existing 65,536-vertex hard bound limits this expanded spectral geometry
record to 4,194,304 bytes. No material-wide wavelength array is copied per
fragment and no unbounded spectral loop was introduced.

## TDD and hidden WebGPU evidence

RED pinned a 64-byte vertex record, passive reflected/absorbed lanes, wavelength
uniforms, and shader consumption. It failed against the former 40-byte record.
GREEN adds the minimum private record and matching WebGPU vertex attributes.

Focused and related spectral, polarization, renderer, scheduler, capture, and
material-energy regression:

```text
55 passed, 0 failed
```

Two independent hidden Edge/WebGPU runs produced the same actual-geometry
capture:

```json
{"outcome":"pass",
 "records":3,
 "rendererTriangleCount":8,
 "rendererCapture":{
   "width":64,
   "height":64,
   "byteLength":3136,
   "renderedPixels":2704,
   "foregroundColorCount":74,
   "repeatMatched":true}}
```

Repeated SHA-256:

`e261e5293c8cfb0625f833cdf2422724856ae81fd00cb49c5c7250f4f3ff8ef4`

The retained infrared integral remains `22.923976945877076`; infrared RGB is
`[0, 0, 0]`. Maximum source spectral energy error remains
`2.9802322387695312e-8`.

## Acceptance-gate impact

The private generated-wood scene now closes the sample-to-fragment spectral
transport gap while retaining its actual geometry, correlated material fields,
angular roughness, normal response, passive energy, and reproducible capture.
The conservative estimated 0.6.0 completion is **55.9%**, up **0.6 percentage
points** from MAT070S's 55.3%.

The private scene currently fixes the bounded fragment basis at three sampled
wavelengths. Approved shared-compiler integration and complete released
stone/tree/forest/road scenes remain open.
