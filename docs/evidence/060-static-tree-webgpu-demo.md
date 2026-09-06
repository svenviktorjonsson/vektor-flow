# Deterministic static tree WebGPU demonstration

Date: 2026-09-06. Base: `e2c498a948c8f2c35604030e5c1075c3b237bd16`.
Branch: `pre-gen`.

## Scope

This packet adds a private adapter and fixture that carry one tree through the
existing deterministic forest population, tree geometry, tree material, and
retained renderer-packet chain into the existing real WebGPU dynamic geometry
renderer. It changes no VKF source syntax, public constructor, schema, ABI,
default, or diagnostic.

The selected deterministic tree has one tapered trunk, four tapered branches,
one crown envelope, sixteen branch foliage clusters, and exact bark/foliage
material colors and roughness from its retained packet. The adapter converts
that source into separate lit wood and foliage `field_mesh` packets. The crown
and clusters contain 960 deterministic, double-sided leaf cards. Exact output
is 3,926 vertices and 11,976 indices under explicit 4,096-vertex and
16,384-index demo budgets. The adapter itself rejects budgets above 65,536
vertices or 393,216 indices and reserves against a shared aggregate before
allocation.

This is an honest procedural low-poly static tree demonstration, not a
photoreal scanned asset. It uses no raster stand-in, JavaScript canvas fallback,
animation loop, wind, or physics.

## RED to GREEN

The focused suite recorded these RED states:

- 0/1: the WebGPU tree adapter module did not exist.
- 2/3: the static WebGPU tree fixture did not exist.
- 2/3: the trunk adapter treated its documented center transform as an endpoint.
- 2/3: the crown primitive was not represented by leaf geometry.
- 2/3: requested leaf density was not present.
- 2/3: roughness was mapped to excessive generic-renderer specular strength.

GREEN adds deterministic bounded meshing, center-correct trunk geometry,
complete crown and cluster leaf geometry, dielectric tree specular scaling,
the full-chain fixture, and explicit replay/incomplete-packet/budget tests.

## Gates

| Gate | Result |
| --- | --- |
| Focused tree WebGPU tests | 3/3 GREEN |
| All tree/forest JavaScript tests | 24/24 GREEN |
| Headless Edge real WebGPU capture | GREEN |
| `git diff --check` | GREEN |

Headless Edge initialized WebGPU at 1,263 by 760 with two renderer parts and
two active clustered lights. Initialization failures, provider errors, runtime
errors, and WebGPU errors were empty. Both parts reported no physics runtime;
the physics profile reported zero particles and zero steps. The captured
141,430-byte PNG has SHA-256
`CD2976C1BC7E49A68185CA7A5B8451869C1BB13C432F746572ED504F985CDA62`.
It was visually inspected for a fully framed trunk, visible branching crown,
dense green leaf canopy, differentiated bark/foliage shading, and useful
camera/light placement. The generated PNG remains ignored build evidence at
`build/tree-webgpu-static-demo.png`.

Reproduce:

```text
node --test tests/js/vf-tree-webgpu-packets.test.mjs
node tests/helpers/capture_mirror_scene.js tests/fixtures/tree-webgpu-static-smoke.html build/tree-webgpu-static-demo.png 0 9364 tree_webgpu_static_frame
```

## Static review boundary

This packet stops at the requested static review gate. It does not add branch
elasticity, leaf motion, wind response, or any physics coupling. Those remain a
separate later phase requiring explicit approval after visual review.
