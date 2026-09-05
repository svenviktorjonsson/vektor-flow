# Ordered cell demand through existing terrain consumers

2026-09-05; base `a41b9f75c69bc241e4278a7575d6a35bda7b6910`, branch `pre-gen`.

## Private composition

`PlanTerrainCellSamplesReference` selects the existing caller-ordered cell
prefix under explicit cell/triangle caps. It derives required unique corner IDs
in first-use `a,b,c,d` order and retains the complete terrain request alongside
the resulting cell and sample-ID vectors. IDs retain their tile/refinement
meaning; no camera selection or alternate height field is introduced.

The plan feeds the existing sparse-residency → normal/material surface →
addressed-topology → waterline chain. Caps and corner addresses now use shared
kernels with the existing triangulation path. Triangle winding, source ownership,
height/normal/material generation and waterline interpolation remain unchanged.

## Strict fit and source order

Existing request validation runs first, followed by the unchanged cell cap,
triangle cap and cell-demand input cap. Only the selected prefix is evaluated.
Within each selected cell, domain and duplicate checks precede first-use corner
admission. If another required unique corner would exceed the explicit sample
budget, the entire plan rejects with the private diagnostic
`terrain cell demand exceeds sample budget` before inserting that corner.

Insufficient sample budget never shortens/reorders the selected cell prefix or
emits a partial cell. Shared corners consume one sample each. The `truncated`
flag reflects only the existing cell/triangle prefix selection, not silent
sample-budget truncation. Unselected malformed cells remain unevaluated.

Membership lookups are bounded by selected cells and the explicit sample budget;
their iteration order is never used. Output vectors are allocated only after
validation, with capacities equal to returned counts. Zero selected demand
reserves neither output vector. Source/cache state is not mutated by planning.

## RED → GREEN

| Capture under `build/terrain` | RED | GREEN |
| --- | --- | --- |
| `41-terrain-cell-demand-red.txt` | Planner absent | Two ordered adjacent cells feed existing cache/topology with six unique corners |
| `42-terrain-cell-demand-budget-red.txt` | Five samples incorrectly accepted for the six-corner request | Exact all-or-reject sample-fit diagnostic |
| `43-terrain-cell-demand-identity-red.txt` | Planned addresses lacked retained request identity | Condition/tile/refinement/budget carried into cache consumption |

Each RED exited 1 before implementation. Shared cap/address extraction passed
all 34 existing affected terrain/material/residency gates. No old expected hash,
diagnostic assertion, timeout, tolerance or acceptance gate was weakened.

## Evidence

Native coverage checks first-use order against an explicit corner oracle across
refinements 0–5, replay, seed changes, cell permutations, selected-prefix limits,
every cap, ordered duplicate/domain errors, zero and insufficient sample budgets,
both seam axes, a retained refinement anchor and 64-bit IDs above uint32.
The direct consumer preserves exact triangle indices and cache ownership.

The full plan selects 65,024 cells and derives exactly 65,535 used corners,
emitting 130,048 triangles through the existing topology consumer. A budget of
65,534 rejects; no unused grid sample is generated. Returned cell/sample vectors
reserve their exact counts on all verified toolchains. This is a bounded-demand
identity test, not a performance or visual-quality claim.

The 7,861,120-byte trace captures complete request and demand identity, the full
fixture's surface/material/triangle bytes, and boundary/oracle fixtures. Its
replay SHA-256 is:

`6de6bf001d2d0fe65d88f15ca41dbff060549a19c68092bb7c255eb94272a8ec`

It remains ignored build evidence, within the unchanged 16 MiB capture limit.
GCC 12.2, Clang 22.0.0git and MSVC 19.44.35217 each pass all 36 affected suites;
their complete traces compare byte-for-byte. The combined unchanged
road/material/random/spatial dependencies and terrain suites pass 87/87 on GCC.

All eight original terrain/material hashes remain unchanged, as do association
`73ce596f838d9f3e9208df9dfb79da4be67af550e5f65238ff0e3a30dc0ed6de`,
prefix residency
`dd486e72228b6fa606d8c2419cb78bf7325871a5fc9d5329b84806e8416785cd`
and sparse residency
`0562d7a5e716ee53ac52327397108870f7816e12f3bed2ea1975cb9e50c2a8f8`.
The old prefix topology still rejects indexed layout with its unchanged exact
diagnostic and precedence.

All eleven affected native units were rebuilt with full ASan + UBSan and each
passed 20 executions: 220 exits of 0, every stderr empty. This includes height,
normals, prefix triangulation, waterline, association, presets, prefix residency,
sparse samples, addressed topology, sparse residency and the cell planner.

Flags retain `-O1 -g -ffp-contract=off -fsanitize=address,undefined
-fno-omit-frame-pointer -no-pie` and strict warnings. No sanitizer options or
checks were disabled. The receipt is `build/terrain/cell-demand-sanitizer-20.json`.
Fixed layout preserves the documented
[PIE startup isolation](060-conditioned-terrain-normals.md); ordinary PIE startup
is not relabeled GREEN.

## Reproduce

```sh
node --test tests/js/vf-terrain-cell-demand-native.test.mjs tests/js/vf-terrain-sparse-residency-native.test.mjs tests/js/vf-terrain-residency-native.test.mjs tests/js/vf-terrain-material-association-native.test.mjs tests/js/vf-terrain-water-level-native.test.mjs
g++ -std=c++20 -O2 -ffp-contract=off -Wall -Wextra -Werror -pedantic -I. native/material/vf_terrain_cell_demand_test.cpp -o build/terrain/cell-demand
build/terrain/cell-demand --trace > build/terrain/cell-demand.bin
sha256sum build/terrain/cell-demand.bin
```

Clang uses identical flags; MSVC uses `/std:c++20 /O2 /EHsc /fp:strict /W4 /WX`.
`VKF_TERRAIN_CELL_DEMAND_TEST` selects a separately built planner test. Existing
probe/residency/association overrides remain unchanged.

## Still separate

Camera policy, projected error, adaptive mixed-level stitching, continuous-field
bounds, sediment laws, rendering and public authoring controls remain separate.
No public syntax/API/schema/default, forest identity, performance, naturalism or
release-percentage claim changes.
