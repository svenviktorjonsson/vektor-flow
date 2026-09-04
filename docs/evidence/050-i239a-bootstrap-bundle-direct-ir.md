# 050-I239A bootstrap bundle direct-IR evidence

## Scope and behavior

- Git base: `8c9b1ae2123cdd9af090852b35b5faab59a10afd` (I238)
- Worktree: `.worktrees/0.5/050-i239p-bundle-direct-ir`
- Branch: `codex/0.5/050-i239p-bundle-direct-ir`
- State: GREEN, ready for exact-scope commit

I239A removes duplicate frontend and process work from the Windows x64
bootstrap bundle gate. Each bundle unit still runs the external locked lexer,
parser, and typed-IR producer and writes the same token, AST, typed-IR, and
unit-manifest evidence. The same invocation now passes that externally
produced typed IR directly to the linked x64 backend instead of launching
`vkf-strict`, which repeated lexer, parser, and typed-IR work before reaching
the same backend.

The x64 bundle target links the existing backend implementation. An
unsupported typed module still throws the backend's strict `Unsupported`
failure and is reported as a compiler failure; there is no fallback. Other
architectures retain the existing strict-compiler process path. This packet
adds no cache, source shortcut, parallelism, public VKF syntax or semantics,
public diagnostic, manifest schema/version, CLI option, or ABI.

## Diagnosis and TDD receipts

The preserved I239 profiles identified the active cost. A direct compile of
`compiler.vkf` took 24.94 s wall, split into 1.15 s lexer, 5.05 s parser,
2.33 s IR, and 12.81 s artifact time. The bundle already produced and stored
typed IR externally, then invoked `vkf-strict` for every one of the eleven
locked sources, repeating those frontend phases and adding another process
per source. Preserved timeout trees showed units 00 through 04 consuming
roughly 43--46 s and unit 05 (`compiler.vkf`) reaching artifact emission at
the unchanged 60 s boundary.

Environment: Windows x64, Node `v24.11.0`. The six ignored bootstrap binaries
were mechanically copied from I238. Tests used
`VKF_NATIVE_BIN=(Resolve-Path '.work/full-suite-bin')`,
`VKF_TEST_WORK_ROOT=C:\\vkf-i239p-work`, and the newly built bundle tool at
`C:\\v\\i239p-build\\bin\\Release\\vkf_bootstrap_bundle_artifact_smoke.exe`.

Public acceptance RED on unchanged I238 production code and unchanged 60 s
child timeout:

```powershell
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `1`, 0/1 in 61.12 s;
- `spawnSync` reported `ETIMEDOUT` when the bundle child crossed 60 s;
- no assertion or timeout was relaxed.

The short-path native build, avoiding the MSVC FileTracker long-path limit:

```powershell
cmake -S . -B C:\v\i239p-build -A x64
cmake --build C:\v\i239p-build --config Release --target vkf_bootstrap_bundle_artifact_smoke -- /m
```

- configure exit `0`;
- build exit `0`;
- linked `vkf_bootstrap_bundle_artifact_smoke.exe` successfully.

Focused one-unit executable proof:

```powershell
node --test tests/bootstrap/stage1-bootstrap-executable-bundle-unit.test.mjs
```

- exit `0`, 1/1 in 8.44 s.

Full executable locked bundle, unchanged test and 60 s limit, in two fresh
scratch trees:

```powershell
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- first independent sample: exit `0`, 1/1 in 49.18 s;
- second independent sample: exit `0`, 1/1 in 41.23 s;
- worst observed GREEN headroom: 10.82 s (18.0% of the fixed limit);
- no persistent cache exists, so the second sample is not a cache hit.

Locked source and bundle identities:

```powershell
node --test tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 2/2 in 0.58 s.

## Contract hashes

- native target configuration:
  `DB3BDDA5C0CB480BDE6C92ACDBE3A47851B7C5EE93B8BB250C40D3025CB59FF8`
- bootstrap bundle implementation:
  `546C21EA3EB0DB3A092BD20213B791075A89D8956C2FBB67E6F1ADFF2C097C96`
- built x64 bundle tool:
  `5BB88A734A8E46C0FE281C722CB6342B1A4E9B795A0DB57FBC24003A52D61809`
- locked bootstrap bundle identity (unchanged):
  `4B63D0BB5FB535083E753AEFB041F8B097AB64DFBF3BA987043E861C154F847E`

## Gate and completion impact

This prerequisite restores deterministic operating room for the full locked
bundle gate without weakening its 60 s limit or semantic assertions. It does
not itself change ADR 0005 ownership: the weighted estimate remains **60%**
(`5.0/8 = 62.5%`, conservatively rounded). I239 can now resume the next
compiler-owned PE runtime-body slice and must rerun every fixed-point and
locked-bundle gate on top of this prerequisite.
