# MAT070S: wood angular per-fragment response

Status: private 0.6 procedural-material lighting tracer. No public VKF syntax,
material property, schema, ABI, diagnostic, shared compiler behavior, shared
0.4.1 renderer/runtime, rabbit example, or gallery changed.

## Lit field transport

MAT070S extends the real geometry path with the generated tangent-space normal
and anisotropic GGX lobe at every retained wood vertex. The private 40-byte
vertex record is:

```text
ndc_x, ndc_y,
base_r, base_g, base_b,
normal_x, normal_y, normal_z,
alpha_x, alpha_y
```

The fragment shader interpolates and normalizes the generated surface normal,
constructs its local tangent basis, and evaluates one fixed private light/view
pair. `alpha_x` and `alpha_y` retain the packet's proven anisotropic roughness
instead of inventing a second roughness interpretation.

## Energy behavior

The CPU oracle and WGSL use the same response:

- anisotropic GGX normal distribution;
- Smith masking-shadowing;
- Schlick dielectric Fresnel with `F0 = 0.04`;
- Lambert diffuse weighted by `1 - Fresnel`; and
- the incident cosine applied once to outgoing radiance.

Fresnel and diffuse weights therefore partition exactly to one. A deterministic
2,048-direction hemispherical quadrature at `alpha_x = 0.35` and
`alpha_y = 0.2` measured white-furnace energy:

```text
0.99527741962103056
```

This remains below incoming unit energy. The existing anisotropic wood furnace,
dielectric partition, filtered-normal, and every end-grain/side-grain refinement
energy regression also remain green.

The result modulates only the display image. MAT070P continues to preserve the
unclipped spectral HDR metadata independently, so presentation clipping cannot
silently change the lighting-energy receipt.

## TDD and hidden WebGPU evidence

RED failed because the angular oracle and ten-lane field record did not exist.
GREEN pins the exact normal decode, alpha lanes, aligned light/view uniforms,
Fresnel split, and white-furnace bound.

The hidden Edge pass renders the same eight actual wood triangles. Generated
normal and roughness variation produces 46 foreground colors while the geometry
coverage remains exactly 2,704 pixels. Two independent hidden runs produced the
same image:

```json
{"outcome":"pass",
 "rendererTriangleCount":8,
 "rendererCapture":{
   "width":64,
   "height":64,
   "byteLength":2240,
   "renderedPixels":2704,
   "foregroundColorCount":46,
   "repeatMatched":true,
   "linearHdrRgb":[0.2869574148,0.1844956818,0.0552520860]}}
```

Repeated SHA-256:

`61cdb77ff8095bcae59f07e8b410f1a00c6e46e9b38da35dd1bfb0c38e6c6bfb`

The full related capture, spectral, polarized transport, renderer, scheduler,
lowering, material-energy, and lit-scene regression passed together:

```text
54 passed, 0 failed
```

## Acceptance-gate impact

The private 0.6 path now renders actual procedural color, normal, and
anisotropic roughness fields with a bounded energy-tested angular response.
The conservative estimated 0.6.0 completion is **55.3%**, up **0.7 percentage
points** from MAT070R's 54.6%. Spectral response still originates from one
sampled material record; per-fragment spectral sampling, approved
shared-compiler integration,
and the complete stone/tree/forest/road released scene remain open.
