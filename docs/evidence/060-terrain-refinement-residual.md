# Sampled terrain refinement residuals

2026-09-06; base `7e543bc73dc853087d8832d180fe431e03b977b6`, branch `pre-gen`.

## Private geometry consumer

`MeasureTerrainRefinementResidualsReference` consumes retained coarse and fine
surface packets of the same field at consecutive dyadic refinements. It uses
the existing refinement planner and addressed triangulator, not another field
generator or triangulation path. Caller parent order and both source owners
are retained.

For the existing triangles `[a,c,b]` and `[b,c,d]`, it compares fine heights at
the AB, AC, BD and CD edge midpoints and the BC diagonal midpoint against
`0.5 * endpoint_a + 0.5 * endpoint_b`. Weighting precedes addition so equal
finite maximum endpoints do not overflow. Each record contains the parent ID,
five absolute vertical differences and their maximum.

These are five sampled differences from the emitted linear coarse mesh. They
are **not** a continuous-field error bound, a camera/LOD decision, a quality
guarantee or a material interpolation rule. There is no rendering or new public
API/schema/default. Materials and normals remain owned by the supplied packets;
the residual does not interpolate or reinterpret them.

## Identity, ordering and limits

The consumer first applies existing coarse/fine topology source validation,
then compares exact stream/scalar/tile identity and consecutive refinement.
Parent budget, input length and complete demand fit follow. Existing refinement
and topology adapters preserve parent-domain, duplicate, sample-fit and
missing-corner diagnostics. Parent refinement must be 0–15; existing complete
child-group, cell, triangle and sample caps are not enlarged.

Selected X/Z coordinates must match their exact dyadic grid addresses, including
prefix-layout sources. Every selected coarse corner must equal its fine anchor
bit-for-bit before the returned residual vector is allocated. Non-finite
residual arithmetic rejects; no partial result is returned. Sources are not
mutated. The consumer checks ownership/alignment and selected anchor agreement;
it does not independently regenerate every supplied height to authenticate an
arbitrary authored packet.

Returned storage reserves the selected parent count exactly on the tested
toolchains. Empty demand allocates no output records. Temporary plans and
meshes retain their existing caps. This is not a process-wide memory bound.

The probe constructs refinement, coarse plan, coarse surface and fine surface
in explicit order, binding water-level materials before deriving normals. Its
parser checks the input count before producer validation. Tests distinguish
this producer/probe order from direct consumer validation and require exact
stderr with zero partial stdout for rejections.

## RED → GREEN

`build/terrain/45-terrain-refinement-residual-red.txt` records compiler exit 1
for the absent residual consumer. The first GREEN consumes existing flat
terrain and proves zero differences and retained source ownership. Subsequent
vertical checks cover non-flat values, exact anchors, malformed identity,
finite endpoints, ordered demands, prefix/indexed parity and bounded full demand.

`build/terrain/46-terrain-refinement-residual-probe-red.txt` records the missing
native probe before its implementation. The resulting JS differential computes
its oracle from the existing conditioned spatial field independently of the
native residual adapter. Every output byte is compared, without tolerances.

Coverage includes all 16 supported parent levels, two seeds, negative and
adjacent tiles on both axes, extreme signed tile coordinates, highest parent
addresses, replay, parent permutation, zero demand, signed-zero conditions,
finite/non-finite input precedence and complete sample-budget rejection. Changing
only water level or normal sampling distance leaves geometry residuals unchanged.
The full fixture compares all five errors and the maximum for 16,256 parents;
its 910,344-byte output stays within the unchanged 16 MiB capture limit.

## Verified gates

GCC 12.2, Clang 22.0.0git and MSVC 19.44.35217 each pass all 44 affected tests.
The existing full refinement dependency trace remains byte-identical across
the three toolchains, SHA-256:

`1c9a287dc1713cf6f966c4d8f74ed678a468685a8fb80103179c28f98753bc2a`

The combined terrain/road/material/conditioned-random/spatial suite passes
95/95 on GCC. All eight original terrain/material hashes and the association,
prefix-residency, sparse-residency and planner identities remain unchanged.
Existing same-level seam and refinement-anchor gates remain GREEN. No old
expected result, diagnostic, timeout, tolerance or acceptance gate changed.

All thirteen affected native units were rebuilt with ASan + UBSan and passed
20 executions each: 260 exits of 0, every stderr empty. These cover height,
normals, prefix triangulation, waterline, association, presets, prefix residency,
sparse samples, addressed topology, sparse residency, planning, refinement and
the new residual consumer. The receipt is
`build/terrain/refinement-residual-sanitizer-20.json`.

Flags retain `-O1 -g -ffp-contract=off -fsanitize=address,undefined
-fno-omit-frame-pointer -no-pie` and strict warnings. No sanitizer options or
checks were disabled. Fixed layout retains the documented
[PIE startup isolation](060-conditioned-terrain-normals.md); ordinary PIE startup
is not relabeled GREEN.

## Reproduce

```sh
node --test tests/js/vf-terrain-refinement-residual-native.test.mjs tests/js/vf-terrain-cell-refinement-native.test.mjs tests/js/vf-terrain-cell-demand-native.test.mjs tests/js/vf-terrain-sparse-residency-native.test.mjs tests/js/vf-terrain-residency-native.test.mjs tests/js/vf-terrain-material-association-native.test.mjs tests/js/vf-terrain-water-level-native.test.mjs
g++ -std=c++20 -O2 -ffp-contract=off -Wall -Wextra -Werror -pedantic -I. native/material/vf_terrain_refinement_residual_test.cpp -o build/terrain/refinement-residual
build/terrain/refinement-residual
```

Clang uses identical flags. MSVC uses `/std:c++20 /O2 /EHsc /fp:strict /W4 /WX`.
`VKF_TERRAIN_RESIDUAL_PROBE` and `VKF_TERRAIN_RESIDUAL_TEST` select separately
built binaries; the same JS differential then checks their exact output.
The existing terrain probe/planner/cache/association overrides are unchanged.

Forest identity, physical terrain/sediment laws, general water, mixed-resolution
stitching and renderer/material interpolation remain separate decisions. This
packet makes no naturalism, performance or release-percentage claim.
