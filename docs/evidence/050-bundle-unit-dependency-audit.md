# Bundle-unit dependency candidate: no RED

At bootstrap `f882f577d74f510f24b14d2ff76e336908fb2176`, audited main candidate
`67343be7e279c3e6ad65331df2490d7aa7605d2e`, which only adds `pe_x64` to the
fixture dependency-copy list. No change was adopted.

Fresh unchanged run on Windows x64, Node 22.14.0:

```powershell
node --test tests/bootstrap/stage1-bootstrap-executable-bundle-unit.test.mjs
```

Result: exit 0, 1/1 passed; test 3477.8836 ms, total 3563.0647 ms. Original
30000 ms bundle and 2000 ms artifact deadlines and all assertions were
unchanged. `VKF_NATIVE_BIN` and `VKF_BUNDLE_ARTIFACT_TOOL` selected this
checkout's `build/native-windows/bin`; `VKF_TEST_WORK_ROOT`, `TEMP`, and `TMP`
selected `build/bootstrap-tests`. The run inherited `SetErrorMode(0x8003)`.

Tool identities (SHA-256):

- Bundle smoke: `77448a2b27c9e4ba8eb1bad162527fb55c230d35d0f83c6fa424ec0b95b8af5c`.
- Strict compiler: `1d2d8e9bd9f2e8b0f4320f653ed862ad77d2a689144b3e812c66d6e45130c41b`.

## Why this does not prove import completeness

The configured CMake/Ninja target defines `VKF_X64_BACKEND_LIBRARY`.
`vkf_bootstrap_bundle_artifact_smoke.cpp` then calls
`vkf_x64_backend::compile` on the smoke-produced typed IR directly. Its
alternative preprocessor branch invokes `vkf-strict -b` on the original source.
These are distinct build configurations, not an adopted runtime fallback.
The passing configured fixture does not establish that copying its source
imports is complete for the alternate strict-source path.

There is no missing-dependency RED under the verified bootstrap configuration,
so importing the one-line fix would not satisfy this packet's test-first
condition. No compiler header was replaced; bootstrap-only byte-slice lowering
remains intact. Main fixes `a503868e` and `711bac82` were not adopted. This is
one focused non-RED audit, not a fresh full bootstrap regression run or a
self-compilation result; no completion percentage changes.
