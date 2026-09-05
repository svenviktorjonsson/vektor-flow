# Conditioned terrain and explicit water-level material selection

2026-09-05; base `3b3a11beb33628ee4b28283d13af5e519a02dfbf`, branch `pre-gen`.

## Private vertical slice

The next [nature-plan](../plans/0.6-nature-next.md) tracer samples one existing
conditioned spatial field as terrain height. A direct consumer retains those
samples and selects caller-supplied exposed/submerged material IDs against a
caller-supplied water level. It does not resample height or introduce unrelated
material noise. Equality selects the submerged ID. The IDs are opaque; this
does not create physical sediment properties, wetness, or a shading contract.

There are no public VKF names, schemas, defaults, diagnostics, or bindings in
this packet. Test conditions are authored examples, not measured terrain.
The existing Philox/quintic spatial kernel is reused without edits; the JS
differential calls the existing JS spatial kernel, not a new terrain algorithm.
Existing forest, road, stone and material identities are untouched.

Each private unit tile uses canonical global integer numerators and dyadic
division. Adjacent edges and refined coarse anchors therefore address the
same coordinates and stream. Refinement increases sample density, not the
field's identity or frequency content. This is not yet multiscale relief.

Demand is a row-major prefix, capped at 65,536 samples. Refinement 16 has
4,295,098,369 potential samples but does not allocate that potential grid.
Each demanded sample owns three float64 position components; its material
consumer owns one uint32 ID and retains the immutable generated source.
Payload is 28 bytes/sample, excluding container/ownership metadata. A truncated
tile is not a complete mesh. The full tile domain is validated before allocation,
including zero demand. Consumer input is checked before material allocation.

## RED → GREEN

1. The adjacent-edge/material-consumer test initially failed compilation because
   `vf_terrain_water_level.hpp` did not exist.
2. After the first seam GREEN, zero-budget invalid conditions were accepted.
   The new rejection test was RED (`invalid input was accepted`, exit 134 in
   the initial uncaught test). Pre-allocation validation through the existing
   spatial kernel made it GREEN. Tests now catch errors and exit normally.
3. An oversized forged working set reached the consumer. Its rejection test
   was RED (exit 1); the explicit 65,536-sample bound made it GREEN.
4. A forged NaN position was accepted. Its rejection test was RED (exit 1);
   finite-position validation made it GREEN. No NaN repair or fallback exists.

Raw RED captures are under `build/terrain/01-seam-red.txt` through
`04-consumer-nan-red.txt`. The tracked test and commands reproduce each gate;
build artifacts are not required for use of this packet.

## Verified gates

| Gate | Result |
| --- | --- |
| GCC 12.2 exact JS/native terrain differential | 5/5 GREEN |
| Clang 22.0.0git exact JS/native terrain differential | 5/5 GREEN |
| MSVC 19.44.35217 exact JS/native terrain differential | 5/5 GREEN |
| GCC terrain + existing road/random/spatial JS regressions | 56/56 GREEN |
| All unchanged native `vf_road_*_test.cpp`, strict Clang flags | 16/16 GREEN |
| Native seam/refinement/consumer tests, Clang and MSVC | GREEN |
| Native tests with GCC AddressSanitizer + UndefinedBehaviorSanitizer | GREEN, no findings |

The byte differential compares the complete little-endian output, including
all float64 positions, selected uint32 IDs, potential count and truncation.
It covers negative/large int32 tiles, repeated and changed seeds, authored
conditions, zero/full/truncated demand, water-level changes, exact equality,
and ordered rejection without partial output. Native tests check both seam
axes, coarse anchors, regeneration, source ownership and forged consumer input.
The full-demand case is exercised under sanitizers too. No acceptance gates,
timeouts or tolerances were weakened; these are correctness results, not speed
or naturalism claims. No release percentage changes are inferred.

## Reproduce

From this checkout, with GCC and Node available:

```sh
node --test tests/js/vf-terrain-water-level-native.test.mjs
g++ -std=c++20 -O1 -g -ffp-contract=off -Wall -Wextra -Werror -pedantic -fsanitize=address,undefined -fno-omit-frame-pointer -I. native/material/vf_terrain_water_level_test.cpp -o build/terrain/test-sanitized
build/terrain/test-sanitized
```

The JS test builds the probe with `CXX` (default `g++`). GCC runs in
`node:22-bookworm`; Clang uses `CXX=/emsdk/upstream/bin/clang++` in
`emscripten/emsdk:4.0.14`. Both use `-ffp-contract=off` to retain the existing
JS kernel's double operation ordering.

Windows builds `tools/terrain-water-level-probe.cpp` and the native test with
`cl /std:c++20 /O2 /EHsc /fp:strict /W4 /WX /I.`; set `VKF_TERRAIN_PROBE` to
the built executable before running the same JS test. That selects a compiled
probe, not a fallback or skipped test. Binary output uses explicit little-endian
words on every platform.

## Still pending

Finite normals, triangulation, camera-driven refinement, conservative bounds,
mountain conditions and multiscale refinement remain separate terrain gates.
Shore transitions, physical sediment/wetting and beaches need more than this
binary water-level selector. There is no renderer, general water simulation,
new vegetation architecture, public authoring surface or release completion
claim. The existing [forest identity decision](060-forest-platform-trig-drift.md)
remains separate and unresolved; no frozen forest hash was changed.
