# 0.6 recovery — forest hierarchy report

## Scope

- Base: `8084c227287205e0de542fadc2137fc254b3fb32`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores one exact source/test pair from the preserved
  `027-060-mat070c-rough-polarization` untracked-source payload.
- No generated executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered private report consumes the committed
`forest-patch-working-set:v1` reference contract. Its exact test proves that
the current forest population still supplies aligned `Uint32Array` species
indices and four-float growth records, that reversed patch demand produces an
identical report, and that species-conditioned height variation remains pinned.

Both restored files are byte-identical to the preserved payload. No existing
forest population or distribution implementation was edited.

## RED / GREEN

- Baseline: forest population, conditioned-distribution, and spatial-field
  suites passed 21/21 (exit 0, 334.240 ms) on Node.js 22.14.0 / Windows x64.
- RED: with only the recovered test present,
  `node --test tests/js/vf-forest-hierarchy-report.test.mjs` failed because
  `web/vf-ui/vf-forest-hierarchy-report.mjs` did not exist (exit 1, one failed
  test file, 88.191 ms).
- GREEN: after restoring the exact report module, the same command passed 1/1
  (exit 0, 165.055 ms).

## Regression evidence

```text
node --test tests/js/vf-forest*.test.mjs tests/js/vf-marked-point*.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs
```

- 31/31 pass, 0 fail, exit 0, 1.250 s.
- `git diff --check` is clean.
- Full JS T1 rerun includes the new focused test and retains exactly the three
  previously documented unrelated failures: stale generated HTML catalog, one
  scoped-symbolic sign assertion, and one symbolic literal-geometry endpoint
  assertion. No forest, distribution, marked-point, or spatial test failed.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-forest-hierarchy-report.mjs` | `47631c0a4824147e85356ba304906c59731b2fa1` | `7EEDDFA4F38704970F4541CC6CF17F2353D13013D35CAE26B417A9E1CE3A23D5` |
| `tests/js/vf-forest-hierarchy-report.test.mjs` | `5bce5aa11ba616a1fb134f28d511254408e4933c` | `8746ECB628D84408CA9066672EFD91D6BAE2CED21D539B5A5BD372E1448C9CF8` |

## Recovery boundary

The original recovery payload remains untouched. This packet reconciles two
of its remaining 70 source files, leaving 68: 61 native material files, four
JS tests, and three web modules. The next independent recovery packet is the
stone-family hierarchy report; road material energy and native dependency
chains remain separate later packets.
