# VKF world-class hybrid renderer roadmap

Status: accepted product direction and internal architecture plan. Public VKF
material and quality-control spelling remains subject to the Language Design
Authority workflow.

## Goal

Build a graphics engine that keeps VKF applications responsive while producing
high-quality physically coherent images across WebGPU and native GPU targets.
The renderer automatically chooses the cheapest technique that meets a measured
image-error bound. Authors describe the world, materials, lights, and views;
they do not manually assemble passes or parallel work.

The practical reference is Unreal Engine's hybrid strategy rather than any one
Unreal feature: rasterize primary visibility, virtualize work at screen-space
granularity, reuse results over time, and reserve ray tracing for effects that
cannot be reconstructed reliably from cheaper information.

This roadmap must not make the 0.4 useful-UI release wait for a complete game
engine. It strengthens the existing renderer behind retained contracts. The
0.5 self-hosting program later migrates proven target-independent policy and
material semantics into VKF without changing behavior. The
[0.6 procedural material and geometry release](0.6.0.md) then builds researched,
demand-generated natural objects and surfaces on this renderer foundation.

## Architecture decision

VKF uses one scene truth and several interchangeable estimators:

```text
retained World / View / Layer arenas
              |
      visibility + dirty regions
              |
      budgeted render task graph
       /        |         \
 raster/SS   cached/probe   ray query
       \        |         /
       one material/light model
              |
 temporal reconstruction + presentation
```

The estimators do not add independent lighting terms. They estimate the same
material response and are selected or blended with explicit confidence. This
prevents screen-space reflection, mirror capture, environment reflection, and
ray tracing from double-counting specular energy.

### Rendering paths

| Need | Default | Escalation | Fallback |
|---|---|---|---|
| Opaque visibility | GPU rasterization | virtual mesh clusters | conventional indexed mesh |
| Opaque shading | compact deferred G-buffer | specialized forward material | deterministic error material |
| Transparency/UI/MSAA | clustered forward | ordered per-pixel transparency | stable sorted transparency |
| Direct lighting | clustered/tiled evaluation | stochastic many-light samples | bounded deterministic light list |
| Detailed shadows | cached shared atlas | virtual pages or ray query | conventional shadow maps |
| Reflections | screen trace with confidence | exact planar task or ray query | parallax-corrected probe/environment |
| Diffuse GI | probes/surface cache | sparse software or hardware tracing | baked/static environment |
| Display resolution | temporal reconstruction | native-resolution quality mode | spatial upscale |
| Correctness oracle | progressive path tracer | more samples/bounces | deterministic raster scenes |

WebGPU has no portable ray-tracing pipeline today. Its ray path therefore uses
compute-shader BVH traversal. Native adapters may use hardware ray queries, but
both consume the same scene, material, light, and test contracts.

## Core invariants

1. One geometry truth feeds rasterization, shadows, picking, reflection,
   lighting, physics embeddings, and the reference renderer.
2. One physically based material IR compiles into deferred, forward, probe,
   ray-query, and path-traced forms.
3. Mirror reflection is the sharp low-roughness limit of the same energy-
   conserving specular response, not an extra light-model term.
4. Every expensive effect has a confidence measure, finite work budget,
   temporal invalidation rule, and deterministic fallback.
5. Policy may reduce estimator cost, samples, internal resolution, or update
   frequency; it must not silently change world state or material meaning.
6. Quality claims require a reference image and real GPU measurements. A
   synthetic frame-rate estimate is planning evidence only.
7. Native and browser targets compare semantic buffers exactly and rendered
   output within a versioned tolerance.

## Materials

Start with one compact metallic/roughness physically based model: linear base
color and opacity, metallic, perceptual roughness, dielectric index of
refraction, normal, emissive radiance, and ambient occlusion. Transmission and
clear coat follow only after cross-path parity exists.

Grass, stone, wood, glass, and metals are data/procedural packages built on this
model, not renderer-special cases. A material compiler produces shared closures
for every rendering path and explicitly rejects unsupported target features.
Arbitrary layered BSDF graphs come after the compact model passes energy,
parity, and performance gates.

