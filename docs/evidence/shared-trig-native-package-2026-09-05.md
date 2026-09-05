# Trig native package prerequisite

Production selection is unchanged and intentionally RED. This verifies the
compiler-owned code/data packages and calling conventions, **not** final VKF
ELF/PE/Mach-O executable integration or native Windows/macOS process execution.

## Verified

- The same eight licensed candidate C sources build for SysV x64, Windows x64
  and ARM64. Cross-compilation substitutes only freestanding type/float-header
  definitions through the canonical include guard; arithmetic and tables are
  unchanged. Strict flags disable contraction, fast math and host builtins.
- Native packages have no unresolved external symbols or math imports. ELF
  packages permit only read-only allocated `.text`, with code/constants fully
  relocated at zero. The merged Windows package has no import or base-relocation
  directory. Its `_fltused` linker marker is internal read-only data, not CRT
  math. ARM64 reserves x18 and requires page-aligned placement for ADRP accesses.
- **3/3 execution tests** retain exact sine/cosine results for every one of the
  **12,793** frozen candidate inputs. SysV and Windows-ABI code execute under
  Linux at two mapped offsets, consuming the generated header's bytes/entries.
  ARM64 code executes in a freestanding Linux syscall harness under QEMU.
  Exact comparisons preserve signed zero and NaN classification.
- Deterministic regeneration passes `--check`; source/toolchain identity and
  binary hashes are recorded. No original accuracy tolerance was relaxed.

## Reproduce

```sh
docker build -f scripts/trig-toolchain.Dockerfile -t vkf-trig-toolchain:14 scripts
```

Mount this repository at `/src`, working directory `/src`, in that image:

```sh
node tools/build-trig-native-package.mjs
node tools/build-trig-native-package.mjs --check
node --test tests/bootstrap/shared-trig-native-package.test.mjs tests/bootstrap/shared-trig-package.test.mjs tests/bootstrap/shared-trig-candidate.test.mjs tests/bootstrap/wasm-math-kernels.test.mjs
```

Result: **18/18, zero skips** (native package 3, WASM relocation 1, candidate
near-root 1, unchanged existing production numeric kernel gates 13). The frozen
candidate observations must first exist as documented in
`shared-trig-candidate-2026-09-05.md`. No production compiler rebuild occurred.

## Identities

Source/toolchain identity:
`c53b1b2192c2e1caeac2a07afe7c6f34de2f2c690c6ca7ac5f1d525d0c5828fb`.

| Package | SHA-256 |
| --- | --- |
| SysV x64 | `64db8850cc9df1ad79c46befc0c8c0ef5ddb24de32cad7c6101efab4a0cf7a99` |
| Windows x64 | `0a57be9e1636ce29c6ee8b8eee50383c3b8a77bac31c5720ee97384442752f49` |
| ARM64 | `feebe8fb3e7250ccf5a961aa4e5f7a40cbd19bf3bb7ea30970b97ef4e74558e7` |

The ten-site production migration, final target-program execution, exact sine
stdout, fresh native 451/451, unchanged non-math/full WASM gates and reviewed
downstream identities remain required. This packet makes no performance claim.
