# Native road-standing-water consumption

2026-09-05; base `99e84a75483eba7fd0535d9fa79a4382ed5ddc2c`, branch `pre-gen`.

## Contract and boundary

The native consumer implements the existing private
`web/vf-ui/vf-road-water-field.mjs` computation. Its input is the existing
`conditionedNodeStreamReference` key/counter-prefix plus typed road-wear
buffers. Native code executes Philox4x32-10, quintic spatial interpolation,
pooling, drainage and correlated depth/material calculations. The identity
fixture and JavaScript implementation serve as the differential oracle, not
as a runtime fallback or native-result producer.

This packet deliberately does not add public constructors, defaults, schemas,
diagnostics, identity encoding, general water, fluid simulation or a renderer.
The existing native road hierarchical generator has a different identity and
is not substituted for the reference's conditioned stream.

Geometry and material views reference one owned depth/coverage allocation.
Coordinates, positions and layer indices borrow the input buffers, matching
the existing subarray ownership: callers must keep the source buffers alive.
Output allocation is bounded by the existing 65,536-sample limit, at 32 bytes
per realized sample. A road with 300 billion potential cells still allocates
only the demanded prefix. Every calculation preserves the reference's double
operation order and float-array rounding points. Build without contraction
or fast-math when exact reference identity is required.

## RED → GREEN

1. The exact wet/dry differential test was RED with missing
   `native/material/vf_road_water_field.hpp` (exit 1, 0.14 s Node test duration).
   Adding the native stream/spatial and water consumers made the same tracer
   GREEN, including the pinned first depth `0.004998494870960712`.
2. A NaN wear-driver test exposed C++ min/max repairing NaN to a finite value
   (exit 1). The existing reference accepts those typed values and propagates
   the captured negative quiet-NaN result; the native clamp now preserves it.
   No new rejection or finite-value fallback was introduced.
3. Windows exact diagnostic comparison was RED because CRT text streams
   translated LF to CRLF. Only the probe's transport streams were switched to
   binary mode. Expected diagnostic bytes and producer errors were unchanged.

## Verification

| Gate | Result |
| --- | --- |
| Exact differential, Linux GCC 12.2.0 | 6/6 GREEN, 2.75 s total |
| Exact differential, Linux Clang 22.0.0git | 6/6 GREEN, 3.06 s total |
| Exact differential, Windows MSVC 19.44.35217 `/fp:strict` | 6/6 GREEN, 2.36 s total |
| Native differential plus water, material energy, random, conditioning and spatial JS dependencies | 39/39 GREEN, 3.59 s final combined run |
| All native `vf_road_*_test.cpp`, strict Clang | 14/14 GREEN |
| Native ownership/validation/known-vector test, GCC ASan + UBSan | GREEN, no sanitizer findings |
| Same native ownership/validation/known-vector test, strict MSVC | GREEN |

Differential assertions compare every output float's bits, not a tolerance.
They cover wet and dry cells, buried layers, changed seed/hierarchy, reversed
demand, signed coordinates, empty and truncated demand, infinite wear drivers,
NaN propagation, exact spatial-domain/budget errors in reference order, and
the full 65,536-sample budget (2,097,152 output bytes). The native unit test also
checks the three unchanged Random123 known-answer vectors, shared storage,
shape rejection before budget rejection and preservation after failed calls.

### Commands

With this checkout mounted at `/src` in `node:22-bookworm`:

```sh
node --test tests/js/vf-road-water-native.test.mjs
node --test tests/js/vf-road-water-field.test.mjs tests/js/vf-road-water-renderer-packets.test.mjs tests/js/vf-road-material-energy.test.mjs tests/js/vf-demand-random.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs
g++ -std=c++20 -O1 -g -ffp-contract=off -fsanitize=address,undefined -fno-omit-frame-pointer -Wall -Wextra -Werror -pedantic -I. native/material/vf_road_water_field_test.cpp -o build/road-water/sanitized-test
build/road-water/sanitized-test
```

In `emscripten/emsdk:4.0.14`, run the same differential with
`CXX=/emsdk/upstream/bin/clang++`. Native road tests were each compiled with
`-std=c++20 -O2 -Wall -Wextra -Werror -pedantic -I.` and executed unchanged.
The focused harness compiles its consumer with `-ffp-contract=off` and retains
a 30-second process deadline; no case is skipped.

From a Windows x64 developer shell:

```text
cl /nologo /std:c++20 /O2 /EHsc /fp:strict /W4 /WX /I. tools/road-water-native-probe.cpp /Febuild/road-water/native-probe.exe /Fobuild/road-water/native-probe.obj
```

Then in PowerShell:

```powershell
$env:VKF_ROAD_WATER_PROBE = (Resolve-Path build/road-water/native-probe.exe).Path
node --test tests/js/vf-road-water-native.test.mjs
```

The override selects an explicitly prebuilt native consumer; it never bypasses
assertions or falls back when compilation/execution fails. All generated
files remain under this checkout's `build/road-water`.

SHA-256:

- `vf_conditioned_stream.hpp`: `9950DCB935493DA7549742D0012F9636FF4ECAC2F0B032EF26B9107B7599EA24`
- `vf_road_water_field.hpp`: `7EA2B52BBD44DBAB005F213D9233B7A9828EFBF8F901C4F023A3FE6F1F06F7BC`
- Clang probe: `BC14D34CA1B9F62F3DE17F184783704F48D14DA7B96B1D5EBA6C7A8F4D1B42B2`
- MSVC probe: `75834C577FC26A721267661C55B8405C39824FE7FC4B4DC6105A339F107207EE`

## Remaining gates

Native front-end identity authoring, shared compiled/VKF consumption and real
renderer integration remain separate work. These tests certify no GPU output,
rendering quality or performance improvement. The full cross-platform material
suite still has the inherited forest identity and missing capture-header REDs.
No release percentage is increased solely from this packet.
