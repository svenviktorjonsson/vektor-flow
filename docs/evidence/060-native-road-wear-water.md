# Native road wear → standing water

2026-09-05; base `52693a6278b6577e84047274a5b980b426c8bf9f`, branch `pre-gen`.

## One existing-contract behavior

Native code now consumes coordinate buffers and existing conditioned traffic,
exposure and pooling streams, generates road-wear geometry/material samples,
and feeds them directly into the [native standing-water consumer](060-native-road-standing-water.md).
No precomputed wear drivers or materials are sent to native execution in this
integration mode.

`vf_road_wear_field.hpp` preserves the existing `vf-road-wear-field.mjs`
formulas, correlation lengths, amplitudes, operation order, float storage
rounding, budget and rejection messages. It reuses the native conditioned
stream/spatial kernel; no second random identity or interpolation path is
introduced. The original reference files and native water producer are unchanged.

The producer owns its drivers, displacement, albedo, roughness and wetness.
Its `buffers()` adapter borrows those arrays for the water consumer. Coordinate
buffers remain shared from the original input and must outlive both views;
the wear owner must remain alive while its material buffers are consumed.
Neither stage expands the potential road. Each allocates 32 bytes per realized
sample, bounded by the existing 65,536-sample budget.

## RED → GREEN and regressions

The new integration test first failed during compilation with the missing
`native/material/vf_road_wear_field.hpp` header (exit 1; 0.21 s Node duration).
Adding the native producer made the same exact-byte tracer GREEN. It compares
all wear outputs, including displacement and drivers, followed by all native
water outputs. Generated values are never replaced with recorded output.

| Gate | Result |
| --- | --- |
| GCC 12.2.0 differential and unchanged affected JS dependencies | 44/44 GREEN, 5.54 s total |
| Clang 22.0.0git exact wear/water differential | 10/10 GREEN, 5.25 s total |
| MSVC 19.44.35217 `/fp:strict` exact wear/water differential | 10/10 GREEN, 4.24 s total |
| All native `vf_road_*_test.cpp`, unchanged strict Clang flags | 15/15 GREEN |
| New native wear ownership/validation unit, GCC ASan + UBSan | GREEN, no findings |
| Same new native wear unit, MSVC `/W4 /WX /fp:strict` | GREEN |

The differential checks changed conditioning identities, reversed demand,
zero/one/101/1,024-sample prefixes, exact budget-before-spatial validation,
non-finite/out-of-domain coordinates and the full 65,536-sample native chain.
Both stages match the existing reference byte-for-byte at maximum demand.
The native unit additionally checks borrowed/owned buffer identity, shape
rejection before budget rejection and unchanged previous output after failure.
No tolerance, timeout or acceptance gate was weakened. Concurrent execution
times above identify test runs; they are not performance claims.

## Reproduce

With this checkout mounted at `/src` in `node:22-bookworm`:

```sh
node --test tests/js/vf-road-water-native.test.mjs tests/js/vf-road-wear-field.test.mjs tests/js/vf-road-water-field.test.mjs tests/js/vf-road-water-renderer-packets.test.mjs tests/js/vf-road-material-energy.test.mjs tests/js/vf-demand-random.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs
g++ -std=c++20 -O1 -g -ffp-contract=off -fsanitize=address,undefined -fno-omit-frame-pointer -Wall -Wextra -Werror -pedantic -I. native/material/vf_road_wear_field_test.cpp -o build/road-water/wear-sanitized-test
build/road-water/wear-sanitized-test
```

Use `CXX=/emsdk/upstream/bin/clang++` in `emscripten/emsdk:4.0.14` for the Clang
differential. Each native road test was compiled with
`-std=c++20 -O2 -Wall -Wextra -Werror -pedantic -I.` and executed unchanged.
Use the preceding standing-water receipt's Windows probe build command and
`VKF_ROAD_WATER_PROBE` selection to run the same 10 assertions with MSVC.
The probe's `--native-wear` mode accepts only streams and coordinate buffers;
it does not read precomputed wear outputs.

SHA-256:

- `vf_road_wear_field.hpp`: `9F0185D9419EAA8EAA340CED418477593591CFB33116AAD0AFCC8DD9EE3E3058`
- `vf_road_wear_field_test.cpp`: `0838CD3F77E4238589C310610FFA26AF777A42F74E22ACDFA1E45CDB9389A687`
- Clang integration probe: `76CBBCE3E6B0EF776E9F7B1B7E1636FFA2DC9555F60417F022E91635D89BDAB1`
- MSVC integration probe: `5C2507595BED5EFEA7472C3BD44E7A8D2918100DA5830208246E6DA66F052A60`

All generated output remains inside this checkout's `build/road-water`.

## Not closed by this packet

Public identity authoring, VKF/shared-compiler bindings and real renderer
consumption remain separate gates. This is neither a new public material API
nor a general water/fluid model, and proves no GPU output or release completion.
The separate [forest identity decision](060-forest-platform-trig-drift.md)
remains unanswered and unchanged. No forest hash or generator was altered.
