# Bounded association of existing materials to terrain

2026-09-05; base `d4842653cabc558aca8de39b21e654c65ffb112b`, branch `pre-gen`.

## Private consumer

The caller supplies an existing terrain surface packet and an owned table of
explicit uint32 IDs to shared immutable `ResearchedMaterialPreset` records.
Association selects the existing record for each demanded terrain sample in
source order. It retains the exact source and table owners and returns record
references, not copies, fits, interpolated values, or regenerated materials.
The existing preset validator and all provenance fields remain unchanged.

This is material association, not sediment generation. Test assignments of
stone and leaf records to IDs are explicit integration fixtures; they do not
assert that either record is appropriate for a beach or submerged surface.

Validation order is source/grid alignment and finite normals; finite retained
water level and exact `height <= level` material classification; table presence;
table cap; sample cap; then table entries in caller order (record presence,
existing preset validation, duplicate ID). Missing IDs are checked in selected
terrain sample order. Only then is output storage reserved. Lookup storage is
bounded by the validated table cap. An invalid unselected table record still
fails; a missing ID outside the selected sample prefix is not demanded.

Table and sample limits are both 65,536. Output is the prefix bounded by the
sample budget and resident source length, with explicit truncation. Zero
budget reserves no output records. Table order does not affect record selection.
The original terrain, waterline, material and provenance inputs are not mutated.

The shared source/material-truth validator was extracted while existing
waterline tests were GREEN. Their validation order and exact messages remain
unchanged; the new association supplies its own private mismatch message.
No public VKF diagnostic was added or changed.

## RED → GREEN

| Capture under `build/terrain` | Observed RED | GREEN behavior |
| --- | --- | --- |
| `20-association-red.txt` | Missing consumer header, compiler exit 1 | Exact existing record references selected |
| `21-association-duplicate-red.txt` | Duplicate ID accepted | Exact duplicate-ID rejection |
| `22-association-record-red.txt` | Invalid existing record accepted at zero demand | Existing preset validator used unchanged |
| `23-association-missing-red.txt` | Generic map diagnostic instead of contract error | Exact missing-ID rejection before output allocation |
| `24-association-truth-red.txt` | Changed retained level accepted with stale IDs | Existing source classification checked |
| `25-association-budget-red.txt` | Sample budget over cap accepted | Exact cap rejection |
| `26-association-msvc-newline-red.txt` | Test text used CRLF instead of exact LF | Binary stdout/stderr mode; assertion unchanged |

The first diagnostic capture wrapper masked its compiler exit; the same compile
was immediately rerun directly and returned exit 1 before implementation.
One later test-only namespace delimiter failed compilation and was corrected.
Neither incidental harness error is presented as a behavioral RED.

## Verified gates

| Gate | Result |
| --- | --- |
| GCC 12.2 association plus unchanged terrain/waterline gates | 21/21 GREEN |
| Clang 22.0.0git same tests and complete trace | 21/21 GREEN |
| MSVC 19.44.35217 same tests and complete trace | 21/21 GREEN |
| Combined road/random/spatial/terrain/association dependencies | 72/72 GREEN |
| Existing researched-preset tests, Clang and MSVC | GREEN |
| Rebuilt height/normal/triangulation/waterline units, full GCC ASan + UBSan | 20/20 each clean |
| Rebuilt association and existing researched-preset units, same sanitizers | 20/20 each clean |

Native integration checks exact shared-record identity, source/table ownership,
two seeds, changed water levels, refinement 3 and 8, table permutations,
zero/prefix/full sample demand, full table demand, stale source/level/IDs,
null and malformed inputs, and simultaneous-error validation precedence.

The canonical trace serializes every field of the four existing researched
preset records, including numeric fits, optional optical/directional evidence,
and provenance strings. It also serializes exact terrain position/normal bits,
retained IDs and selected record families for small seed/level cases and a full
65,536-sample fixture. GCC and Clang traces compared byte-for-byte; all three
toolchains pass the same pinned SHA-256 and replay gate:

`73ce596f838d9f3e9208df9dfb79da4be67af550e5f65238ff0e3a30dc0ed6de`

The 4,232,819-byte trace stays under ignored `build/terrain`, within the unchanged
16 MiB capture limit. It is not committed. Record pointer equality proves the
consumer preserves the entire caller record, including fields not used by a
future downstream consumer. No new material equations are tested via a copied
reference implementation because this consumer performs no material arithmetic.

All eight original terrain/material SHA-256 gates remain unchanged. The old
normal, triangulation and waterline differential tests are retained. No forest,
road, stone, leaf spectrum or preset identity is changed.

## Reproduce

```sh
node --test tests/js/vf-terrain-material-association-native.test.mjs tests/js/vf-terrain-water-level-native.test.mjs
g++ -std=c++20 -O2 -ffp-contract=off -Wall -Wextra -Werror -pedantic -I. native/material/vf_terrain_material_association_test.cpp -o build/terrain/association
build/terrain/association --trace > build/terrain/association.bin
sha256sum build/terrain/association.bin
```

Clang uses the same flags. MSVC uses `/std:c++20 /O2 /EHsc /fp:strict /W4 /WX`.
`VKF_TERRAIN_ASSOCIATION_TEST` and `VKF_TERRAIN_PROBE` select separately built
executables for exact cross-toolchain testing.

All six sanitizer units were rebuilt with
`-O1 -g -ffp-contract=off -fsanitize=address,undefined -fno-omit-frame-pointer -no-pie`
and strict warning/error flags. Each ran twenty times, for 120 executions with
exit 0 and empty stderr. No sanitizer options or checks were disabled.
The local receipt is `build/terrain/association-sanitizer-20.json`.
Fixed layout retains the documented [PIE startup isolation](060-conditioned-terrain-normals.md);
ordinary PIE instability is not relabeled GREEN.

## Remaining boundary

There is no sediment, sand, wetness law, naturalism, renderer, interpolation,
public schema/API/default, or performance claim. This packet neither renames
road wetness nor makes the existing researched records into terrain defaults.
Physical dry/wet sediment needs its own evidence and contract.
