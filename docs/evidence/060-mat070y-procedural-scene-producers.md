# MAT070Y procedural scene producer packets

Date: 2026-09-03

## Scope

This private producer-side packet closes the two gaps identified by MAT070X.
It does not submit work to the renderer, select public VKF author syntax, or
change UI, compiler, schema, or ABI contracts.

Owned paths:

- `native/material/vf_procedural_scene_producer_packets.hpp`
- `native/material/vf_procedural_scene_producer_packets_test.cpp`
- `native/material/vf_procedural_scene_integration_inventory.hpp`
- `docs/evidence/060-mat070y-procedural-scene-producers.md`

## Road binding

Each demanded road material sample is bound to one of the two existing coarse
strip triangles with exact barycentric weights. A binding record contains the
segment identity, sample identity, triangle, and three weights in 32 bytes.
The two-sample fixture adds 64 bytes while retaining the original 192-byte road
geometry and material packet. Its version is `3399996020603820144`.

Samples outside the segment or lateral road extent are rejected. Rebuilding
the same bindings reproduces identical bytes and version.

## Forest draw geometry

Each demanded forest bundle produces only 14 coarse vertices and 60 indices:
an eight-vertex trunk and six-vertex canopy. Every ten-float vertex carries a
direct byte offset to its bark or foliage record in the existing material
bundle. No material record is copied.

The two-tree fixture uses 1,712 geometry and binding bytes and retains the
existing 592-byte material packet. Its version is `226016667512219093`.
Reversing demand traversal produces identical vertices, indices, material
offsets, bytes, and version. Material bytes that do not match the realized
bundles are rejected.

## Integration result

Stone, bound road, and forest draw packets are now all producer-ready in the
private integration inventory. The fixed fixture is 3,130 resident bytes and
has report version `17746054028491652131`.

Focused producer and dependency tests passed 4/4. The complete strict native
material suite passed 58/58 with:

```text
clang++ -std=c++20 -O2 -Wall -Wextra -Werror -pedantic -I.
```

Three descriptive 25-sample runs, each creating both producer packets 100
times, reported medians of 2,634.5, 2,535.8, and 2,674.0 microseconds. Timing
is evidence only and is not an acceptance assertion.

## Remaining boundary

The next packet consumes these three ready producer packets in the renderer
and verifies them through native frame capture. That work is intentionally not
part of this producer-owned packet.
