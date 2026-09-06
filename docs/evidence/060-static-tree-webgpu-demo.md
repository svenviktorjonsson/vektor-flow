# Deterministic static tree WebGPU demonstration

Date: 2026-09-06. Base: `e2c498a948c8f2c35604030e5c1075c3b237bd16`.
Branch: `pre-gen`.

## Scope

This packet adds a private adapter and fixture that carry one tree through the
existing deterministic forest population, tree geometry, tree material, and
retained renderer-packet chain into the existing real WebGPU dynamic geometry
renderer. It changes no VKF source syntax, public constructor, schema, ABI,
default, or diagnostic.

The selected deterministic tree has 100 retained primitives: one tapered
trunk, one coarse crown envelope, eighteen structural branches, forty thin
twigs, and forty foliage clusters. Primary branches emerge at conditioned
positions and directions along the trunk. Secondary branches attach along
their parents with strict length and radius decay. Terminal and optional twig
shoots are thinner again. Optional twig probability is zero on the trunk, rare
on thick branches, and increases monotonically as parent radius falls. Every
foliage primitive has a twig parent, every twig terminates in one foliage
primitive, and no leaf attaches to trunk or structural branch.

The adapter converts that source into separate lit wood and foliage
`field_mesh` packets. Its 960 leaves are real pointed-ovate meshes rather than
four-vertex cards. Each leaf has a narrow four-vertex petiole, a rounded
five-station blade body, and a single sharp apex: sixteen vertices and twelve
double-sided nondegenerate triangles. Conditioned approximately-normal samples
control blade length and width, base roundness, asymmetry, petiole length,
camber, attachment, orientation, and color. Every parameter is clamped to a
physical finite interval. UVs parallel all emitted vertices.

Exact demo output is 16,150 vertices and 73,152 indices under explicit
32,768-vertex and 131,072-index budgets. A tree is hard bounded to 128 retained
primitives. The adapter rejects budgets above 65,536 vertices or 393,216
indices and reserves against a shared aggregate before allocation.

This is an honest procedural low-poly static tree demonstration, not a
photoreal scanned asset. It uses no raster stand-in, JavaScript canvas fallback,
animation loop, wind, or physics.

## RED to GREEN

The focused suite recorded these RED states:

- 0/1: the WebGPU tree adapter module did not exist.
- 2/3: the static WebGPU tree fixture did not exist.
- 2/3: the trunk adapter treated its documented center transform as an endpoint.
- 1/4: the former fixed-spoke planner had only four branches and no recursion.
- 4/5: optional and terminal twig identities collided, leaving a twig without
  a unique leaf child.
- 1/4: the former leaf adapter emitted four-vertex diamond cards and had no UV
  or conditioned leaf parameter stream.
- 2/3: roughness was mapped to excessive generic-renderer specular strength.

GREEN adds recursive deterministic structural branching, radius-conditioned
twig shoots, twig-only foliage topology, bounded pointed-ovate leaf meshing,
center-correct trunk geometry, dielectric tree specular scaling, and the
full-chain fixture. Tests prove parent linkage, strict child radius decrease,
bounded attachment and upward-biased directions, monotonic aggregate twig
frequency, terminal topology, deterministic replay, seed variation, finite
nondegenerate geometry, UV bounds, ovate outline shape, and centered bounded
leaf parameter statistics.

## Gates

| Gate | Result |
| --- | --- |
| Recursive tree geometry tests | 5/5 GREEN |
| Focused tree WebGPU tests | 4/4 GREEN |
| All tree/forest JavaScript tests | 27/27 GREEN |
| Headless Edge real WebGPU capture | GREEN |
| `git diff --check` | GREEN |

Headless Edge initialized WebGPU at 1,263 by 760 with two renderer parts and
two active clustered lights. Initialization failures, provider errors, runtime
errors, and WebGPU errors were empty. Both parts reported no physics runtime;
the physics profile reported zero particles and zero steps. The captured
116,926-byte PNG has SHA-256
`C394A10A87232C553A80567473156177D92AE9371C6074B84F78741E0DA67905`.
It was visually inspected for a fully framed coherent trunk base, visible
primary/secondary/twig hierarchy, pointed ovate leaf clusters supported only
by thin twigs, differentiated bark/foliage shading, and camera/light placement
derived from actual emitted mesh bounds. The generated PNG remains ignored build evidence at
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
