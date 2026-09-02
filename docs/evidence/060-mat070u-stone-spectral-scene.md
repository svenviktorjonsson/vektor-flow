# MAT070U: procedural stone spectral scene

Status: private 0.6 released-material tracer. No public VKF syntax, public
material API, schema, ABI, diagnostic, shared compiler behavior, shared 0.4.1
renderer/runtime, rabbit example, or gallery changed.

## Actual geometry and material path

MAT070U begins from the existing closed ellipsoid-octahedron stone, retained
triangle packet, and conditioned geology/weathering field. The field displaces
the actual vertices and coherently varies base color, tangent normal, and
roughness before the scene adapter runs.

The scene adapter projects the three-dimensional closed stone from a fixed
camera, sorts opaque faces back-to-front for the off-screen target, and reuses
the established 64-byte spectral/GGX fragment record. Isotropic stone
roughness becomes `alpha_x = alpha_y = roughness^2`; the generated world normal
is transformed into the camera basis. The same fragment path therefore
evaluates spectral reflected/absorbed energy, normal response, GGX distribution,
Smith masking-shadowing, Fresnel, and bounded diffuse response.

Until a versioned measured stone spectrum is selected, the private adapter
uses the stone's bounded reference luminance as a neutral three-wavelength
reflectance and retains base-color chroma in the existing PBR field. It does
not invent wavelength-dependent stone absorption data.

One six-vertex, eight-face stone produced these deterministic distribution
spans:

```text
base color:    0.20520976185798645
roughness:     0.11056965589523315
displacement:  0.05203277803957462
```

The scene inherits the 65,536-vertex hard limit. At 64 bytes per retained
spectral vertex, its declared maximum geometry record is 4,194,304 bytes.

## TDD and hidden WebGPU evidence

RED failed because no stone-to-spectral-scene adapter existed. GREEN pins the
closed source geometry, exact triangle count, material-distribution spans,
passive spectral lanes, bounded record, deterministic repeat, and reuse of the
spectral/GGX shader functions.

Focused stone/rock and relevant spectral, GGX, energy, renderer, and capture
regression:

```text
36 passed, 0 failed
```

Two independent hidden Edge/WebGPU runs returned the same captured scene:

```json
{"kind":"procedural-material-scene-capture:v1",
 "width":64,
 "height":64,
 "byteLength":3525,
 "renderedPixels":1292,
 "foregroundColorCount":112,
 "repeatMatched":true}
```

Repeated SHA-256:

`2dbcccc1325d2be0960a041ceaeecbc023a6a1d957c2f1527f34c85cef5d262b`

The prior wood capture remained byte-identical during the same runs.

## Acceptance-gate impact

This is the first private released-material capture after wood to use the
spectral, passive-energy, normal, and GGX fragment path on existing closed
procedural geometry. It advances MAT-040's closed stone and correlated PBR
acceptance gate but does not close the stone-family release story.

The conservative estimated 0.6.0 completion is **56.6%**, up **0.7 percentage
points** from MAT070T's 55.9%. Adaptive refinement in this released capture,
hundreds-of-stones frame/memory evidence, approved shared-compiler integration,
and the complete tree/forest/road released scene remain open.
