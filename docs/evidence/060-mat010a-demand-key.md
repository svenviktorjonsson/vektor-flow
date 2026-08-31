# 060-MAT010A demand-key evidence

- Packet: `060-MAT010A`, 0.6 MAT-010
- Base: `06d18da84aa38cbd13b3d821593cbef2ef906496`
- Branch: `codex/0.6/060-mat010a-demand-key`
- Environment: Windows NT 10.0.26200.0, Node.js v24.11.0
- Scope: internal deterministic CPU reference only; no VKF syntax, public API,
  renderer, shader, or schema changes

## Provenance

- Counter construction: Philox4x32-10 from Random123 v1.14.0. Constants,
  round layout, official known-answer vectors, and the complete BSD notice are
  pinned in the source and tests.
- Upstream source:
  <https://github.com/DEShawResearch/random123/blob/v1.14.0/include/Random123/philox.h>
- Upstream vectors:
  <https://github.com/DEShawResearch/random123/blob/v1.14.0/tests/kat_vectors>
- Upstream license:
  <https://github.com/DEShawResearch/random123/blob/v1.14.0/LICENSE>
- Identity compression: independently implemented FIPS 180-4 SHA-256, used
  only to map the framed stream identity to fixed Philox words:
  <https://csrc.nist.gov/pubs/fips/180-4/upd1/final>
- Security boundary: Philox is a deterministic non-cryptographic generator;
  this module must not be used for secrets or security tokens.

## RED/GREEN slices

All focused cycles used:
`node --test tests/js/vf-demand-random.test.mjs`.

1. Philox reference
   - RED: exit 1; module did not exist.
   - GREEN: exit 0; all three official Philox4x32-10 vectors matched.
   - Commit: `0e1afbc feat(random): add Philox u32 reference`
2. Canonical identity framing and digest
   - RED: missing `encodeDemandIdentity`, then missing `sha256Bytes`.
   - GREEN: byte-exact `VKFD` v1 framing distinguishes `['ab','c']` from
     `['a','bc']`; FIPS empty and `abc` digests match.
   - Commits: `f920b59`, `c82e87a`
3. Hierarchical demand key
   - RED: missing `deriveDemandKey` and `demandU32`.
   - GREEN: pinned key `c236c986:61db5b0b`, counter
     `5c768268:70d89da1:76543210:fedcba98`, and output `533e66b5`.
   - Commit: `9725b45 feat(random): derive hierarchical demand keys`
4. Stateless sampling
   - RED: missing compiled-stream sampling functions.
   - GREEN: reverse traversal, uneven chunks, and independent stream instances
     reproduce the same 24 samples.
   - Commit: `1c5fac8 feat(random): make sampling order independent`
5. Exact identity validation
   - RED: negative/fractional/overflow words were silently truncated; missing
     strings were silently encoded; missing sample produced an incidental
     property-access error.
   - GREEN: every numeric identity is exact u32 and generator, domain,
     hierarchy segments, channel, and sample are explicit typed inputs.
   - Commits: `92de9cc`, `e00e331`, `e4e93b4`
6. Worker independence
   - RED: worker fixture did not exist.
   - GREEN: two real Node workers sampled even/odd partitions and reproduced
     the serial result exactly.
   - Commit: `d8bc628 test(random): prove worker independence`

## Observable acceptance evidence

- Focused command: `node --test tests/js/vf-demand-random.test.mjs`
- Exit/duration: 0 after 0.39 s; 11 tests passed.
- Generator, version, seed, domain, hierarchy, LOD, channel, and 64-bit sample
  identity each select the deterministic result.
- Parent, child, and sibling hierarchy paths have independent output; sampling
  one level never advances or mutates another level.
- A compiled stream stores four u32 words at LOD 0 and LOD `0xffffffff`.
  Sampling counter `ffffffff:ffffffff` creates no collection proportional to
  the unrealized cell/detail count.

## Broader regression receipt

- Command: `npm test`
- Exit/duration: 1 after 10.17 s; 384 passed and 3 failed.
- Every demand-random test passed in the complete process.
- The three failures reproduce integration-base mismatches outside all owned
  paths: generated HTML component catalog, symbolic document scope, and
  symbolic named function/constant geometry.

## Handoff

- Owned paths: `web/vf-ui/vf-demand-random.mjs`,
  `tests/js/vf-demand-random.test.mjs`,
  `tests/helpers/vf-demand-random-worker.mjs`, and this receipt.
- SHA-256:
  - module: `fc97d54852371c2388bdb0ce62639b7cc643f63da77c4ea4a495d532abda4c59`
  - focused tests: `fef25af2f704a27f1b4ddd51e813871b643b3943f597f5c6d84cf2566273cc9e`
  - worker fixture: `56c42ba4321c6369275ebc27cd72ef3c1957920885f904eca295a1917fd8bf8e`
- Git blobs:
  - module: `cb29ee5577d34f557d4b8f89908e9d927fe6341b`
  - focused tests: `36722c82feeb8ed8a7a4af2ab8e6b7bb70d9b2a6`
  - worker fixture: `b05f25f6a82468f38e19aa25d2fe0fc681634637`
- Recovery: the module is not wired into runtime or exported as a named package
  entry. Reverting this packet cannot alter current rendered or VKF behavior.
