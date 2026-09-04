# 0.5 Pages single-Console evidence

Date: 2026-09-04

## Scope

- Base: `949d9e1e0d544bf2189299cffef39be063389c39`.
- Branch: `codex/0.5/browser-readme-single-console`.
- Lane: README-derived, client-only Pages presentation.
- Verified README browser coverage remains `24/26 = 92.3%`; this packet does
  not change which examples the browser compiler supports.

For every currently runnable README VKF fence that has an immediately
associated recorded-stdout block, the rendered inline Console now starts with
that exact text and the duplicate standalone rendered output is consumed.
Unrelated prose and output remain in source order. The unsupported README26
N-body example remains unchanged: its Console starts hidden and its exact-output
evidence remains standalone.

Play continues to execute the current textarea contents. Its existing public
controller replaces the prefilled Console with the new exact output or the
established exact diagnostic; it never appends. Visual Result behavior is
unchanged. No JavaScript execution simulation, fallback, renderer change,
public VKF syntax, semantics, API, schema, ABI, or diagnostic change is present.

## RED -> GREEN

Public document RED:

```powershell
node --test --test-name-pattern="consumes recorded stdout" tests/js/pages-readme-document.test.mjs
```

- RED: exit `1`; the five runnable stdout examples had no inline recorded
  Console content.
- GREEN: exit `0`, `1/1`.

The second public behavior was characterization, not a manufactured RED:

- a prefilled Console is visible before interaction;
- success replaces it with the exact emitted value;
- failure replaces it with
  `unsupported source. No fallback result was rendered.`.

## Regression gates

```powershell
node --test tests/js/pages-readme-document.test.mjs tests/js/pages-documentation-shell.test.mjs tests/js/pages-inline-runner.test.mjs
```

- exit `0`, `37/37`.

```powershell
node --test tests/js/browser-compiler-runtime.test.mjs tests/js/browser-playground-shell.test.mjs tests/js/browser-symbolic-plotter.test.mjs tests/js/pages-documentation-shell.test.mjs tests/js/pages-example-gallery.test.mjs tests/js/pages-inline-runner.test.mjs tests/js/pages-readme-browser-coverage.test.mjs tests/js/pages-readme-document.test.mjs
```

- exit `0`, `73/73`.

```powershell
node --test tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, `2/2`.

```powershell
git diff --check
```

- exit `0`.

Environment: Windows x64, Node `v22.14.0`.

The fresh browser-WASM build, import inspection, and locked Stage-2 fixed-point
remain final integration gates after README26. This presentation worktree does
not contain `build/050-b00/bin/Release/vkf-strict.exe`, so it does not claim
those binary-backed gates.

## SHA-256 receipts

```text
6853A688233E961804581529B339EAFFF120B9DFA9F11FEE4F156DC211DE87F5  tools/build-pages-readme.mjs
6B85CB031B693E01460F0642D3DD81A2C6EA9B758249ADAE58674250181C7DD7  tests/js/pages-readme-document.test.mjs
9A3C516FA6FBA44E5071F166C6081F7B161CA708CCCB85476AC7CBBE4DDD80DD  tests/js/pages-inline-runner.test.mjs
6A484BBDE9024C126DA5C2ECCB3D03C3AFC4C798C3FBF36FD88CFACDD449E9F5  README.md
F95CC4AAE6E4E9364C071B60D46AE1E1E318B40FCCEAC2781543E9B86E28E810  tests/fixtures/pages-readme-browser-coverage.json
```
