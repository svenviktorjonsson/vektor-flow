# 0.5 Pages 0.4.1 release-copy evidence

Date: 2026-09-04

## Scope

- Base: `af98211217832836acf163b215d1a05e4a52024c`.
- Branch: `codex/0.5/browser-readme-single-console`.
- Lane: README-derived, client-only Pages presentation.
- Verified README browser coverage remains `24/26 = 92.3%`.

This packet reconciles the stale release-candidate and install copy identified
by the handover. The active compiled Windows UI and retained-rendering candidate
is 0.4.1, and the install heading and future release link now name 0.4.1.
Historical 0.4.0 release notes remain unchanged. Every published benchmark
timing remains explicitly attributed to 0.3.0, and the README still promises a
fresh complete benchmark matrix for 0.5.0.

There is no VKF syntax, semantic, API, schema, ABI, diagnostic, compiler,
runtime, renderer, example, or coverage-matrix change.

## Audit boundary

The baseline coverage command passed `22/22`; its measured set remains README
01-10 and 12-25. README26 remains blocked by open `ready-for-human` issue #108,
which has no decision comment. README11 remains blocked by the real resumable
browser-WASM owner-event ABI. The approved `n`/`f` example remains blocked by
the public choices listed in the handover. This release-copy correction is the
only documented independent Pages packet found by the audit.

## RED -> GREEN

```powershell
node --test --test-name-pattern="release scope" tests/js/pages-readme-document.test.mjs
```

- RED: exit `1`, `0/1`; rendered Pages still said
  `The 0.4.0 release candidate adds ...`.
- GREEN: exit `0`, `1/1` in 0.12 s.

The public rendered-document test also locks the 0.4.1 install heading and tag
link, excludes stale 0.4.0 candidate wording, and retains the 0.3.0/0.4.1/0.5.0
benchmark-scope assertions.

## Regression gates

```powershell
node --test tests/js/browser-compiler-runtime.test.mjs tests/js/browser-playground-shell.test.mjs tests/js/browser-symbolic-plotter.test.mjs tests/js/pages-documentation-shell.test.mjs tests/js/pages-example-gallery.test.mjs tests/js/pages-inline-runner.test.mjs tests/js/pages-readme-browser-coverage.test.mjs tests/js/pages-readme-document.test.mjs
```

- exit `0`, `73/73` in 3.44 s.

```powershell
node --test tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, `2/2` in 0.11 s.

```powershell
git diff --check
```

- exit `0`.

Environment: Windows x64, Node `v22.14.0`.

## SHA-256 receipts

```text
C28051EC32CAD49064D42257441E5A49FB25E29040808D1B277349077684B75F  README.md
DBEA44D5EDE723C77A247B200E2A8FC249934591BDA1738E632B7605989BEBF2  tests/js/pages-readme-document.test.mjs
F95CC4AAE6E4E9364C071B60D46AE1E1E318B40FCCEAC2781543E9B86E28E810  tests/fixtures/pages-readme-browser-coverage.json
```
