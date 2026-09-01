# 040-G01C clustered-light shader evidence

Recorded: 2026-08-31 08:43:53 +02:00

## Packet identity

- Release: 0.4.0, GFX-010 clustered-light foundation
- Branch: `codex/0.4/040-g01c-clustered-light-shader`
- Base commit: `e8c3d766c1dd7d6eebdb999070c27eb41d7b5e80`
- Implementation head before this receipt: `9f8165de41b70580e2249a03cdefc7c12f21ceb6`
- Implementation tree before this receipt: `4b7d944b185e8c5e31501af58022dc36c8e884c9`
- Environment: Windows x64, Node.js v24.11.0

## Owned paths

- `web/vf-ui/geom/vf-geom-wgpu.js`
- `web/vf-ui/geom/vf-clustered-light-shading-oracle.mjs`
- `tests/js/vf-geom-clustered-light-shader.test.mjs`
- `tests/js/vf-geom-clustered-light-wiring.test.mjs`
- `tests/fixtures/clustered-light-wgsl-smoke.html`
- `docs/evidence/040-g01c-clustered-light-shader.md`

The packet changes no VKF syntax, public API, light schema, or material schema.

## RED evidence

Each behavior was introduced as one focused failing test:

- the receiver-depth test first failed with `ERR_MODULE_NOT_FOUND` because no
  CPU oracle existed;
- the fifth-light test first failed because the oracle did not export a direct
  light evaluator;
- the packed-depth test failed `0 !== 0.05` because the group-one plan did not
  carry near/far depth;
- the shader-consumer contract failed because WGSL did not declare group one;
- the normalized-forward test failed `3 !== 2` because a non-unit camera
  forward changed the logarithmic slice;
- the transparent-receiver test first failed because no composed lighting
  oracle existed; and
- the projected-light safety test exposed `[1, 1, 1]` false diffuse instead of
  `[0, 0, 0]` when an unsupported fifth projected light was treated as a point
  light.

## GREEN evidence

Focused command:

```text
node --test tests/js/vf-clustered-light-plan.test.mjs tests/js/vf-geom-clustered-light-wiring.test.mjs tests/js/vf-geom-clustered-light-shader.test.mjs tests/js/vf-geom-render-evidence.test.cjs
```

Result: 14 tests passed, 0 failed. `node --check` and `git diff --check` also
passed.

Observable behavior:

- group one now contains a ten-word header, CSR cluster offsets/IDs, and packed
  64-byte light records;
- the header stores the exact planner near/far depths as f32 bit patterns;
- receiver depth is `dot(world_position - camera_position, camera_forward)` and
  maps through the same logarithmic convention as the CPU planner;
- the shader reads only the receiver cluster's retained IDs and independently
  clamps traversal to the declared per-cluster cap;
- IDs zero through three continue through the unchanged uniform shadow and
  projected-aperture blocks, so their established lighting is not counted
  twice;
- retained point/spot IDs four and above add the same attenuation, spotlight,
  diffuse, and Blinn-Phong specular terms without shadows;
- opaque and transparent triangle pipelines share the same `fs` receiver entry;
  the CPU oracle confirms the transparent result is the same lighting response
  with premultiplied alpha; and
- projected/geometry IDs four and above are explicitly skipped rather than
  producing incorrect point-light diffuse without aperture records.

Implementation commits:

- `7d0f0d7` — pin logarithmic positive view depth;
- `621a860` — pin legacy-four and fifth-light direct contributions;
- `11f2d3c` — pack planner near/far depths;
- `463401f` — consume clustered point/spot records in the main WGSL receiver;
- `384eddd` — normalize camera forward in the oracle;
- `d4b1b15` — pin opaque/transparent premultiplied-light parity;
- `af8bafa` — reject unsupported additional projected/geometry records; and
- `9f8165d` — add a physical browser WGSL smoke fixture.

## Browser adapter limitation

The smoke fixture was served to Microsoft Edge 152 in headless mode with
unsafe WebGPU and SwiftShader/Dawn unsafe APIs enabled. The page loaded the real
renderer and reached `navigator.gpu.requestAdapter`, but emitted:

```text
[vf-geom-wgpu] requestAdapter() null
```

Therefore this host did not provide a browser WebGPU adapter and could not
execute `getCompilationInfo()` or capture pixels. This receipt makes no claim
that the new WGSL was validated by a physical adapter. The committed smoke
fixture is the immediate rerun path on a host with WebGPU. CPU lighting oracles,
storage/bind tests, source contracts, and JavaScript syntax are green.

## Remaining limitations

- Planner inputs are still conservative full-frustum bounds, so this packet
  removes the four-light pixel cap for point/spot lights but does not yet reduce
  cluster overlap or prove 10,000-light performance.
- Additional point/spot lights are unshadowed. Only the first four retain the
  existing shadow maps and contact-shadow data.
- Additional projected/geometry lights remain intentionally excluded until
  group-one records contain exact aperture/emissive geometry data. The first
  four projected lights retain their established aperture behavior.
- A real adapter compile plus deterministic image capture remains required
  before graphics acceptance; the included browser fixture currently reports
  pass/fail through `__clustered_light_wgsl_*` requests.

## Full JavaScript suite baseline

```text
npm test
```

Result: 362 tests, 359 passed, 3 failed. All new and affected clustered-light
tests passed. The same unrelated integration-baseline failures remain:

- stale generated HTML component catalog;
- symbolic document result `-8` versus expected `8`; and
- symbolic literal geometry result `-624` versus expected `625`.

## Source hashes

| Source | Git blob | SHA-256 |
|---|---|---|
| `web/vf-ui/geom/vf-geom-wgpu.js` | `76d0a5f70f3f32d8d399abd62ce4bd545e2399b5` | `50148fcfaa0e5db6e37bd7ea6cbd477e9f52396bf571ee7a478b92e2aca43b09` |
| `web/vf-ui/geom/vf-clustered-light-shading-oracle.mjs` | `0532a5ee78940bb4048dca7249432447387ea081` | `f54ed1ab1e5aebc5f602859ed2c33e280cce4afc1626fbb0f4a5fcd179865b8a` |
| `tests/js/vf-geom-clustered-light-shader.test.mjs` | `21837e5561ec3525f3100b68f9615a2ed4c4c7bf` | `ff9107d5ea9f6d58f7de75f1807974c984d744b02f19cac3ac489eb2587aafc0` |
| `tests/js/vf-geom-clustered-light-wiring.test.mjs` | `d6d1783a115b2936bf910a299ad5c200b3e751ba` | `d63ffe5bb90af6a97b5c09aa34ef3cb47057c76a0522c426031a90bcac1f74dc` |
| `tests/fixtures/clustered-light-wgsl-smoke.html` | `69188e206ab093fc72ed9b847424f1243d263058` | `7db6625922bc5924ee01de620893b67f55a3c0d6ecaa0ed10f6a212177f3dd0a` |
