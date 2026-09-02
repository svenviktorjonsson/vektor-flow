# 050-I197 Stage-2-owned positive-imm32 high-byte evidence

## Scope

- Git base: `0b84cc8a`
- Consumed packet: committed I196 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, ready for exact-scope commit

I197 proves arbitrary high-byte preservation for the private x64 positive
`imm32` path without interpreting artifact bytes as UTF-8 and without adding a
VKF intrinsic or changing any public contract:

```vkf
value: 16909288
:: value + 1
```

The private artifact writer supplies a 128-entry `[str]` high-byte arena. Each
arena element is a byte-exact string-backed buffer loaded through
`.io.read_bytes`; values `0x00` through `0x7F` continue to use the existing
single-byte construction. Dynamic arena selection is internal to the compiler
emitter. The selected x64 stream is:

```text
68 E8 03 02 01       push 0x010203E8
6A 01                push 1
58 59 48 01 C8 50    add and push
58 F2 48 0F 2A C0 C3 print result
```

Stage 2 and Stage 3 print `16909289`, exactly matching Stage 0. Their generated
programs are byte-identical, as are the Stage-2, Stage-3, and Stage-4 compiler
artifacts. The path uses neither `--vkf-internal-stage-observation` nor
`process.run_native`.

The arena is still supplied by the bounded private compiler wrapper. Embedding
or otherwise owning it in the complete artifact writer remains a separate
Gate-6 integration packet.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
Every child process used hidden windows. No UI, browser, renderer, or benchmark
workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test `
  tests/bootstrap/stage2-owned-x64-positive-imm32-high-byte-fixed-point.test.mjs
```

- exit `1`, 0/1 passed in 12.35 s after shortening the temporary path;
- intended failure: direct lowering rejected the not-yet-defined private
  arena-backed compiler call.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 15.31 s;
- Stage-2 and Stage-3 PEs returned exact Stage-0 stdout `16909289`;
- both contained exact `68 E8 03 02 01` little-endian encoding;
- Stage-2/Stage-3 programs and Stage-2/3/4 compilers were byte-identical.

Margin-focused command covered I197, I196, zero and maximum positive `imm8`,
plus all four compositional integer-chain emitters.

- exit `0`, 8/8 passed in 28.36 s.

The full x64/locked-source differential passed 20/20 in 59.36 s. The locked
executable-bundle gate passed 1/1 in 42.37 s, emitting and running every
declared compiler source.

`git diff --check` passed with only existing LF-to-CRLF warnings. Unrelated
dirty files and untracked work remained preserved.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `DA1F32EDFC6AF6F2673C4926EC94C09DBD706C8F13802390D25522163CE86DB3`
- bootstrap manifest checkout bytes:
  `1E230CF9A6FB9D3A6C9A6B19DFFCE5F04546DC265773A0480D6347E4E957FF64`
- canonical compiler facade source:
  `35FE95DA7B9D62DB0BFBA53E85B3812A061F6E3176E78BE77796201A05146883`
- I197 acceptance test canonical bytes:
  `D55CCE6101B56E2125C48060F7CE68948F4B009AFA34782462371BAEC6389B7C`
- locked x64 runner template:
  `A5A11724BFFCEAF9BC0AD22F1F202F3435156D11251C06D7BD56A00222258EB8`

## Acceptance-gate impact

I197 proves that an arbitrary high immediate byte survives the complete
Stage-2/Stage-3 artifact path through a private byte-safe representation.
Gate 6 remains open on ownership/integration of the arena in the complete
writer, signed immediates, true-division representation, relocation, and
compiling the complete locked compiler graph into Stage 3.

Re-evaluated from I196's 93.9%, 0.5.0 is conservatively **94.4% total**, **+0.5
percentage points** for byte-exact arbitrary positive-`imm32` representation.

## Handoff inventory

I197 adds private high-byte-arena selection, rotates compiler and bundle
hashes, adds one fixed-point test, and records this receipt. No native backend,
public intrinsic, UI, renderer, push, or merge was involved.
