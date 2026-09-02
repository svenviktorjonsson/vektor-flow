# MAT070K: wood spectral renderer-packet integration

Status: private 0.6 procedural-material renderer tracer. No public VKF syntax,
material property, schema, ABI, diagnostic, compiler lowering, shared 0.4.1
renderer, runtime, rabbit example, or gallery changed.

## Retained renderer seam

The existing `wood-cut-material-triangle-packet:v1` is the authoritative 0.6
procedural wood renderer packet. MAT070K adds a private adapter that returns a
frozen retained packet with one sidecar:

```text
wood_spectral_presentation_gpu:
  wood-spectral-presentation-gpu:v1
```

All geometry, index, material, normal, roughness, tangent-frame, and GGX typed
arrays retain their original identity. The adapter validates both records and
requires the spectral descriptor's polarized source sample to reference the
same procedural material as the triangle packet. A descriptor from a different
wood material is rejected before upload.

The triangle packet remains independent of the shared 0.4.1 renderer. This is
the private production-facing seam through which a later 0.6 renderer upload
can acquire the versioned descriptor without changing author syntax.

## TDD and GPU evidence

RED:

```text
SyntaxError: vf-wood-material-renderer-packet.mjs does not provide
  attachWoodSpectralPresentationGpuReference
```

GREEN proves retained array identity, exact sidecar identity, eight complete
triangle faces, same-material validation, and the existing descriptor byte
schema.

The off-screen fixture now obtains its GPU input from
`rendererPacket.wood_spectral_presentation_gpu`, not the unattached local
descriptor. Headless WebGPU evidence:

```json
{"outcome":"pass","records":3,"rendererTriangleCount":8,
 "bundledBytes":1456,
 "bundledMaxAbsoluteError":1.4901161194e-7,
 "linearHdrRgb":[0.2869574148,0.1844956818,0.0552520860],
 "displayLinearRgb":[0.3646416050,0.2344417606,0.0702097533]}
```

The fixture ran in headless Edge with no visible window. The established
Windows temporary-profile cleanup deferred a locked directory after successful
GPU evidence; parity was unaffected.

Relevant regression evidence is recorded after the full wood renderer-packet
suite and MAT070 spectral/polarization suites pass together:

```text
36 passed, 0 failed
```

## Acceptance-gate impact

The researched spectral/polarized descriptor now belongs to an actual retained
0.6 procedural-material renderer packet and crosses WebGPU from that packet.
Conservative estimated 0.6.0 completion is **51.3%**, up **0.4 percentage
points** from MAT070J's 50.9%. Shared renderer buffer lifetime, draw-pipeline
binding, compiler consumption, and released-scene captures remain open.
