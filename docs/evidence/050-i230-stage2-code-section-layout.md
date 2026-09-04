# 050-I230 Stage-2 code-section layout evidence

## Scope and behavior

- Git base: `d8dddb73a359d3253e6159128373f2c398f56098` (I229)
- Worktree: `.worktrees/0.5/050-i230-stage3-code-section-layout`
- Branch: `codex/0.5/050-i230-stage3-code-section-layout`
- State: GREEN, ready for exact-scope commit

I230 adds the first compiler-owned bounded code-section layout primitive. Prior
x64 fixed-point tests constructed all unused code-slot bytes in JavaScript and
passed the result as `artifact_tail`. The new Stage-2 writer instead accepts
only the immutable template suffix, derives the emitted code size from
source-selected immediate widths, checks it against the private 32 KiB slot,
and emits the exact zero fill itself.

The selected three-function chain remains 92 bytes: helpers begin at offsets
2, 22, and 42, the entry begins at 62, and its three call relocations remain
byte-identical to I229. Stage 2 appends exactly 32,676 zero bytes before the
template suffix. The resulting executable has the same total byte length as
the locked runner template, runs, and prints exact `42`.

Stage 0, Stage 2, and Stage 3 print exact `42`. Stage-2 and Stage-3 programs
are byte-identical; Stage-2, Stage-3, and Stage-4 compiler artifacts are
byte-identical. Generated compiler source contains neither internal stage
observation nor `process.run_native`, and does not supply `artifact_tail`, the
section capacity, or padding bytes.

This packet owns code-slot sizing and fill, not PE section discovery or header
encoding. The test still extracts the immutable runner prefix and suffix around
the locked marker. Marker discovery, section/header mutation, platform-neutral
container models, arbitrary source-module symbols, and ELF/Mach-O writing
remain open. No public syntax, semantics, API, diagnostic, manifest schema,
ABI, UI, renderer, or native implementation changed.

## TDD receipts

Environment: Windows x64, Node `v24.11.0`; the complete six-file ignored
seed/smoke bin set came from I229. Tests used
`VKF_TEST_WORK_ROOT=C:\w\vf-i230`.

Focused command:

```powershell
$env:VKF_NATIVE_BIN=(Resolve-Path '.work/full-suite-bin').Path
$env:VKF_TEST_WORK_ROOT='C:\w\vf-i230'
node --test tests/bootstrap/stage2-owned-x64-code-section-layout-fixed-point.test.mjs
```

- RED: exit `1`, 0/1 in 20.07 s; the missing private section-owning writer was
  rejected as `direct x64 backend unsupported: machine IR supports direct
  calls only` before artifact creation.
- initial linear-fill GREEN: exit `0`, 1/1 in 32.70 s.
- post-GREEN binary block-doubling refactor: exit `0`, 1/1 in 24.60 s, 8.10 s
  lower elapsed time while preserving the exact 32,676-byte zero-fill oracle.

Adjacent matrix (`node --test --test-concurrency=1`) covered code-section
layout, dynamic relocation cardinalities, source symbol discovery, backward
and forward relocation, the original artifact seam, high-byte imm32, the
complete integer writer, and source/bundle hash checks:

- exit `0`, 11/11 in 231.03 s.

Locked gates:

```powershell
node --test tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- locked Stage-2/3/4 source graph: exit `0`, 1/1 in 30.80 s;
- first bundle run completed its work but teardown failed: exit `1`, 0/1 in
  61.78 s with Windows `EPERM` removing its temporary directory; no lingering
  test process was present;
- unchanged complete ten-source executable bundle rerun: exit `0`, 1/1 in
  54.33 s.

No timeout, assertion, byte oracle, or performance gate was weakened. The
focused before/after timings are a local implementation check, not a formal
performance claim.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `47D3030FAEA37E6392EE186F52F4462BDD5FA883388BD2ABAC8FA11EE44CB199`
- bootstrap manifest canonical bytes:
  `F91629056FCE9BC80CFC03FE03A6A793898C1402D36E67E5D62C3AA9199E7559`
- canonical compiler facade source:
  `0DFF695B7F7C6B4FA75FB91105C3A3042E6F7935884293AB02A87AF0B69FD3C3`
- I230 acceptance test canonical bytes:
  `1523AF2A88D5B77A991672F4794BAA40F2C86EE363AB93304939DF26C83BBBDD`
- strict Stage-0 seed compiler:
  `C6C450DD729F97F43F35067E7E0D4BE216EBD6059BB4B910BD40BCA89ED85336`
- locked x64 runner template:
  `8B501F0F67A5AA20E33F82DA8B1747E498A09BCE2BC2B4AD576A165CA792D039`

## Gate and completion impact

I230 advances ADR 0005 rules 3 and 5 by moving bounded code-section sizing and
fill across the host seam into Stage 2. It does not close a whole rule or claim
general PE/ELF/Mach-O artifact writing.

Rules 1, 2, and 7 are established; rules 3, 4, and 5 are partial; rules 6 and
8 remain open. Counting partial rules as one half remains `4.5/8 = 56.25%`,
so the defensible rounded release estimate stays **55%**. The next genuine RED
should target locked-marker/section discovery or section/header encoding, unless
arbitrary source-module symbol discovery proves earlier. Full suite
equivalence, stdlib/UI migration, fallback removal, and the seed-only
toolchain-free rebuild remain.
