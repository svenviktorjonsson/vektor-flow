# Procedural rock WebGPU demonstration

Date: 2026-09-06. Base: `1169c3bc364177570a47f13fb1d068b2f3dffba6`.
Branch: `pre-gen`.

## Scope

The existing `rock-renderer-packet-smoke.html` fixture now passes its retained
coarse and refined geometry packets through the existing procedural rock
material adapter before submitting them to the existing dynamic geometry
renderer. This is a private demonstration fixture. It changes no VKF source
syntax, public constructor, schema, ABI, default, or diagnostic.

The fixture uses these existing internal reference APIs:

- `createCoarseEllipsoidReference`
- `updateEllipsoidRefinementWorkingSetReference`
- `adaptEllipsoidWorkingSetToRetainedGeometryPacketsReference`
- `createRockMaterialFieldReference`
- `adaptRockMaterialToRendererPacketReference`

The renderer receives three `field_mesh` parts: one six-vertex/eight-face coarse
octahedral ellipsoid and two four-vertex/three-face refinements. Every part now
carries `rock-geology-weathering:v1` channels and a
`rock-geology-weathering-gpu:v1` descriptor.

The real WebGPU receiver evaluates the existing filtered geology field per
fragment and uses its base color, tangent normal, and roughness-derived specular
scale. The material adapter also applies its bounded displacement to packet
vertices. This does not claim a researched whole-rock lithology, a polished
final asset, a public `rock` language primitive, or tree rendering.

## RED to GREEN

The focused renderer-packet suite first failed 5/6 because the fixture did not
reference `createRockMaterialFieldReference` or
`adaptRockMaterialToRendererPacketReference` and still submitted the original
constant-color geometry packets.

GREEN wires the existing material field and adapter into the same fixture,
submits only the resulting material packets, and publishes diagnostic evidence
for channel kind plus nonzero base-color, roughness, and displacement spans.
No production renderer or material implementation changed.

## Gates

| Gate | Result |
| --- | --- |
| Focused renderer/material/cache tests | 15/15 GREEN |
| All rock/stone JavaScript tests | 36/36 GREEN |
| All tree/forest JavaScript tests, unchanged | 21/21 GREEN |
| Headless Edge real WebGPU capture | GREEN |
| `git diff --check` | GREEN |

Headless capture initialized WebGPU at 1236 by 725 with no initialization,
provider, runtime, or WebGPU errors. Renderer retained three parts and allocated
rock material buffers of 144, 96, and 96 bytes. The captured 61,360-byte PNG
has SHA-256
`9491E2620FDF31D245705E2983D3D05F0323DFDB69E9BB28A94C455D7279BFE9`.
It was visually inspected as a lit, deliberately low-poly ellipsoidal rock.
The generated PNG remains ignored build evidence.

Reproduce:

```text
node --test tests/js/vf-rock-renderer-packets.test.mjs tests/js/vf-rock-material-field.test.mjs tests/js/vf-rock-material-packet-cache.test.mjs
node tests/helpers/capture_mirror_scene.js tests/fixtures/rock-renderer-packet-smoke.html build/procedural-rock-webgpu-demo.png 0 9364 rock_renderer_packet_frame
```

## Tree boundary

Tree/forest code currently provides conditioned populations, coarse-to-fine
primitive plans, bark/foliage material working sets, retained tree packets,
camera demand, and bounded packet caches. Native producer packets provide a
coarse trunk and canopy with direct material offsets. No existing browser
fixture submits those tree packet shapes to a real renderer. The preserved
combined native scene-frame test remains RED because its implementation header
is absent and sparse producer bindings do not define unsampled-surface shading
or interpolation. This packet does not invent that contract.
