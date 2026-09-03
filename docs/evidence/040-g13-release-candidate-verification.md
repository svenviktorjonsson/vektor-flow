# 040-G13 release-candidate verification

## Handoff

- packet: `040-G13`
- branch: `codex/0.4/040-g13-rc-verify`
- artifact source head: `b9789f0`
- verification head: `33caeee`
- public VKF syntax/API/schema/ABI/diagnostics: unchanged
- UI/browser execution: hidden/off-screen only

## Exact Windows x64 artifacts

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `build/g13/compiler/vkf-strict.exe` | 5,867,008 | `b84b3bcd534201876b0fc6432f76e9daf0221ad13766afbf506b8f6ba50faaf7` |
| `build/g13/ui/vkf-runner.exe` | 4,304,896 | `fc33e6c411221604ee93f12b77defc38e1648c822be68e953dc7d7fc5aac8272` |
| `build/g13/ui/vkf-ui-package.exe` | 4,304,896 | `3f8b9782ac4e85a295da9a1d648fb4f3e16f073e1f4a5b0676964111fc61aba0` |
| `build/g13/ui/vkf-native-scene-artifact-stager.exe` | 1,672,704 | `7c2174034b01ae10b45cec19f8af8a0ff498d7b9018a2a34f1ad78e808af2918` |
| `build/g13/release/vektor-flow-windows-x64.zip` | 5,141,345 | `252949f7f07dd0d5c4905a723fc3c28385bc3f2aa75e03753d14238f9cce7ebf` |

The packaged compiler reports `VKF 0.4.0`. Packaging compiled and executed
console, named-output, test, IO, read-line, collections/errors, system,
process, regex and static HTML/CSS UI smoke programs. The packaged UI smoke
opened hidden, relocated without sidecars, then opened the relocated copy
hidden.

## Closure and test gates

| Gate | Result |
| --- | --- |
| compiler/native language | 451 passed, 0 failed |
| source stdlib | 442 passed, 0 failed |
| Windows platform | 1 passed, 0 failed |
| native/WASM parity | 11 cases, 10 identical repetitions per target |
| npm package | 5 passed, 0 failed |
| isolated completed portable archive | 3 passed, 0 failed |
| symbolic benchmark harness | 6 passed, 0 failed |
| linear-algebra benchmark harness | 8 passed, 0 failed |
| large-scene benchmark harness | 41 passed, 0 failed |
| portable source/link/import closure | passed |
| empty-`PATH` relocation probe | passed |
| hidden loaded-module trace | four launches, zero forbidden external modules |

The closure probe found no bundled native library, toolchain executable or
SDK. Compiler and generated console imports were the expected system runtime;
the thin UI executables imported only their Windows allowlist. Both UI link
maps contained zero forbidden semantic objects.

The initial loaded-module trace killed the full UI compilation at the ordinary
two-second runtime sampling deadline. `aa6265e` adds a separate bounded compile
deadline and waits for compilation to finish while retaining the short sampling
window for runtime processes. Its focused dependency-closure suite passes 5/5,
and the real hidden module trace then passed. `33caeee` makes the deterministic
linear-algebra manifest checker newline-stable on Windows; it does not weaken
fixture byte or hash checks.

## Fresh linear-algebra performance gate

The pinned Eigen 5.0.0, faer 0.24.4 and SciPy 1.16.3 peers ran with one thread,
100 accepted samples per row and numerical correctness before timing. Every
VKF/peer ratio passed the strict `<1.5x` release gate:

| Kernel | VKF/Eigen | VKF/faer | VKF/SciPy |
| --- | ---: | ---: | ---: |
| solve-general-96 | 0.731 | 0.659 | 0.678 |
| least-squares-tall-96x48 | 0.704 | 0.410 | 0.576 |
| lu-general-96 | 0.622 | 0.470 | 0.667 |
| qr-tall-96x48 | 0.311 | 0.266 | 0.454 |
| cholesky-spd-96 | 0.800 | 0.800 | 1.130 |
| svd-tall-96x48 | 0.294 | 0.577 | 0.544 |
| eigen-symmetric-96 | 1.076 | 0.983 | 1.310 |

The raw JSON evidence SHA-256 is
`1d3d0daa66a2aa15ec3eca78c54814cbe8ef9762e63aa384337e982d205f1f8a`;
the generated Markdown SHA-256 is
`ce38b358c4536a8b6120e1b9961cfb6f47731a850dd6966339899030d86a7d04`.

## Local limits

- No installer was produced locally because `makensis.exe`/NSIS is absent on
  this host. The release workflow installs NSIS before the installer step, so
  this is an environment prerequisite rather than a package failure.
- The `b9789f0` source matrix retained the pre-regeneration cloud-indicator
  artifact and therefore reported 19/20. The later integration regeneration
  supersedes that base-only evidence mismatch; it does not affect these binary,
  package, native, stdlib, WASM or benchmark results.