## Mirrors, reflections, and caustics

The current per-surface target and full scene pass cannot scale to thousands of
visible mirrors. Replace it incrementally with:

1. A packed mirror-facet arena containing stable geometry IDs, planes,
   material parameters, adjacency, bounds, revisions, and a BVH.
2. Exact merging of connected coplanar facets into one aperture and one
   reflected off-axis camera.
3. A shared reflection atlas, revision-derived cache keys, temporal reuse, and
   fixed pixel/task budgets.
4. Error-based levels of detail: exact capture for important planar mirrors,
   per-pixel rays for important curved mirrors, parallax-corrected probes for
   small/distant/rough mirrors, and environment data below the threshold.
5. An iterative reflection-path task graph for multiple bounces instead of
   recursively allocating targets.

A fisheye, cubemap, or octahedral probe is useful shared capture data, but it
cannot make differently oriented nearby faces exact because their reflected
camera origins differ. Hard creases retain physically correct discontinuities.
Smooth surfaces interpolate geometry/normals and evaluate a reflected ray per
shaded sample.

Interactive reflection work terminates on maximum bounce/task/pixel budget,
subpixel projected contribution, exposure-adjusted path throughput below the
perceptual threshold, or no visible receiver. Perfect opposing mirrors still
need a finite budget. Reference mode uses Russian roulette after a minimum
depth rather than relying solely on a hard energy cutoff.

Caustics, including solkatter, are sampled light paths rather than duplicated
virtual lights for every mirror/light/bounce combination. First-bounce specular
paths receive priority. A light hierarchy and temporal/spatial reservoirs later
select important emissive geometry and mirror apertures under a fixed samples-
per-pixel budget.

## Lighting, shadows, geometry, and resolution

The first scalable lighting path is clustered direct lighting: predictable,
portable to WebGPU, and already required by the 0.4 Gate 3 plan. Arbitrary
emissive geometry becomes bounded patches in a two-level hierarchy, never one
host object per vertex.

Stochastic direct lighting follows only after the deterministic path and image
oracle are green. It trades bounded time for increasing noise as overlapping
lighting complexity grows. The deterministic path remains for low light counts,
directional lights, debugging, and weaker devices.

Shadows progress from a shared cached atlas to virtual pages. Moving lights,
deformation, displacement, and camera cuts invalidate only dependent tiles.
Ray-query shadows graduate when measured cost or area-light quality is better.

Virtual geometry is a later optimization. Meshes become immutable clusters with
conservative bounds and geometric error; GPU culling selects clusters at the
current pixel threshold. Conventional meshes remain required for unsupported
or pathological content.

Temporal reconstruction is an architectural multiplier. Expensive effects run
at a lower dynamic internal resolution using correct motion, depth, and reactive
data. Camera cuts, disocclusion, transparency, animated textures, and rapidly
changing lighting explicitly reject stale history.

## Render task graph and automatic policy

Every pass declares resources, dirty regions, dependencies, queue eligibility,
timestamp slots, and a fallback. The graph performs pass culling, transient
resource aliasing, batched submission, and cache lifetime management. Async
compute is never assumed beneficial; it graduates only after A/B evidence on
each supported GPU tier.

The automatic policy observes GPU frame time, transient memory, queue pressure,
camera motion, projected error, temporal confidence, and capabilities. Its
decisions are deterministic, replayable, and inspectable.

## Quality and performance evidence

### Reference scenes

| Scene | Primary risk |
|---|---|
| White furnace plus dielectric/metal spheres | energy and material parity |
| Cornell box with emissive geometry | direct/indirect transport |
| Mirror corridor | recursion and temporal stability |
| 4,096 coplanar mirror tiles | exact clustering and capture reuse |
| 4,096 faceted mirrors | atlas pressure and bounded work |
| 10,000 local/area lights | selection, shadows, and denoising |
| Dense interior and open world | cache coverage and far-field fallback |
| Foliage/alpha and thin geometry | overdraw and temporal artifacts |
| Animated/skinned/displaced geometry | motion and acceleration updates |
| Chess/world reference application | shipped integration and picking |
| Heavy graphics plus rapid UI events | input-to-present responsiveness |

