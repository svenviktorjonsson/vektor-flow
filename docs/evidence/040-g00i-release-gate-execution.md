# 0.4.0 G00I release-gate execution

- Recorded: 2026-08-31T13:12:00+02:00
- Base: `360a226e5764a9eeb2d050fdcd0d95d118cff0a4`
- Branch: `codex/0.4/040-g00i-release-gate-execution`
- Implementation: `3cef0f9bbca862610e356e6840ec069048856ac1`
- Integration follow-up: `688c3e41cdf45a1273e9421d201172eace7d0fab`
- Implementation tree: `a756b503f259fff491dcf5eaf3eb2170484a3105`
- Environment: Windows x64, Node.js v24.11.0, MSVC, CMake, Ninja 1.12.1

## Broad release matrix

The next broadest trustworthy non-destructive matrix after the existing full
JavaScript baseline was executed before selecting a repair:

| Gate | Result |
| --- | --- |
| `npm run test:package` | 5/5 passed |
| clean native compiler targets | passed |
| `vkf-strict.exe -t tests/vkf` | 451/451 passed |
| `vkf-strict.exe -t tests/stdlib` | 442/442 passed |
| `npm run test:stdlib-wasm` | all 11 cases passed, 10 native and 10 WASM runs per case |
| Windows linalg factor test | passed |
| `vkf-strict.exe -t tests/platform/windows` | 1/1 passed |

The native stdlib run took about 82 minutes but remained CPU-active and was
allowed to complete without retries. These results are execution evidence,
not an estimate derived from test counts.

## First failing gate and RED evidence

The next UI package configure command failed before compilation:

```text
cmake -S native/VfOverlay -B build/vf-overlay -A x64
```

MSBuild FileTracker reported `FTK1011` while creating a `.tlog` below CMake's
compiler-probe scratch tree. The observed failing path was 274 characters,
beyond the legacy Windows/MSBuild path boundary. This classified the failure
as release build orchestration on an isolated deep worktree, not a native UI
regression.

The focused test was written first and failed because the build helper did not
exist:

```text
node --test tests/js/native-ui-package-build-helper.test.mjs
```

Result: exit 1, helper exit status 64.

## GREEN implementation

`scripts/build-native-ui-package.ps1` now:

- keeps all build output inside the repository at `build/v`;
- enters the installed MSVC x64 environment;
- uses Ninja instead of MSBuild FileTracker;
- uses the repository's Windows 8.3 short path for CMake source and build
  arguments;
- requires Ninja 1.11 or newer for Windows long-path support; and
- downloads official Ninja 1.12.1 only when required, verifying the pinned
  archive SHA-256 before extraction.

The native release workflow calls this helper and passes its matching UI
binary directory to the existing portable packager. No VKF syntax, semantic,
public API, schema, ABI, scene, renderer, or shader contract changed.

Focused verification:

```text
node --test tests/js/native-ui-package-build-helper.test.mjs
```

Result: 1/1 passed. The test synthesizes a deterministic 321-character
FileTracker scratch path, independent of checkout location, then proves the
helper selects Ninja, uses the short repository path, and avoids FileTracker.
This follow-up was first reproduced RED in the shorter integration worktree,
where the old checkout-derived assertion measured 249 characters.

Real native UI build:

```text
.\scripts\build-native-ui-package.ps1
```

Result: configure passed; all 40 build steps passed; 50 embedded UI assets
were generated; `vkf-ui-package.exe`, `vkf-runner.exe`, and
`vkf-native-scene-artifact-stager.exe` were produced. No browser was launched.

Full affected JavaScript verification:

```text
npm test
```

Result: 388/388 passed, 0 failed. `git diff --check` also passed.

## Output hashes

| Output | SHA-256 |
| --- | --- |
| `build/v/vkf-ui-package.exe` | `7a217e1d3dfdfaa3b53187b175e001b94a7a381ee410af3be1a21a883ffc4a30` |
| `build/v/vkf-runner.exe` | `575616ea72c29e0470e108b54b32edd0e1afccd51741c43f641079554ac828ef` |
| `build/v/vkf-native-scene-artifact-stager.exe` | `22acda312c4dfd28e439761bd15797d01a4c6d8b401285415367fe7cc7bbeff1` |

## Next distinct failing gate

With the first failure removed, portable packaging advanced into its existing
smoke test and then failed during cleanup:

```text
.\scripts\package-native-release.ps1 -Version 0.4.0-dev -UiBinaryDirectory build/v
```

`Remove-Item` could not remove
`dist/releases/.s/r/renamed.exe.WebView2/EBWebView/lockfile` because the smoke
process still held it. No matching test-owned process remained after the
failed command was inspected. This is a separate lifecycle/cleanup defect and
is the next executable release-gate packet; it is not hidden by this receipt
or mixed into the deep-path repair.

## Source hashes

| Source | Git blob | SHA-256 |
| --- | --- | --- |
| `.github/workflows/native-release.yml` | `57d17e92b55bbccfcdf70d47d11435ee2c8dad56` | `b7ab274f65c9299b026416755b6b83f870b96035add59e2b5f855ba0aaa88880` |
| `scripts/build-native-ui-package.ps1` | `0444b95e046f771ea395e4eb8718e5ae7c84e5f8` | `3591fb659314cc3c6528d4cf019ed7983c556a5391ce6b9426655bf79216a29c` |
| `tests/js/native-ui-package-build-helper.test.mjs` | `da99ee7a5cab4b5212e7b884898f6ff6f312f5c0` | `f19b77b74512248ec0a981a92d94cf9786d6800671483a8b910fb78082f0a49f` |
