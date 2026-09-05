# 0.6 recovery — stone-family hierarchy report

## Scope

- Base: `6ea232f8ede35769c049c0508e069fab62ed7b25`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores one exact source/test pair from the preserved
  `027-060-mat070c-rough-polarization` untracked-source payload.
- No generated executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered private report consumes the committed
`stone-family-patch-working-set:v1` reference contract. Its exact test proves
that the current stone-family population still supplies aligned patch and
family records, that reversed patch demand produces an identical report, and
that patch-conditioned family affinity remains pinned.

Both restored files are byte-identical to the preserved payload. No existing
stone population, conditioned distribution, or marked-point implementation was
edited.

## RED / GREEN

- Baseline: stone-family population, conditioned-distribution, and spatial-
  field suites passed 21/21 (exit 0, 311.128 ms) on Node.js 22.14.0 / Windows
  x64.
- RED: with only the recovered test present,
  `node --test tests/js/vf-stone-family-hierarchy-report.test.mjs` failed
  because `web/vf-ui/vf-stone-family-hierarchy-report.mjs` did not exist
  (exit 1, one failed test file, 87.375 ms).
- GREEN: after restoring the exact report module, the same command passed 1/1
  (exit 0, 149.434 ms).

## Regression evidence

```text
node --test tests/js/vf-stone-family*.test.mjs tests/js/vf-marked-point*.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs
```

- 31/31 pass, 0 fail, exit 0, 1.263 s.
- `git diff --check` is clean.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-stone-family-hierarchy-report.mjs` | `ef03e9e052cae3d802c15ec73473553f6ffa5681` | `D735AF47D2C3B11FBD40DF937234F51D8B4B6E80BB116ED8D23CBE06BBBF7967` |
| `tests/js/vf-stone-family-hierarchy-report.test.mjs` | `c58414691f5e7e9640fc3d6b520c3656ce9e2d8c` | `A6E42CDE8E1B6BB14442D6DC4000831BE480332100C5704CC59549DB6D4B3A0C` |

## Recovery boundary

The original recovery payload remains untouched. This packet reconciles two
of its remaining 68 source files, leaving 66: 61 native material files, three
JS tests, and two web modules. The next independent recovery packet is the
road-wear correlation report; road material energy and native dependency
chains remain separate later packets.
