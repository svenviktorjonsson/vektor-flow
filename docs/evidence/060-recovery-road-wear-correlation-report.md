# 0.6 recovery — road-wear correlation report

## Scope

- Base: `35000a8ab4f071a0a5cb05b231a7de3b81235476`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores one exact source/test pair from the preserved
  `027-060-mat070c-rough-polarization` untracked-source payload.
- No generated executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered private report consumes the committed
`road-wear-working-set:v1` reference contract. Its exact test proves that the
current road coordinate and wear fields still provide aligned displacement,
roughness, and albedo vectors; canonical coordinate ordering makes reversed
demand bit-identical; and geometry/appearance correlations remain pinned.

Both restored files are byte-identical to the preserved payload. No existing
road coordinate, wear, distribution, or renderer implementation was edited.

## RED / GREEN

- Baseline: road coordinate/wear, conditioned-distribution, and spatial-field
  suites passed 20/20 (exit 0, 317.829 ms) on Node.js 22.14.0 / Windows x64.
- RED: with only the recovered test present,
  `node --test tests/js/vf-road-wear-correlation-report.test.mjs` failed
  because `web/vf-ui/vf-road-wear-correlation-report.mjs` did not exist
  (exit 1, one failed test file, 81.112 ms).
- GREEN: after restoring the exact report module, the same command passed 1/1
  (exit 0, 229.825 ms).

## Regression evidence

```text
node --test tests/js/vf-road-wear*.test.mjs tests/js/vf-road-coordinate-field.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs
```

- 23/23 pass, 0 fail, exit 0, 432.705 ms.
- `git diff --check` is clean.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-road-wear-correlation-report.mjs` | `6cc75eb1c1165247fbb7bc031c231b341782a18c` | `42FBA514C1B3437C80601F84C43B0C70218508CC34826B3E21900AD5E176DC03` |
| `tests/js/vf-road-wear-correlation-report.test.mjs` | `be29e3d9dbed0b1a9836a5ff50228a148704f6bf` | `5FC68AC4C81DB2BCE149950E64D827DC38D7E966E0EF247489B331C2EC09FB4A` |

## Recovery boundary

The original recovery payload remains untouched. This packet reconciles two
of its remaining 66 source files, leaving 64: 61 native material files, two JS
tests, and one web module. The next recovery slice is the six-file road
material-energy CPU/WGSL/native parity group; native LOD and stone dependency
chains remain separate later packets.
