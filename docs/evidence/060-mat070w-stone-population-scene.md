# MAT070W: bounded procedural-stone population scene

Status: private 0.6 CPU-only population tracer. No public VKF syntax, public
material API, schema, ABI, diagnostic, shared compiler behavior, shared 0.4.1
runtime, browser process, WebGPU workload, rabbit example, or gallery changed.

## Vector-first population and material demand

The coordinator carries the existing population vectors directly into one
adaptive scene per stable stone identity. Population-conditioned family fields
remain shared within each family, while per-stone radii and rotations retain
the existing individual variation. Material packets stay aligned with the
population vectors and begin with only the closed coarse packet.

The pinned patch contains 13 stones. Ten follow its dominant family, while
their radii still vary per stone. This proves population-level affinity and
individual variation reach the same materialization path rather than becoming
unrelated fixtures.

## Aggregate demand and hard bound

The population vectors own 32 typed-vector bytes per stone. Each adaptive stone
owns 504 coarse bytes and at most one 308-byte detail packet in this bounded
slice. Per-stone coordinator accounting adds five bytes for refinement usage
and material-byte offsets. The coordinator derives both effective stone
capacity and aggregate detail capacity before materialization.

For 13 stones, the pinned coarse-first state is exactly 7,033 bytes:

```text
13 * (32 population + 504 coarse material + 5 coordinator bytes) = 7,033
```

A 7,649-byte budget leaves exactly two 308-byte refinement slots. Projected
demand therefore refines two stones and cannot allocate a third. The complete
typed-vector working set remains at or below that declared hard limit.

A separate 1,082-byte case requests 13 stones but realizes exactly two coarse
stones and zero detail, proving population demand itself yields to the RAM
bound before refinement begins.

## Stable motion, eviction, and regeneration

Projected radius ranks stones deterministically. Moving the camera changes the
two selected refinement identities while all population identities, positions,
radii, rotations, and family indices remain unchanged. Returning to the first
camera regenerates identical vertices and roughness for evicted detail.

Removing the demanded patch evicts all 13 stone coordinators and releases the
typed-vector working set. Re-demanding it reproduces the population vectors and
coarse material packets exactly from the same conditioned identities.

## TDD evidence

RED failed because the private multi-stone scene coordinator did not exist.
GREEN pins:

- vector-first family and per-stone variation;
- coarse-first packets for every demanded stone;
- exact aggregate typed-vector RAM enforcement;
- RAM-derived coarse population capacity;
- spatially stable identities across camera movement;
- deterministic detail eviction and regeneration; and
- deterministic full-stone eviction and regeneration.

Focused population, adaptive demand, refinement, packet, rock-material,
conditioned-distribution, marked-point, and spatial-correlation regression:

```text
59 passed, 0 failed
```

No browser or WebGPU process was launched for this packet, preserving the
0.4.1 cold-start timing lane.

## Acceptance-gate impact

MAT-040 now has a private multi-stone path from vector-first family population
through bounded coarse-first materialization and camera-driven refinement. It
demonstrates the required related-but-non-identical behavior and aggregate RAM
discipline on 13 stones; it does not yet claim the required hundreds-stone
frame-budget gate.

The conservative estimated 0.6.0 completion is **58.3%**, up **0.9 percentage
points** from MAT070V's 57.4%. Remaining MAT-040 work includes hundreds-stone
CPU/GPU median and tail timing, adaptive hidden capture, and camera-path steady
state at release scale. Shared compiler integration plus complete tree/forest
and road release scenes also remain open.
