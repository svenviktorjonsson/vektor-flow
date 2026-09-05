# 0.6 recovery — road material-energy parity

## Scope

- Base: `26b8b605dd0e2b1fc44b8e40297f12c3ee4fcf2c`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores the exact six-file JS, WGSL, and native road material-energy parity
  group from the preserved `027-060-mat070c-rough-polarization` untracked-
  source payload.
- No recovered executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered private white-furnace references consume the committed road
coordinate, construction, wear, and water working-set contracts. The JS oracle
proves aligned borrowed coordinates, bounded sampling, passive RGB energy, and
water-conditioned Fresnel response. WGSL and native references preserve the
same explicitly ordered f32 arithmetic and pinned output values.

All six restored files are byte-identical to the preserved payload. No existing
road field, renderer, distribution, or public package implementation was
edited.

## Vertical RED / GREEN cycles

Baseline road coordinate/construction/wear/water suites passed 6/6 (exit 0,
138.558 ms) on Node.js 22.14.0 / Windows x64.

1. JS CPU reference
   - RED: `node --test tests/js/vf-road-material-energy.test.mjs` failed with
     `ERR_MODULE_NOT_FOUND` for `vf-road-material-energy.mjs` (exit 1,
     99.336 ms).
   - GREEN: the same command passed 1/1 (exit 0, 149.647 ms).
2. WGSL reference
   - RED: `node --test tests/js/vf-road-material-energy-wgsl.test.mjs` failed
     with `ENOENT` for `vf_road_material_energy.wgsl` (exit 1, 104.366 ms).
   - GREEN: the same command passed 1/1 (exit 0, 119.668 ms).
3. Native reference
   - RED: MSVC compilation of `vf_road_material_energy_test.cpp` failed with
     `C1083` because `vf_road_material_energy.hpp` did not exist (nonzero exit,
     4.2 s).
   - GREEN: MSVC 19.44.35217 x64 compiled the exact recovered test and header
     with `/std:c++20 /EHsc`; execution printed
     `native road material energy parity passed` (compile and run exit 0).
   - The first GREEN compile attempt wrote its object beside the source and was
     rejected by the workspace sandbox. Directing `/Fo` and `/Fe` to the
     temporary directory corrected only the harness destination; source and
     assertions were unchanged.

## Regression evidence

```text
node --test tests/js/vf-road-material-energy*.test.mjs tests/js/vf-road-water*.test.mjs tests/js/vf-road-wear*.test.mjs tests/js/vf-road-construction-field.test.mjs tests/js/vf-road-coordinate-field.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs
```

- 30/30 pass, 0 fail, exit 0, 439.912 ms.
- Full JS T1 retains exactly the three already documented unrelated failures:
  stale generated HTML catalog, one scoped-symbolic sign assertion, and one
  symbolic literal-geometry endpoint assertion. Neither recovered energy test
  failed.
- `git diff --check` is clean.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-road-material-energy.mjs` | `85c4f8db2d6f51c4ea570e8d02d5f91df8d9a752` | `8DBAE935E5075CC473CF4C81BA503D0495350539C05429D7E0101306428A29E5` |
| `tests/js/vf-road-material-energy.test.mjs` | `98cc4e0bd3c956348db410ab0c91d4065aa16c97` | `36B91CC20667D96DE8254226BF24D012B107C02ADC799709C915287E542B836C` |
| `native/material/vf_road_material_energy.wgsl` | `337b8fb54f7a2db37fd38122cadf528e44f7f2b6` | `82BC224E8087B488B8A15B5797287004A7B7DA5353A39B9A22465ED30DC3997B` |
| `tests/js/vf-road-material-energy-wgsl.test.mjs` | `8ac662925a8a815ba6b7a059c380eec0f20446a8` | `FA5C81C23E7564C7C7E771702EDE787D2A989522175B970660CD98170C71DFF1` |
| `native/material/vf_road_material_energy.hpp` | `e936e5e947c4d75047c86eb397e5ae8845de0276` | `99B583A47DF9CB77101EAD665D421C1F83D92C611B864513853288EF92E991CC` |
| `native/material/vf_road_material_energy_test.cpp` | `db3e9ef33aa28f5e80cfc99fe1fdafdc08cd650a` | `17F1CE86D735C5F38D2A70E0BA3EEADB6A581A026B6EE93CED52D359354F2014` |

The temporary x64 test executable is 231,936 bytes with SHA-256
`7808628EAFBD55B5DCC6194191CFE018218612BBA8AE316045ECAEDE998C8772`;
it is outside the repository and is not part of recovery or this packet.

## Recovery boundary

The original recovery payload remains untouched. This packet reconciles all
six non-native-chain files remaining from the previous boundary. Fifty-eight
native material source/test files remain. The next independent vertical slice
is the self-contained road projected-LOD header/test pair, followed by its
working-set and transition dependents.
