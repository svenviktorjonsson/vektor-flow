# 0.6 recovery — retained road-water renderer packets

## Scope

- Base: `36c28b440fd392e57c04f515de95840d4c48277a`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores one exact two-file source/test pair from the preserved
  `027-060-mat070c-rough-polarization` untracked-source payload.
- No generated executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered adapter consumes the already committed private MAT060 contracts:

- `road-wear-renderer-packets:v1` and `road-refinement-working-set:v1`;
- the existing wear and water reference fields;
- the existing retained `field_mesh` packet layout and typed-array buffers.

The focused test passed without editing the recovered files, proving that their
imports, packet kinds, field names, typed-array widths, retention identity, and
upload accounting still match the current branch. The restored files are
byte-identical to the preserved payload.

The payload originally contained 72 source files. This packet restores two,
leaving 70 preserved files: 61 native material files, five JS tests, and four
web modules. The remaining dependency order is:

1. independent forest, stone-family, and road-wear report pairs;
2. the road material-energy CPU/WGSL/native parity group;
3. the road projected-LOD and transition chain;
4. the native stone coarse-shape/refinement/projected-demand chain;
5. stone hierarchical population/material/residency/camera composition; and
6. shared hierarchical-field and deterministic-packet helpers immediately
   before their first consumers.

Each group remains in recovery until it receives its own RED/GREEN packet.

## RED / GREEN

- Baseline: the existing road water, wear-packet, and refinement suites passed
  6/6 (exit 0) on Node.js 22.14.0 / Windows x64.
- RED: with only the recovered focused test present,
  `node --test tests/js/vf-road-water-renderer-packets.test.mjs` failed because
  `web/vf-ui/vf-road-water-renderer-packets.mjs` did not exist (exit 1, one
  failed test file, 84.794 ms).
- GREEN: after restoring the exact recovered adapter, the same command passed
  1/1 (exit 0, 109.867 ms).

## Regression evidence

```text
node --test tests/js/vf-road*.test.mjs tests/js/vf-procedural-road*.test.mjs tests/js/vf-procedural-material-scene-frame.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs
```

- 58/58 pass, 0 fail, exit 0, 648.970 ms.
- `git diff --check` is clean.
- Full `npm test` completed 647 tests: 644 pass and three unrelated existing
  gates fail (`vf-html-component-catalog-generated`, one scoped symbolic sign
  assertion, and one symbolic literal-geometry endpoint assertion). This packet
  changes none of those generators, symbolic modules, or tests; the complete
  focused road/material regression above remains green.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-road-water-renderer-packets.mjs` | `d0a2d64c0a023a6e05300b3d69cc3faf40cf843f` | `672EEDE852E8B79C303C628CBB13EC055A67C73A347ED59A4E80EB62E4877AB0` |
| `tests/js/vf-road-water-renderer-packets.test.mjs` | `b4d46c9653aefec9476f397173aaab1ce4d17457` | `3A50B0DF294AD7BA3472D5108A14FA90A757B470B2060A4EAA0B3043BDF92C08` |

## Acceptance and recovery

This packet preserves the recovered retained water composition in Git and
advances the private road tracer from wear-only packets to shared standing-
water geometry and lighting truth. It does not yet insert water packets into
the procedural road scene, establish public author controls, or claim release
completion. Recovery is `git revert` of this packet commit; the original
recovery payload remains untouched until all preserved source is independently
reconciled.