Every scene pins viewport, camera path, fixed time, random seed, exposure,
color space, device profile, and source/artifact hashes.

### Correctness gates

- Exact topology, material, light, transform, visibility, and pick buffers.
- Linear-HDR and final-image comparison with per-scene thresholds; no aggregate
  score may hide a failure.
- Camera-motion, cut, disocclusion, thin-feature, and still-history sequences.
- Native/WebGPU semantic parity with recorded capability differences.
- Energy tests proving combined estimators do not exceed the material response.

### Performance gates

- CPU/GPU frame and pass timings: median, p95, and p99.
- Input-to-present latency and missed presentations.
- Peak tracked persistent/transient GPU bytes, uploads, and allocation churn.
- Visible clusters, reflection tasks/pixels, shadow pages, rays/samples, cache
  hits, and history rejection.
- Shader/pipeline compilation time and first-use stutter.
- Paired parent/release samples and independent verification under ADR 0010.

Initial scene-specific contracts include:

- 4,096 connected coplanar mirror tiles produce exactly one stable cluster and
  one capture; shuffled input produces the same IDs.
- 4,096 faceted mirrors schedule at most 32 captures, at most 16,777,216
  reflection pixels, and at most 256 MiB tracked reflection allocations.
- Opposing mirrors remain finite with at most 64 tasks and depth 8 in the
  interactive profile, including reflectivity one.
- The 10,000-light scene performs no per-pixel traversal of all 10,000 lights;
  its candidate/reservoir storage stays proportional to the declared pixel
  budget.
- Under graphics load, event-to-state p95 stays at or below 8 ms,
  input-to-present p95 at or below 33.3 ms, and no event reorders.

Hardware time budgets graduate only after the exact GPU profiles and confidence
method are frozen. An unavailable timestamp-query feature marks a performance
row unsupported; it is never replaced by an FPS guess.

No optimization is accepted from frame rate alone. It must pass the same
oracle, do comparable work, beat a predeclared target with confidence, and keep
a rollback path. Async compute, stochastic sampling, denoising, cache changes,
and ray reductions are always A/B tested across the scene matrix.

## Delivery sequence

### GFX-000 — real renderer evidence foundation

- Add real browser/WebGPU input-to-present evidence while retaining the
  synthetic estimator as engineering-only evidence.
- Add pass timestamps/counters, tracked allocations, fixed camera paths,
  deterministic captures, and a versioned scene manifest.
- Baseline chess/world, mirrors, shadows, grass, and materials before changing
  image production.

### GFX-010 — clustered 0.4 lighting foundation

- Replace fixed small light uniforms with clustered storage-buffer light lists.
- Keep a bounded deterministic fallback and preserve existing images first.
- Establish arbitrary emissive-patch hierarchy records without adding a public
  light scene or target-specific VKF API.

### GFX-020 — material truth and reference oracle

- Freeze the internal compact PBR IR and add white-furnace/material tests.
- Compile it through raster and a small progressive reference integrator.
- Remove mirror/specular/reflection double counting exposed by energy tests.

### GFX-030 — render graph, shadow atlas, and temporal foundation

- Add explicit pass/resource dependencies and transient lifetime tracking.
- Add shared cached shadow tiles and deterministic invalidation.
- Add motion/depth/reactive histories, TAA, and dynamic internal resolution.

### GFX-040 — hybrid reflections and mirror scale

- Add coplanar clustering, reflection atlas scheduling, and cache reuse.
- Add screen-trace confidence and probe fallback.
- Add budgeted multi-bounce tasks and then compute-BVH curved reflection.
- Gate the faceted-mirror scenes on bounded memory/work and reference error.

### GFX-050 — many lights, GI, and caustics

