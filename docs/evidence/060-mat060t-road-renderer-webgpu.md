# 0.6.0 MAT060T — road renderer WebGPU evidence

## Scope

- Base: `4c5098df` (`MAT060S`).
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Adds one private bundled road WGSL shader and a real hidden Edge/WebGPU
  render/readback fixture.
- No public VKF syntax, constructor, API, schema, ABI, package export, shared
  0.4 renderer, gallery, media, or 0.4/0.5 path changes.

## Plan fit

MAT060S verified WebGPU command shape through deterministic mocks. MAT060T
compiles the bundled road shader on a real adapter, uploads MAT060R's retained
vertex/index/material buffers, runs MAT060S's indexed render pass, copies an
8-by-8 `rgba8unorm` attachment into a mapped GPU readback buffer, and verifies
all 64 pixels before publishing evidence.

The shader proves the real retained road path and material-buffer binding. It
is intentionally a flat albedo tracer; physically based lighting, later road
effects, and shared production-renderer integration remain separate work.

## Observable behavior

Two independent headless Edge processes compiled and rendered the same full
screen road quad. Every pixel was exactly `[64, 128, 192, 255]`; both readbacks
contained 64 pixels and produced SHA-256
`f196f17fdad682caaa909f436bc1e76ec3ab3aa57866fbb9df753a0e7294ddda`.
Each run reported one indexed draw and 216 uploaded road-resource bytes.

The runs used `--headless=new`; no visible browser or application window was
opened. Edge retained temporary profile locks after both successful runs, so
the established helper deferred profile cleanup without affecting GPU
evidence.

## RED / GREEN

- Baseline `4c5098df`: MAT060A-S, conditioned-distribution, and spatial-field
  suites passed 55/55 (exit 0, 1.838 s) on Node.js 24.11.0 / Windows x64.
- RED: the focused suite failed because the submit module exported no bundled
  road shader and no headless fixture existed (exit 1, 0.317 s).
- GREEN: submit/capture behavior plus the fixture contract passed 3/3 (exit 0,
  0.347 s).
- Real hidden WebGPU run 1 passed in 9.045 s with the pinned 64-pixel hash.
- Independent hidden WebGPU run 2 passed in 13.576 s with the same hash.

## Executable evidence

```text
node tests/helpers/run_headless_webgpu_fixture.cjs tests/fixtures/road-renderer-webgpu-smoke.html "window.__roadRendererWebGpuEvidence || null" 9468
node tests/helpers/run_headless_webgpu_fixture.cjs tests/fixtures/road-renderer-webgpu-smoke.html "window.__roadRendererWebGpuEvidence || null" 9469
```

Both returned:

```json
{"outcome":"pass","width":8,"height":8,"pixels":64,"draws":1,"sha256":"f196f17fdad682caaa909f436bc1e76ec3ab3aa57866fbb9df753a0e7294ddda","uploadedBytes":216}
```

The affected deterministic suite then passed 56/56, exit 0, in 2.099 s.
`git diff --check` is clean.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-road-renderer-submit.mjs` | `69bdcc094a95f46999b113423d78ca7671fbbe99` | `60110EFDD94D8B272F7FD183DC1EF6C8D611EEB587A55CCFE4331A90086101AF` |
| `tests/js/vf-road-renderer-submit.test.mjs` | `447682135619567d13065f024119bc1144d1523d` | `6A83D6BA162C2F89224869CB734BB58444AA773029103730EC4A5E8F4558BC33` |
| `tests/fixtures/road-renderer-webgpu-smoke.html` | `ded5fb8127d987347ca4399514a46f9fb615fd17` | `D025F8E23A7FFECEFCE59B7466070CD757FB4303B625A615D400F877C039917E` |

## Acceptance and recovery

MAT060T closes real hidden WebGPU shader compilation, retained road-resource
binding, indexed rendering, mapped readback, and independent deterministic
pixel identity. It does not yet implement PBR road lighting, compose later
effects, select projected camera demand, prove connected boundaries, compile
CPU/WGSL/native parity, or provide research-fitted presets and public controls.

Re-evaluated estimated 0.6.0 completion is **66.5%**, up **0.9 percentage
points** from MAT060S's 65.6%. Recovery is `git revert` of this packet commit;
only the private road WGSL, hidden fixture, focused contract test, and this
receipt are owned.
