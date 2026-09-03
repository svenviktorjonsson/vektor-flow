# 040-G02 reflection planner evidence

- Packet: `040-G02`, 0.4 GFX-040
- Base: `a15e166`
- Branch: `codex/0.4/040-g02-reflection-plan`
- Environment: Windows NT 10.0.26200.0, Node.js v24.11.0
- Scope: pure internal planar-facet clustering and budget scheduling; no public
  VKF API and no renderer wiring

## RED receipt

- Time: 2026-08-31 07:10 +02:00
- Command: `node --test tests/js/vf-reflection-planner.test.mjs`
- Exit: 1
- Duration: 0.21 s
- Salient failure: `ERR_MODULE_NOT_FOUND` for the not-yet-created
  `web/vf-ui/geom/vf-reflection-planner.mjs`
- Test source SHA-256:
  `3fe989964aef9c948cc7593a5b9450bd7d482763c909c5dee98b0e4a9b23237b`
- Binary/artifact hash: not applicable; pure JavaScript module

## GREEN receipt

- Time: 2026-08-31 07:15 +02:00
- Command: `node --test tests/js/vf-reflection-planner.test.mjs`
- Exit: 0
- Duration: 0.20 s
- Result: 4 tests passed, including the 4,096-tile fixture
- Implementation SHA-256:
  `c3b7d03ae1f32884c9f5965bd40605ff4dc314ecef91b88f35f52534a577110c`
- Test source SHA-256:
  `3fe989964aef9c948cc7593a5b9450bd7d482763c909c5dee98b0e4a9b23237b`
- Binary/artifact hash: not applicable; pure JavaScript module

## Observable evidence

- 4,096 connected coplanar tiles produce one exact cluster containing 4,096
  stable facet IDs.
- A disconnected coplanar facet and a connected tilted facet each produce a
  separate cluster.
- Reversing input order preserves cluster IDs and output order.
- A two-capture, 1,000-pixel schedule emits two jobs totaling exactly 1,000
  pixels; invisible and back-facing facets emit no jobs.

## Broader regression receipt

- Time: 2026-08-31 07:18 +02:00
- Command: `npm test`
- Exit: 1 after 7.91 s; 334 passed and 3 failed
- The new reflection planner tests passed in the complete test process.
- The three failures are outside every owned path and reproduce base-state
  generated-catalog and symbolic-evaluation mismatches:
  `vf-html-component-catalog-generated`, `vf-symbolic-document`, and
  `vf-symbolic-literal-geometry`. This packet does not modify their source,
  fixtures, generator, or generated output.

## Handoff

- Owned paths: `web/vf-ui/geom/vf-reflection-planner.mjs`,
  `tests/js/vf-reflection-planner.test.mjs`, and this receipt.
- Recovery: the module is target-independent and not wired into the renderer;
  reverting this packet cannot alter current images.
- Next packet: 040-G03 may consume stable cluster IDs and scheduled pixel
  allocations when building the shared reflection atlas.

## Independent-review fix receipt

- Time: 2026-08-31 07:21 +02:00
- RED command: `node --test tests/js/vf-reflection-planner.test.mjs`
- RED exit/duration: 1 after 0.20 s; three new tests failed for locale ordering,
  asymmetric neighbor whitespace, and implicit absolute tolerance
- RED test SHA-256:
  `d8dc70b23bf0fad96c916bf10339bbc0fac1182298ce1f9db9bb6009f3fb6312`
- GREEN command: `node --test tests/js/vf-reflection-planner.test.mjs`
- GREEN exit/duration: 0 after 0.17 s; 7 tests passed
- GREEN implementation SHA-256:
  `18677fddf8e8ee5f7c2a53591299c69e48989a918c9997e516cb5c9da0519343`
- GREEN test SHA-256:
  `1e6064a50ccd07402fa1a15218d284e97d5f645c40bcb845cc843a251e647ac0`
- Result: all planner order and union decisions use explicit UTF-16 code-unit
  ordering; facet and neighbor IDs use the same canonicalizer; exact
  coplanarity is the default and a nonzero tolerance must be caller-supplied
  from geometry scale.