- Evaluate stochastic direct lighting against clustered lighting.
- Add sparse surface lighting cache and broad-hardware scene tracing.
- Add first-bounce mirror/emissive caustic sampling and reservoirs.
- Add native hardware tracing only where it improves a measured row.

### GFX-060 — virtualized geometry and shadow pages

- Add mesh cluster construction, GPU culling, screen-error LOD, streaming, and
  occlusion.
- Add virtual shadow pages where the shared atlas has demonstrated the need.
- Preserve conventional paths and explicitly test foliage, overlap,
  deformation, and acceleration-build cost.

### GFX-070 — world-class graduation

- Run the complete matrix across frozen WebGPU and native GPU tiers.
- Graduate stable per-scene quality/performance ratchets.
- Publish only renderer-produced captures and reproducible measurements.
- Keep the progressive path tracer as the image oracle rather than the default
  interactive renderer.

## First clean work packets

1. **040-G00 render evidence:** add internal surface-pass, allocated-pixel,
   shadow draw/cache-hit, and active-light counters plus real capture metadata;
   current images must remain unchanged.
2. **040-G01 clustered lights:** add target-independent cluster assignment and
   bounded light-list tests, then a storage-buffer shader consumer. This closes
   a documented 0.4 Gate 3 gap.
3. **040-G02 reflection planner:** pure tests for canonical facets, connected
   coplanar clustering, frustum/backface/projected-pixel scoring, stable cache
   keys, and bounded scheduling.
4. **040-G03 reflection atlas:** allocate/reuse shared targets and route exact
   one-bounce planar mirrors through them without changing camera/clip results.
5. **040-G04 material energy RED:** add white-furnace and mirror/specular
   overlap failures before changing the current shader.

These packets change no public VKF syntax or API. Any later material property,
quality control, diagnostic, or capability name requires a compact decision
packet before implementation.

## Primary references

- [Epic: Lumen technical details](https://dev.epicgames.com/documentation/unreal-engine/lumen-technical-details-in-unreal-engine)
- [Epic: Lumen performance guide](https://dev.epicgames.com/documentation/unreal-engine/lumen-performance-guide-for-unreal-engine)
- [Epic: Nanite virtualized geometry](https://dev.epicgames.com/documentation/en-us/unreal-engine/nanite-virtualized-geometry-in-unreal-engine)
- [Epic: Virtual Shadow Maps](https://dev.epicgames.com/documentation/en-us/unreal-engine/virtual-shadow-maps-in-unreal-engine)
- [Epic: Temporal Super Resolution](https://dev.epicgames.com/documentation/en-us/unreal-engine/temporal-super-resolution-in-unreal-engine)
- [Epic: MegaLights](https://dev.epicgames.com/documentation/en-us/unreal-engine/megalights-in-unreal-engine)
- [Epic: physically based materials](https://dev.epicgames.com/documentation/en-us/unreal-engine/physically-based-materials-in-unreal-engine)
- [Epic: Render Dependency Graph](https://dev.epicgames.com/documentation/en-us/unreal-engine/render-dependency-graph-in-unreal-engine)
- [Epic: path tracer](https://dev.epicgames.com/documentation/en-us/unreal-engine/path-tracer-in-unreal-engine)
- [Nanite SIGGRAPH 2021](https://advances.realtimerendering.com/s2021/Karis_Nanite_SIGGRAPH_Advances_2021_final.pdf)
- [Lumen SIGGRAPH 2022](https://advances.realtimerendering.com/s2022/SIGGRAPH2022-Advances-Lumen-Wright%20et%20al.pdf)
- [MegaLights SIGGRAPH 2025](https://advances.realtimerendering.com/s2025/content/MegaLights_Stochastic_Direct_Lighting_2025.pdf)
- [PBRT: a better path tracer](https://pbr-book.org/4ed/Light_Transport_I_Surface_Reflection/A_Better_Path_Tracer)
- [WebGPU](https://www.w3.org/TR/webgpu/)
