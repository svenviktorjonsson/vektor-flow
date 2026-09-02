# MAT070V: adaptive procedural-stone materialization

Status: private 0.6 CPU-only stone tracer. No public VKF syntax, public material
API, schema, ABI, diagnostic, shared compiler behavior, shared 0.4.1 runtime,
browser process, WebGPU workload, rabbit example, or gallery changed.

## Coarse-first projected demand

The private scene coordinator immediately materializes the existing closed
coarse stone and its correlated geology/weathering material. It allocates no
detail until a camera projection exceeds the requested pixel-error threshold.

Each update composes the existing deterministic components in one bounded path:

1. projected ellipsoid view demand and silhouette priority;
2. one-level refinement working-set selection;
3. stable retained geometry packet deltas; and
4. correlated rock material realization over retained packets.

Unchanged projected demand reuses both geometry and complete material packet
identities. Evicted detail is removed from the active scene and later
regenerates byte-identical vertices, roughness, and displacement from the same
conditioned keys.

## Hard working-set budget

The coarse packet owns 504 typed-vector bytes. Each retained one-face detail
packet owns 308 typed-vector bytes, including positions, normals, colors,
indices, roughness, displacement, surface coordinates, and base normals. The
effective detail budget is the smaller of the requested vertex budget and the
capacity remaining after the coarse packet.

The pinned 812-byte case therefore materializes exactly one detail vertex and
three detail faces even when four are requested. The pinned 1,120-byte case
materializes exactly two. Moving the camera outside the refinement threshold
returns both scenes to the 504-byte coarse steady state.

## TDD evidence

RED failed because no adaptive stone scene coordinator existed. GREEN pins:

- coarse-first materialization;
- projected-demand selection;
- exact 504/308-byte accounting;
- vertex and typed-vector RAM limits;
- retained packet identity on a steady camera;
- deterministic eviction and regeneration; and
- finite correlated material vectors.

Focused coordinator, demand, refinement, watertight geometry, retained packet,
rock material, and stone spectral-scene regression:

```text
41 passed, 0 failed
```

No browser or WebGPU process was launched for this packet, preserving the
0.4.1 cold-start timing lane.

## Acceptance-gate impact

The released-material stone path now begins coarse, refines only projected
demand under explicit vertex/vector-RAM limits, reuses stable correlated
materials, and returns to its coarse steady state. This advances MAT-040 and
the acceptance experience's camera-demand/memory behavior without making a
public construction decision.

The conservative estimated 0.6.0 completion is **57.4%**, up **0.8 percentage
points** from MAT070U's 56.6%. A multi-stone population through this
coordinator and adaptive GPU/capture evidence remain open, as do
shared-compiler integration and complete tree/forest/road release scenes.
