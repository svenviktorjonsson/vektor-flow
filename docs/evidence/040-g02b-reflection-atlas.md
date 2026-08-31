# 040-G02B reflection atlas evidence

- Packet: `040-G02B`, 0.4 GFX-040
- Base: `448ce5154aef98528ee43cb76f772984031837c4`
- Branch: `codex/0.4/040-g02b-reflection-atlas`
- Environment: Windows NT 10.0.26200.0, Node.js v24.11.0
- Scope: internal logical atlas allocation/cache and reflection-planner
  composition; no public VKF API and no renderer wiring

## Slice 1: bounded stable atlas

- RED command: `node --test tests/js/vf-reflection-atlas.test.mjs`
- RED exit/duration: 1 after 0.15 s
- RED result: `ERR_MODULE_NOT_FOUND` for the not-yet-created atlas module
- GREEN command: `node --test tests/js/vf-reflection-atlas.test.mjs`
- GREEN exit/duration: 0 after 0.14 s; 4 tests passed
- Commit: `89393c2 feat(graphics): add bounded reflection atlas`
- Committed test Git blob: `5cc3dd14a7515fbe44db88763bbf37791ba1ca7f`
- Committed module Git blob: `fc1ff84a6aa9a14bc7a3e1a8d17755d1b6df6de8`

Observable evidence:

- identical content and size reuse the same slot without a capture;
- changed provenance or size invalidates content but preserves the slot;
- capture and pixel budgets are never exceeded; and
- requests that cannot fit are returned with deterministic `pixel-budget` or
  `capture-budget` reasons rather than throwing.

## Slice 2: planner composition and provenance

- RED command: `node --test tests/js/vf-reflection-atlas-planner.test.mjs`
- RED exit/duration: 1 after 0.10 s
- RED result: planner did not export `planReflectionAtlas`
- GREEN command: `node --test tests/js/vf-reflection-atlas-planner.test.mjs tests/js/vf-reflection-atlas.test.mjs tests/js/vf-reflection-planner.test.mjs`
- GREEN exit/duration: 0 after 0.29 s; 13 tests passed
- Commit: `da3b094 feat(graphics): connect reflection atlas plan`
- Planner-consumer test Git blob: `6432779d722e729ea5d0b9da49e3a9517d0ac577`
- Pre-slice planner Git blob: `aa7f778cb026fc5330277c5dcd1dbb9986c43e2e`

The planner requires a caller-supplied capture revision containing camera/scene
provenance. Reordered jobs with the same revision reuse stable slots; a changed
revision invalidates those slots. Omitting provenance fails before cache reuse.

## Acceptance-scale robustness

- Focused command: `node --test tests/js/vf-reflection-atlas-planner.test.mjs tests/js/vf-reflection-atlas.test.mjs tests/js/vf-reflection-planner.test.mjs`
- Exit/duration: 0 after 0.48 s; 14 tests passed
- 4,096 faceted requests allocate exactly 32 captures and 16,777,216 pixels;
  the other 4,064 requests report deterministic overflow.
- Final SHA-256 hashes:
  - atlas tests: `9c31f4bf33be7625b024ef202b76797d9df70bc913623598dd2f137642417f54`
  - planner-consumer tests: `4415fe4551f26b05f107be144e3f97ed23ed20d29d68ed35cd8b5f31c76f2514`
  - atlas module: `1f0742279d8ed29fbfcce78a003d350287596236b3695ca59b8b1b1c92634fdc`
  - reflection planner: `6de6c06285d3cc32da8dba2b48cca7ff429222b16b1ffa07a6f06649a3b9d8b4`
- Binary/artifact hash: not applicable; pure JavaScript modules

## Slice 3: bounded inactive cache

- RED command: `node --test tests/js/vf-reflection-atlas.test.mjs`
- RED exit/duration: 1 after 0.24 s; inactive mirror slot was discarded
- GREEN command: `node --test tests/js/vf-reflection-atlas-planner.test.mjs tests/js/vf-reflection-atlas.test.mjs tests/js/vf-reflection-planner.test.mjs`
- GREEN exit/duration: 0 after 0.50 s; 15 tests passed
- A temporarily culled mirror retains its slot and capture only when both slot
  and resident-pixel budgets permit it.
- Active work has priority; shrinking either budget deterministically evicts
  inactive history before admitting work beyond the limit.

## Broader regression receipt

- Command: `npm test`
- Exit/duration: 1 after 12.31 s; 350 passed and 3 failed
- Every reflection planner/atlas test passed in the complete process.
- The three failures reproduce integration-base mismatches outside all owned
  paths: generated HTML component catalog, symbolic document scope, and
  symbolic named function/constant geometry.

## Handoff

- Owned paths: `web/vf-ui/geom/vf-reflection-atlas.mjs`,
  `web/vf-ui/geom/vf-reflection-planner.mjs`, both reflection-atlas test files,
  and this receipt.
- Protected path `web/vf-ui/geom/vf-geom-wgpu.js` was not edited.
- Recovery: both modules are pure and unwired; reverting the packet cannot
  alter current rendered output.
- Next packet may map logical slot IDs and pixel capacities onto physical atlas
  texture regions behind the existing renderer seam.
