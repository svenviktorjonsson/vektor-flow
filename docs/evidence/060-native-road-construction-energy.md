# Native road construction and material-energy consumption

2026-09-05; base `4022375eae1c130cb1d032b21eac1e3264a0dfd6`, branch `pre-gen`.

## Scope

The private native pipeline now realizes layered road construction alongside
native wear and standing water, then evaluates white-furnace energy from their
aligned material buffers. The reference remains the existing construction,
wear, water and material-energy modules in `web/vf-ui/`. No new profiles,
defaults, identity encoding, public VKF surface, renderer or general water
model is introduced. The existing upper-layer profile selection is retained.

Construction uses the existing conditioned aggregate/binder streams and the
same native spatial kernel as wear/water. Coordinate buffer validation is
shared with wear rather than duplicated. Geometry and material calculations
preserve double intermediates and the reference's explicit float-array stores.
Construction drivers are stored as floats but subsequent construction formulas
use the original double samples, matching the reference exactly.

Construction owns 40 bytes per demanded sample; wear and water each own 32;
energy owns 64. Each stage retains the existing 65,536-sample maximum. The
material-chain probe emits little-endian binary words so its full trace fits
the existing 16 MiB capture bound. It checks every word, including both halves
of double extrema; it does not replace the comparison with hashes. Existing
timeouts and limits are unchanged. A failed request emits no partial packet.

## RED → GREEN

1. Construction integration was RED because
   `vf_road_construction_field.hpp` was missing (exit 1, 0.25 s Node duration).
   The native producer made the same layered coordinate/material tracer GREEN.
2. Using the existing float-native energy entry against the JS contract was
   RED: energy values differed by one or two float ULPs and double extrema lost
   their lower bits. The native entry intentionally used float arithmetic;
   changing its historical results was not permitted.
3. One private precision-parameterized energy kernel now serves both contracts.
   The existing `EvaluateRoadMaterialWhiteFurnace` float entry and diagnostic
   remain unchanged in behavior. The aligned field adapter selects double
   intermediates with float output arrays, as the existing JS reference does.
   There is no duplicate energy algorithm or fallback.

## Preserve the existing float contract

Before extraction, `tools/road-energy-precision-probe.cpp` captured 4,096 seeded
samples: 65,536 output float words, extrema and violation count. After extraction,
the same probe output was byte-identical on GCC and MSVC. Clang's resulting
float trace also exactly matched the frozen GCC trace. The original pinned
`vf_road_material_energy_test.cpp` was not edited and remains GREEN.

| Trace | Before and after SHA-256 |
| --- | --- |
| Linux ASCII diagnostic | `CEDEA904E7F006123D85D6E9C4E14B5E3C3948E3FCA2C095662F7AB800F1EA11` |
| Windows ASCII diagnostic (CRT line endings) | `AB549468C7D2203F4659C7833C0679CE34160EECDD7F5825D4A6F377835AC51C` |

## Verification

| Gate | Result |
| --- | --- |
| GCC 12.2.0 exact chain + existing construction/wear/water/energy/random/spatial JS dependencies | 51/51 GREEN, 7.55 s |
| Clang 22.0.0git exact chain | 15/15 GREEN, 7.94 s |
| MSVC 19.44.35217 `/fp:strict` exact chain | 15/15 GREEN, 6.34 s |
| All native `vf_road_*_test.cpp`, unchanged strict Clang flags | 16/16 GREEN |
| Existing native procedural-scene inventory and producer-packet tests | 2/2 GREEN |
| New alignment/passivity/budget unit, GCC ASan + UBSan | GREEN, no findings |
| Same new unit, strict MSVC | GREEN |

The chain tests all generated construction/wear/water/energy output bits,
changed conditioning, reversed demand, bounded prefixes, empty demand,
alignment validation, exact error ordering and the full 65,536-sample budget.
Malformed source/budget requests do not publish partial output. Native unit
tests cover misaligned views before invalid budgets and unchanged existing
outputs after rejection. These are correctness timings under concurrent work,
not optimization or performance claims.

## Commands and artifacts

With this checkout mounted at `/src` in `node:22-bookworm`:

```sh
node --test tests/js/vf-road-water-native.test.mjs tests/js/vf-road-construction-field.test.mjs tests/js/vf-road-wear-field.test.mjs tests/js/vf-road-water-field.test.mjs tests/js/vf-road-water-renderer-packets.test.mjs tests/js/vf-road-material-energy.test.mjs tests/js/vf-demand-random.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs
g++ -std=c++20 -O1 -g -ffp-contract=off -fsanitize=address,undefined -fno-omit-frame-pointer -Wall -Wextra -Werror -pedantic -I. native/material/vf_road_field_energy_test.cpp -o build/road-water/field-energy-sanitized
build/road-water/field-energy-sanitized
g++ -std=c++20 -O2 -ffp-contract=off -Wall -Wextra -Werror -pedantic -I. tools/road-energy-precision-probe.cpp -o build/road-water/energy-probe
build/road-water/energy-probe
```

Clang uses `CXX=/emsdk/upstream/bin/clang++` in `emscripten/emsdk:4.0.14`.
Native road and procedural-scene tests each use
`-std=c++20 -O2 -Wall -Wextra -Werror -pedantic -I.`. Windows uses the preceding
[water receipt's probe build and environment selection](060-native-road-standing-water.md)
with `/fp:strict /W4 /WX`. Build artifacts and raw diagnostic captures remain
under this checkout's `build/road-water`.

Source SHA-256:

- Shared energy kernel: `70B520B7414473BC87A475F47A375AA40C2CB2AAD79D1673BB77065C72B25DB7`
- Construction producer: `E1DDE274FAA0FF1C809569B986F004FFE25AD8A9A0E5119535A1FBD23094F20C`
- Aligned energy adapter: `7FA6FECC57FE6A49F0D54B349A6C5841F027B8E703DB3658E10B3D2426B3F894`
- GCC chain probe: `ECEA2FD6A31AF65CC0D26C6B225F53C224E41CAA38348F9F7E432E995E5A21AC`
- MSVC chain probe: `BA0FE3678EAA2FB175B4CA13F81EC4D2129DAE34E0B8929717F468FA6DE66D36`

## Remaining boundaries

This certifies the private generated material chain and preserves the existing
float-native energy contract. Public identity authoring, shared compiler/VKF
bindings and real renderer consumption remain separate. It does not prove GPU
output, terrain, ocean/river simulation or release completion. The inherited
forest identity and absent native scene-capture implementation remain RED;
no forest identity or expected hash was changed.
