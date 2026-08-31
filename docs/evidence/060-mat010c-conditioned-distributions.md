# 060-MAT010C conditioned-distribution evidence

- Packet: `060-MAT010C`, 0.6 MAT-010
- Base: `10c2eab2450806edb9e3bd0bd33babfbe4711628`
- Branch: `codex/0.6/060-mat010c-conditioned-distributions`
- Environment: Windows NT 10.0.26200.0, Node.js v24.11.0
- Scope: smallest internal hierarchical conditioned-distribution reference;
  no VKF syntax, public API, schema, runtime, renderer, or material hookup

## Internal seam

- `createConditionedRoot(identity)` takes a defensive snapshot and compiles the
  MAT010A demand stream.
- `conditionChild(parent, { segment, channel })` appends exactly one explicit
  hierarchy segment while retaining generator, version, seed, domain, and LOD.
- Parent and child snapshots, seeds, and hierarchy paths are frozen. Compiled
  stream state is held privately and has no mutable cursor.
- `sampleBoundedUniform` maps lane zero as `u32 / 2^32`, then applies finite
  `min + (max - min) * u`; its reference interval is `[min, max)`.
- `sampleNormalReference` applies the cosine Box-Muller transform to Philox
  lanes zero and one. This JavaScript `Math` result is the CPU numerical oracle,
  not a claim of bit-identical GPU transcendental results.

## RED/GREEN slices

All focused cycles used:
`node --test tests/js/vf-conditioned-distribution.test.mjs`.

1. Immutable child and bounded uniform
   - RED: exit 1; `vf-conditioned-distribution.mjs` did not exist.
   - GREEN: exit 0; the frozen child path and bounded-uniform reference matched.
   - Commit: `11100d3 feat(random): add conditioned uniform seam`
2. Normal reference distribution
   - RED: missing `sampleNormalReference` export.
   - GREEN: the hierarchy-derived sample matched the pinned Box-Muller oracle.
   - Commit: `913a88f feat(random): add normal reference transform`
3. Conditioning and independence
   - GREEN characterization: recreated parents reproduce their child; changed
     parent seed and sibling segment change it; sampling either unrelated branch
     does not perturb the observed target.
   - Reverse traversal and uneven 3/16/13 chunks reproduce 32 uniform/normal
     sample pairs exactly.
   - Commit: `0622c45 test(random): prove conditioned independence`
4. Explicit transform oracle
   - RED: missing `normalReferenceFromU32` export.
   - GREEN: raw Philox lanes and hierarchy sampling reach the same numerical
     result through one transform implementation.
   - Commit: `acc2417 refactor(random): expose normal u32 oracle`

## Pinned numerical oracles

For hierarchy
`environment:alpine/species:grass/instance:17`, channel `blade-height`, and
sample counter `3:0`, Philox begins with `8a27a5d3 50fb04ea`.

- Bounded uniform `[-2, 5)`:
  `-2 + 7 * (0x8a27a5d3 / 2^32) = 1.7776723366696388`.
- Normal with mean 10 and standard deviation 2.5:
  `u1 = (0x8a27a5d3 + 0.5) / 2^32`,
  `u2 = 0x50fb04ea / 2^32`, and
  `10 + 2.5 * sqrt(-2 ln(u1)) * cos(2 pi u2) = 8.875981430658127`.

## Test receipts

- Focused MAT010A/B/C command:
  `node --test tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-demand-random.test.mjs tests/js/vf-demand-random-wgsl.test.mjs`
- Exit/duration: 0 after 0.92 s; 20 tests passed.
- Full command: `npm test`
- Exit/duration: 1 after 21.57 s; 393 passed and 3 failed.
- Every MAT010A, MAT010B, and MAT010C test passed in the complete process.
- The three failures reproduce integration-base mismatches outside all owned
  paths: generated HTML component catalog, symbolic document scope, and
  symbolic named function/constant geometry.

## Handoff

- Owned paths: `web/vf-ui/vf-conditioned-distribution.mjs`,
  `tests/js/vf-conditioned-distribution.test.mjs`, and this receipt.
- SHA-256:
  - module: `b34826eee5d284817bd5669d3360e846d485242cd08b6e0a1294ff8427a27ab9`
  - tests: `ebec28b8e9665b89b4fcf6fe501b5df1baf510348425067ab5f75925724ce6e7`
- Git blobs:
  - module: `f85fb72ed90991949cd53ab627684673f40ac319`
  - tests: `e06a13c52ab324273f0b6fe186161b3ec3d3ceed`
- Recovery: the module is internal and unwired. Reverting the packet cannot
  alter current rendering, material output, or VKF behavior.
