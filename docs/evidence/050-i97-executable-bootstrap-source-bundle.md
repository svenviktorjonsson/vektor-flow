# 050-I97 executable bootstrap source bundle evidence

## Scope

- Base: `56b1193678920f4ff485f138679ccdccdb474073`
- RED: `3d848752245e0cb270b4ba3eb5ebb0b108f45846`
- Implementation: `762fd3e5f9b9af843458cad7afb702b0c08ef66c`
- Branch: `codex/0.5/050-i97-executable-bootstrap-bundle`

I97 expands I95 from one executable compiler-source unit to every source in
the locked bootstrap graph. Internal stage directories now use their unique
manifest index rather than a sanitized full source path, keeping generated
paths bounded on Windows. This changes no language syntax, CLI, manifest
schema, ABI, or public diagnostic.

## TDD evidence

The RED full-bundle acceptance test failed before emission because the old
descriptive stage directory exceeded the Windows path limit. After bounding
stage directories, the test copied the exact locked graph into repo-local
scratch, emitted all ten units in manifest order, verified their PE headers,
and executed each artifact with exit code zero and no output.

Final focused evidence:

- executable ordered source bundle: 1/1 passed in 12267.93 ms;
- executable single-unit and source-graph integrity: 3/3 passed in 814.95 ms;
- the original manifest in the long isolated worktree emitted 10/10 artifacts
  successfully in its declared order.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97. I97 commits are `3d84875`,
`762fd3e`, then this evidence commit. Do not merge or reset the original dirty
I84 worktree.

## Contract hashes

- `vkf_bootstrap_bundle_artifact_smoke.cpp`:
  `6809C1D925E853D3EEC930F736183EEF810370EA43494A0271986089EF0CBD57`
- `stage1-bootstrap-executable-bundle.test.mjs`:
  `A0B51B3E0E16F42B8BD9BB2CE23EFE31E0CADF6CB54C3818281B0DB52E292FDE`
- built `vkf_bootstrap_bundle_artifact_smoke.exe`:
  `9B4396156F7AF41B76FC5CBDE7F8DB672D5BF62A4F675F13237F797C8DE3A234`

Ordered emitted artifact hashes:

1. lexer: `E8EF00F12275BE15E72640C9A0883C2FDD6BB6075B58D5F430FB53601979D43E`
2. parser: `838170AEBA5215752B00926C73DA50F3BB30318931C5B0E53F9DBC1998648B88`
3. typed IR: `408B1E08F17814642F1BD1BB9469E8F26E5F38B128B5694B3D94456BAB269A55`
4. machine IR: `E60796F2326FAC50C591EE48CEAE62937122C0365468F307A6B11C8E1602C307`
5. machine-IR validation: `65FF05BE58C925531CB4F9E647E5ADEE2510DEAF9791A89CCD7A8B6F3AA1ECF5`
6. compiler: `DD8CB15413A21DB068EBF74A2ADBC2755DD734B82B21CF7004FE7A43986F4E18`
7. native scene compiler: `2067934449182427C38E52B006749D63D921DFC574F4BF2F38B15B87954449D1`
8. stdlib: `FCE977B5A40179B0D63119E3EB2747B864439D962C87AFA1620024FA3E0F5384`
9. math: `FE915E0D5E6C74E4C1A8C67255D0F5448E83FB0688AE1109EBFBF91867680B50`
10. I/O: `15E99D5D8B0F68015B0A2DD02F6BDA8E980F0582B9B85547243453CD8F4AC922`

## Acceptance-gate impact

The locked bootstrap graph is now wholly executable as ten ordinary VKF
programs, and no bundle placeholder remains. Per the 0.5 plan, this is not yet
a complete Stage-1 compiler application: the units still do not connect into a
compiler that consumes the locked graph and builds Stage 2. The next packet
must exercise one VKF-authored compiler phase as the producer in that rebuild,
using the existing canonical seam and differential evidence, rather than
renaming these independently executable units as Stage 1.
