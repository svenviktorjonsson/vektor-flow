# Shared trigonometry candidate checkpoint

Viktor chose math A; portable candidate evidence is ready. Production math is
**unchanged**. No native/WASM release artifact was rebuilt for this candidate.

## RED → GREEN

`shared-trig-candidate.test.mjs` compares high-precision near-root references.
Against the existing emitted kernel it is 0/1 RED: `cos(-pi/2)` returns `-0`
instead of `6.123233995736766e-17`. The isolated musl-derived portable candidate
is 1/1 GREEN for that point, sine at `-2*pi`, `9.4` and maximum finite binary64.
No old tolerance or exact-output test was altered.

The licensed sources under `compiler/native/runtime/trig/` provide sine,
cosine, compensated small/large argument reduction and private floor/scalbn
dependencies. The private shim prefixes symbols and rejects non-binary64
intermediate evaluation. Build flags disable contraction/fast math/builtins.
The original notices and `compiler/native/runtime/LICENSE-musl.txt` are retained.

## Measured evidence

Same 12,793 input occurrences as the earlier audit; native candidate and WASM
candidate produce identical finite/signed-zero bits, with matching NaN behavior.
Independent mpmath 400/600-digit evaluations agree after binary64 rounding.

| Candidate measurement | Sine | Cosine |
| --- | ---: | ---: |
| Correctly rounded README samples /101 | 96 | 97 |
| Correctly rounded finite samples /12,790 | 12,569 | 12,631 |
| Maximum binary64 step distance | 1 | 1 |
| Maximum absolute error | 7.180e-17 | 7.301e-17 |
| Correctly rounded quadrant-neighbor samples /193 | 193 | 193 |

This improves the old WASM kernel (README sine 71/101; large near-root losses).
It is **not more accurate than the measured glibc baseline** (README sine
101/101; all sine 12,780/12,790). This candidate trades platform-specific libm
results for shared, near-rounded results. For example sine(2.5) is one step below
the high-precision reference. The accepted math decision permits reviewed
last-bit changes; no downstream acceptance hash has been replaced.

No universal correct-rounding, Windows/ARM64 equivalence, performance, compiler
coverage or deployment claim follows. The full production exact sine test stays
RED until approved runtime integration is complete.

## Reproduce and scope

```sh
# Emscripten 4.0.14 container
node tools/build-trig-candidate.mjs
# Node 22 container, after the original audit observation file exists
node --test tests/bootstrap/shared-trig-candidate.test.mjs
node tools/audit-trig-candidate.mjs
# Python container with mpmath==1.3.0
python3 tools/audit-shared-trigonometry.py build/trig-candidate/observations.json build/trig-candidate/high-precision.json
```

Candidate WASM SHA256:
`195765a4b0d2e54a047505d3e245abfe045c3289debc1eab150fd7c129eb4624`.
Durable full numerical receipt: `shared-trig-candidate-2026-09-05.json`.
Source hashes and exact flags are recorded there and in the build manifest.
The original pre-decision audit observations/receipt are preserved.

Root requested tuple execution as the next language packet after this checkpoint.
Deferred math integration must use this evidence, cover every listed native
consumer and the emitted program, and rerun native 451/451 and full unchanged
WASM gates before claiming the math migration complete.
