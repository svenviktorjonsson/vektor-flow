# 060-MAT010B WGSL Philox evidence

- Packet: `060-MAT010B`, 0.6 MAT-010
- Base: `c7deea6cd3b69394fbb8c551ebf1a3267675cf2e`
- Branch: `codex/0.6/060-mat010b-wgsl-philox`
- Environment: Windows NT 10.0.26200.0, Node.js v24.11.0,
  Microsoft Edge 152.0.4191.53
- Scope: internal WGSL parity/reference seam only; no VKF syntax, public API,
  schema, renderer hookup, or material-runtime hookup

## Provenance and representation

- The shader implements Philox4x32-10 using the constants and round order
  pinned by Random123 v1.14.0. The imported CPU reference retains the complete
  upstream BSD notice and official known-answer vectors.
- Each GPU input occupies eight u32 words: counter lanes 0-3, key lanes 0-1,
  then two reserved zero words. Each output occupies four u32 words.
- Upload and readback bytes are explicitly little-endian through `DataView`;
  parity does not depend on JavaScript typed-array host byte order.
- A compiled MAT010A hierarchy maps unchanged to WGSL counter/key words. The
  pinned grass demand sample produces all four CPU reference lanes:
  `533e66b5 0c7c0189 93314d71 c15ff1c2`.

## RED/GREEN slices

All focused cycles used:
`node --test tests/js/vf-demand-random-wgsl.test.mjs`.

1. Executable compute seam
   - RED: exit 1; `vf-demand-random-wgsl.mjs` did not exist.
   - GREEN: exit 0; the zero official vector packed into the 32-byte storage
     record and exposed a WGSL compute entry point.
   - Commit: `75aa9cc feat(random): add WGSL Philox parity seam`
2. Official readback parity
   - RED: missing `verifyPhilox4x32WgslParity` export.
   - GREEN: all-zero, all-one, and pi-derived Random123 vectors matched the CPU
     implementation; a one-bit mismatch reported its exact record and lane.
   - Commit: `5901dc7 test(random): pin WGSL Philox parity`
3. Browser compute fixture
   - RED: browser fixture file did not exist.
   - GREEN: fixture owns shader compilation, async pipeline creation, storage
     upload, dispatch, copy, mapped readback, and reference verification.
   - Commit: `2b470cf test(random): add WebGPU parity fixture`
4. Cross-runtime byte order
   - RED: explicit input/output byte representations and readback decoder did
     not exist.
   - GREEN: the pi vector's 32 input bytes and 16 output bytes match pinned
     little-endian hex exactly.
   - Commit: `c781842 fix(random): pin GPU u32 byte order`
5. Demand-key mapping
   - GREEN characterization: MAT010A stream/key/counter words enter the GPU
     fixture without reordering or conversion.
   - Commit: `4bb68df test(random): prove demand-key GPU mapping`

## Executable evidence and limitation

- Focused command:
  `node --test tests/js/vf-demand-random-wgsl.test.mjs tests/js/vf-demand-random.test.mjs`
- Exit/duration: 0 after 0.48 s; 16 tests passed.
- The HTML fixture is structurally executable and its source contract proves
  the complete compile/dispatch/map/verify path is retained.
- A live attempt served the fixture locally and launched Edge headless with
  `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=swiftshader`.
  Edge loaded the module graph but reported `WebGPU adapter unavailable`.
- Therefore this host did not perform live WGSL compilation or GPU execution.
  That limitation is not represented as a pass. The fixture can become live
  evidence unchanged on a host exposing a WebGPU adapter.

## Broader regression receipt

- Command: `npm test`
- Exit/duration: 1 after 17.21 s; 389 passed and 3 failed.
- Every MAT010A and MAT010B test passed in the complete process.
- The three failures reproduce integration-base mismatches outside all owned
  paths: generated HTML component catalog, symbolic document scope, and
  symbolic named function/constant geometry.

## Handoff

- Owned paths: `web/vf-ui/vf-demand-random-wgsl.mjs`,
  `tests/js/vf-demand-random-wgsl.test.mjs`,
  `tests/fixtures/demand-random-wgsl-smoke.html`, and this receipt.
- SHA-256:
  - module: `cce9b7384af9fa5ceb8d38c9d3dc2736021b210260dd27de62a91ade2838d7ef`
  - focused tests: `0ee4740c3c4a68bfb95ec028fc6be20aac8c7b2b2ce8ef940bd9b4b841bb7585`
  - browser fixture: `272d9dead159e8f4be7aaf8389ffbdf03d2f7074fe3edacb1d7c7fc5c42280ef`
- Git blobs:
  - module: `c6e19d0f247af262f340f0948b602acdf8599c55`
  - focused tests: `c8998fd2200685c09795cf05008f380be88f3968`
  - browser fixture: `fccf04d58b1177b2a9ddfe9e657daa1e5a94d149`
- Recovery: the module is not wired into runtime or exported as a named package
  entry. Reverting this packet cannot alter current rendering or VKF behavior.
