# 050-I232 Stage-2 byte-preserving code-section replacement evidence

## Scope and behavior

- Git base: `59a941737475e15456785469801262a215a27cc4` (I231)
- Worktree: `.worktrees/0.5/050-i232-stage3-byte-replace`
- Branch: `codex/0.5/050-i232-stage3-byte-replace`
- State: GREEN, ready for exact-scope commit

I232 removes the host-prebuilt prefix/suffix boundary from the locked x64
artifact tracer. The Stage-2 driver supplies one opaque 37,376-byte runner
template. A private VKF compiler member uses the existing direct byte-regex
implementation to capture the bytes before and after the locked 32 KiB code
section, then delegates code sizing, padding, relocation, and assembly to the
I230 writer.

The acceptance fixture is intentionally invalid UTF-8. Stage 2 and Stage 3
preserve the exact 3,072-byte prefix and 1,536-byte suffix without decoding or
re-encoding them. Both insert the exact 92 selected code bytes and 32,676 zero
padding bytes, produce byte-identical 37,376-byte executables, and print exact
`42`, matching Stage 0. Stage-2, Stage-3, and Stage-4 compiler artifacts are
byte-identical.

The generated driver contains no marker offset, template prefix, artifact
suffix, section capacity, padding bytes, internal stage observation, or
`process.run_native` fallback. No native opcode or alternate byte API was
added: direct `regex.match` already scans bytes and copies captures with the
runtime byte-copy seam.

The compiler's new use of `.regex` exposed that the existing
`compiler/self_hosted/stdlib/regex.vkf` capability source was absent from the
locked bootstrap graph. I232 locks that unchanged source as unit 11 and updates
the two cardinality assertions. This changes the internal bundle identity, not
the manifest schema or a public VKF contract. No public syntax, semantics,
API, diagnostic, schema, ABI, native implementation, UI, renderer, or 0.6
material changed.

## TDD receipts

Environment: Windows x64, Node `v24.11.0`; the complete six-file ignored
seed/smoke bin set came from I231. Tests used
`VKF_NATIVE_BIN=(Resolve-Path '.work/full-suite-bin').Path`.

Focused command with `VKF_TEST_WORK_ROOT=C:\w\vf-i232`:

```powershell
node --test tests/bootstrap/stage2-owned-x64-code-section-replacement-fixed-point.test.mjs
```

- RED: exit `1`, 0/1 in 14.72 s; the linked driver reached the absent private
  whole-template writer and failed with `machine IR supports direct calls
  only`.
- first GREEN: exit `0`, 1/1 in 16.67 s;
- strengthened invalid-UTF-8 and exact prefix/suffix byte oracle: exit `0`,
  1/1 in 18.26 s;
- final post-lock update: exit `0`, 1/1 in 20.00 s.

The first full-bundle attempt was a useful second RED: exit `1`, 0/1 in
29.19 s because isolated compilation of `compiler.vkf` could not resolve its
new `.regex` import. After locking the existing regex source in the manifest,
the unchanged executable bundle command passed 1/1 in 60.66 s under
`VKF_TEST_WORK_ROOT=C:\w\vf-i232c`:

```powershell
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

The final adjacent serial command covered I225-I232, the original artifact and
integer/high-byte seams, the expanded locked Stage-1 artifact, and source/bundle
hash checks:

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage2-owned-x64-code-section-replacement-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-code-section-marker-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-code-section-layout-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-dynamic-relocation-table-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-relocation-collection-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-symbol-relocation-table-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-backward-call-relocation-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-forward-call-relocation-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-artifact-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-positive-imm32-high-byte-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-complete-integer-writer-fixed-point.test.mjs tests/bootstrap/stage1-locked-graph-stage2-artifact.test.mjs tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 14/14 in 298.54 s.

Final locked Stage-2/3/4 graph command:

```powershell
node --test tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs
```

- exit `0`, 1/1 in 19.15 s; all 11 sources and Stage-2/3/4 compiler bytes
  remained exact.

No assertion, byte oracle, timeout, or performance gate was weakened. In the
final serial run, whole-template replacement took 22.35 s versus I230's
26.27 s split-template case on the same process, but this single observation
is not a formal performance claim.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `72E43D78B0C6E4F013B0982FFA4313EF9CFE47C46C5EE3EB5FBC8863F622E2C6`
- bootstrap manifest canonical bytes:
  `47654540E13B50115DB99B8595062D179DDCD3CB08BA2EE5DBAA379EAC762E55`
- canonical compiler facade source:
  `AFE8E5A451E7B7B12ED2B37D1C0A05EDA97E764F59A267A1E75DC5692B45921F`
- existing regex capability source:
  `748C91C569CB4E0C19D253F8EBA7B47B403353AB21FEA9539BCCF4B1A2B11DF7`
- I232 acceptance test canonical bytes:
  `A8D68DFD76EB15E8202725B71C199A82AC6DFAC26D3C9D4E1C848159F0AC19CD`
- expanded locked Stage-2 graph test:
  `33F77FA0FBCDAAE63FFBAAF2BD9623CFF1635AA09E7215EB66A82DCFC3F2F0C3`
- expanded locked Stage-1 artifact test:
  `B9C0A1D503CB396C7C3956C0C41BB3236AD7947611E5A7AC51D658FFDAA6AF53`
- strict Stage-0 seed compiler:
  `C6C450DD729F97F43F35067E7E0D4BE216EBD6059BB4B910BD40BCA89ED85336`
- locked x64 runner template:
  `8B501F0F67A5AA20E33F82DA8B1747E498A09BCE2BC2B4AD576A165CA792D039`

## Gate and completion impact

I232 advances ADR 0005 rules 3, 4, and 5: the compiler source now owns locked
x64 code-section discovery and byte-preserving replacement, and its required
byte-regex capability is part of the reproducible source bundle. It does not
yet own PE headers, arbitrary sections, or ELF/Mach-O containers and does not
compile the complete locked compiler graph into a newly encoded Stage 3.

Rules 1, 2, and 7 are established; rules 3, 4, and 5 are partial; rules 6 and
8 remain open. Counting partial rules as one half remains `4.5/8 = 56.25%`,
so the defensible rounded release estimate stays **55%**. The next genuine RED
should replace fixed marker/32-KiB assumptions with compiler-owned PE section
header discovery/encoding, then generalize source symbols and containers
before full-suite equivalence, fallback retirement, and seed-only
toolchain-free rebuild.
