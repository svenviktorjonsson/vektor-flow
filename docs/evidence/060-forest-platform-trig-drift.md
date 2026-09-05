# Forest identity: platform float-trig drift

2026-09-05; base `a4d6cea31644f82c3092431015b5dec61967bd3c`, branch `pre-gen`.
Diagnosis only. No producer, expected hash, tolerance, or acceptance gate changed.

## Result

All four previously failing forest identity tests pass unchanged with Windows
MSVC 19.44.35217, `/O2 /fp:strict`. Linux GCC 12.2.0 and Clang 22 retain their
previous RED results. This is not missing recovered source or a packer-size bug.

The 512-tree fixture calls `std::cos(float)` and `std::sin(float)` before
promoting their results to double in `SampleForestTreeMaterialBundleReference`.
Identical orientation input bits produce different float trig results on the
two platforms for 16 of 512 trees. The resulting packed materials differ in
33 float words, all foliage-derived; population, wood and bark bytes match.

Windows default and `/fp:strict` diagnostics have zero differences. Both packed
buffers have SHA-256
`1F926B00E672898956A2BAE56D8833D51F25D4E86E6F97CC84FA37DE4B97F9C4`.
Changing contraction settings therefore does not resolve this observed drift.

| Unchanged Windows gate | Result |
| --- | --- |
| `vf_forest_tree_material_pack_test` | GREEN; 151,552 bytes, version `14970851967876841848` |
| `vf_forest_tree_material_realization_test` | GREEN; copied/direct exact identity |
| `vf_forest_tree_large_scene_path_test` | GREEN; version `3079309886320442288` |
| `vf_forest_tree_large_scene_benchmark_test` | GREEN; version `2091537119291143757` |

Timing output from these tests is not a performance claim: other lanes were
working concurrently. Linux's unchanged pack version is `4259925755961605299`.

## Reproduce

`tools/diagnose-forest-trig.cpp` uses the same population fixture as the pack
test and prints the raw bits of each orientation and float trig result. It
also prints double-trig results rounded to float for diagnosis, not as a fix.

From a Visual Studio x64 developer shell in this checkout:

```text
cl /nologo /std:c++20 /O2 /EHsc /I. tools/diagnose-forest-trig.cpp /Febuild/material-baseline/trig-default.exe /Fobuild/material-baseline/trig-default.obj
cl /nologo /std:c++20 /O2 /EHsc /fp:strict /I. tools/diagnose-forest-trig.cpp /Febuild/material-baseline/trig-strict.exe /Fobuild/material-baseline/trig-strict.obj
build/material-baseline/trig-default.exe
build/material-baseline/trig-strict.exe
```

With this checkout mounted at `/src` in `node:22-bookworm`:

```sh
g++ -std=c++20 -O2 -Wall -Wextra -Werror -pedantic -I. tools/diagnose-forest-trig.cpp -o build/material-baseline/trig-linux
build/material-baseline/trig-linux
```

Compile each unchanged gate's `native/material/<test>.cpp` with the same
MSVC flags and execute it. Keep all binaries and diagnostic output under this
checkout's `build/material-baseline`; no external working folder is needed.

Two discriminating inputs (hexadecimal binary32 bits):

| Tree index | Input | Operation | Windows float | Linux float | Both double-to-float |
| --- | --- | --- | --- | --- | --- |
| 80 | `40173e10` | sine | `3f33c0e7` | `3f33c0e6` | `3f33c0e6` |
| 126 | `4009b815` | cosine | `bf0c859d` | `bf0c859c` | `bf0c859c` |

A build-only double-trig-to-float experiment reduced the packed disagreement
from 33 to 5 words but did not reproduce the frozen Windows identity. It was
not applied to source. Do not call this an exact or approved replacement.

## Boundary and next work

The full cross-platform material suite remains RED. Its separate missing
native scene-capture implementation also remains RED; this investigation adds
no renderer or shading fallback.

Investigate existing deterministic kernels for exact identity preservation.
If none reproduces the frozen identity, choosing a new generator identity is
a contract decision, not permission to update hashes until tests pass. Keep
the existing tests and preserve this evidence while independent material and
object work proceeds.

## Separate ready-for-human decision draft

**FOREST-IDENTITY-01:** When the same saved forest is opened on another
computer, must it retain the recovered Windows version's exact identity?

- **A (recommended):** Retain it exactly. Keep existing gates; an audited
  cross-platform implementation must reproduce those values.
- **B:** Permit a separately versioned portable generator to produce different
  values. Old saved/versioned scenes must retain their old identity.

Example: reopen one saved forest seed on Windows and Linux. A promises exactly
the same recovered foliage data; B permits changed data only when explicitly
selecting the new version. Silently replacing the old version's expected hash
is not an option. Reply `FOREST-IDENTITY-01: A` or `B`.

This draft is not an approved public change or a published GitHub issue.
No new VKF constructor is proposed: that authoring surface remains unfrozen.
The current shared WASM trig kernel was also checked read-only: the two
discriminating inputs above produced `3f33c0e6` and `bf0c859c`, so it is not an
exact replacement for the frozen Windows identity. Water work is independent.
