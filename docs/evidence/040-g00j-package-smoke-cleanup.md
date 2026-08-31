# 0.4.0 G00J portable-package smoke cleanup

- Recorded: 2026-08-31T14:05:00+02:00
- Base: `a0237e8`
- Branch: `codex/0.4/040-g00j-package-smoke-cleanup`
- Implementation: `6d66a49c33c691a4d8e7d14f1d7a690de69885b4`
- Implementation tree: `7548758fa6093bd0e4b08ecfaa6a6a27e3d5b181`
- Environment: Windows x64, Node.js v24.11.0, PowerShell 7, WebView2

## RED evidence and classification

The prior release-gate run built and launched the relocated packaged UI, then
failed at final smoke-root cleanup because this test-owned file remained
locked:

```text
dist/releases/.s/r/renamed.exe.WebView2/EBWebView/lockfile
```

The smoke script force-stopped `renamed.exe`, waited only for that parent
process, and immediately removed the containing root. WebView2 child handles
can release the executable-adjacent profile after the parent wait completes.
No user browser profile was involved.

The new focused suite was run before implementation and failed 3/3 because
the lifecycle helper and its packaging wiring did not exist. Its cases pin a
real exclusive file lock, root ownership, and hidden process cleanup.

The first full package rerun also exposed a bounded shutdown race: the UI can
exit between the stay-running check and helper inspection, leaving no readable
process path. The helper now validates executable identity only before it
terminates a live process. An already exited process requires no termination;
its profile remains subject to the same isolated-root validation and bounded
removal.

## GREEN behavior

The internal lifecycle helper now:

- resolves and validates every removable path beneath its declared smoke root;
- asks the exact smoke UI process to close and waits up to five seconds;
- only if necessary, force-stops the exact validated PID and its test-owned
  child tree, then waits up to ten seconds;
- never searches for or terminates Edge/WebView2 by process name;
- retries profile removal for a bounded ten-second window; and
- fails with the remaining lock error if cleanup cannot complete, rather than
  hiding a persistent leak.

Both UI smoke launches use hidden window style. No visible browser or UI
window is an accepted verification mode. This packet changes no VKF syntax,
semantics, public API, schema, ABI, scene, renderer, or shader contract.

## Verification

Focused command:

```text
node --test tests/js/native-release-smoke-lifecycle.test.mjs
```

Result: 4/4 passed. A PowerShell process held the exact profile-style lock with
exclusive sharing for 750 ms; cleanup waited and then removed it. A path
outside the smoke root was rejected and its user-owned file remained intact.

Real portable package command:

```text
.\scripts\package-native-release.ps1 `
  -Version 0.4.0-g00j `
  -UiBinaryDirectory build/v `
  -OutputDirectory build/g00j-package
```

Result: passed. The relocated UI stay-running proof and all seven installed
stdlib smoke tests passed. `build/g00j-package/.s` was absent afterward, no
test-owned process remained, and no visible window was launched.

Full JavaScript command:

```text
npm test
```

Result: 392/392 passed, 0 failed. `git diff --check` also passed.

## Artifact

| Output | SHA-256 |
| --- | --- |
| `build/g00j-package/vektor-flow-windows-x64.zip` | `3640377b464c8ce4c1904c53d4eba1538d8586e56176016179aaf93433cdeda4` |

## Source hashes

| Source | Git blob | SHA-256 |
| --- | --- | --- |
| `scripts/package-native-release.ps1` | `0b8b2951fed2d416eb40f254fc4cac9952d9a8d7` | `c4625bcf40aaf8a86beb148a7b862eda9a642d85c2b80551d84f0cda4eae5cfc` |
| `scripts/internal/native-release-smoke-lifecycle.ps1` | `e88f132c333de61415eb99b005c1705c973d4d44` | `c44c41762aeefa878365f57d60c70cefe751e7c5f370e268b4ccb105156a0e8d` |
| `tests/js/native-release-smoke-lifecycle.test.mjs` | `287045c2ae6eb6da5b98c9fe126b749e4f3a246d` | `424559fc3b55e9e165d95df562d1e39293dcde25b37626ce0f43ad87911b5a4d` |
