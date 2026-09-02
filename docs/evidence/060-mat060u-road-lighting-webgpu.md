# 0.6.0 MAT060U — road lighting WebGPU evidence

## Scope

- Base: `421de916` (`MAT060T`).
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Adds one private CPU/WGSL road direct-light model over the existing retained
  normal, roughness, wetness, and specular channels.
- No public VKF syntax, constructor, API, schema, ABI, package export, shared
  0.4 renderer, gallery, media, or 0.4/0.5 path changes.

## Plan fit

MAT060T proved real retained road WGSL execution but rendered flat albedo.
MAT060U carries the road normal into the fragment stage and evaluates a bounded
ambient-plus-directional diffuse and roughness/wetness-conditioned specular
response from the same 32-byte material buffer already retained by MAT060R.

The CPU reference and WGSL use the same equations. This is a deterministic
direct-light tracer, not the final spectral/PBR, shadow, reflection, or
multi-light implementation.

## Observable behavior

The CPU oracle proves that a smooth wet road produces a stronger response than
the same dry rough road, while an edge-on normal produces a weaker response.
On real WebGPU, a front-facing road with albedo `[64, 128, 192]`, roughness
`0.75`, wetness `0.2`, and specular strength `0.25` renders every pixel as
`[98, 147, 197, 255]`, exactly matching the CPU reference with zero byte error.

Two independent hidden Edge processes returned the same 8-by-8 image SHA-256:
`ac0a07386731e2d6de83e3c18f7922d6dd8b213490b0a8902a81ddffdab77b92`.
No Edge process owned by either run remained afterward.

## RED / GREEN

- Baseline `421de916`: MAT060A-T, conditioned-distribution, and spatial-field
  suites passed 56/56 (exit 0, 1.704 s) on Node.js 24.11.0 / Windows x64.
- RED 1: the focused suite failed because no road-light CPU reference existed
  (exit 1, 0.218 s).
- GREEN 1: normal, roughness, wetness, and specular monotonic behavior passed
  4/4 (exit 0, 0.215 s).
- RED 2: the fixture contract rejected the flat WGSL path because it consumed
  neither a vertex normal nor the shared lighting response (3/4 pass, exit 1,
  0.269 s).
- GREEN 2: CPU behavior and WGSL fixture contract passed 4/4 (exit 0, 0.250 s).
- Real hidden WebGPU runs passed in 8.022 s and 7.181 s with identical hashes
  and zero CPU/GPU byte error.

## Executable evidence

```text
node tests/helpers/run_headless_webgpu_fixture.cjs tests/fixtures/road-renderer-webgpu-smoke.html "window.__roadRendererWebGpuEvidence || null" 9470
node tests/helpers/run_headless_webgpu_fixture.cjs tests/fixtures/road-renderer-webgpu-smoke.html "window.__roadRendererWebGpuEvidence || null" 9471
```

Both returned:

```json
{"outcome":"pass","width":8,"height":8,"pixels":64,"draws":1,"sha256":"ac0a07386731e2d6de83e3c18f7922d6dd8b213490b0a8902a81ddffdab77b92","expected":[98,147,197,255],"maxByteError":0,"uploadedBytes":216}
```

The affected deterministic suite passed 57/57, exit 0, in 2.247 s.
`git diff --check` is clean. The final owned-process audit reported zero Edge
processes before and after cleanup.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-road-renderer-submit.mjs` | `8975a7f2b32497ff770c57f75351cf95d3e61858` | `6D5BD1ACBB995C5C08DCBBF3D9576DAA2FD590D1CFB0E3865F8A7C15D1C4CE34` |
| `tests/js/vf-road-renderer-submit.test.mjs` | `b93796e6be6654046f7de2a79c6f61b09ee5b905` | `5A1AABDEB45399854ABDA99616E5F9F00FC7B4B831A92EA98CA6C91C45FA6BEE` |
| `tests/fixtures/road-renderer-webgpu-smoke.html` | `6f535eb4c193962925f4ea497784d9887babfa13` | `D1BB21C6E4CA3A6CF732EB2F66F0FA0153143A9822C7B345CF2D216F2EC0DCC9` |

## Acceptance and recovery

MAT060U closes CPU/WGSL parity for bounded road normal, albedo, roughness,
wetness, and specular direct-light response on a real headless GPU. It does not
yet implement spectral/PBR multi-lighting, shadows/reflections, compose later
road effects, select projected camera demand, prove connected boundaries,
compile native parity, or provide research-fitted presets and public controls.

Re-evaluated estimated 0.6.0 completion is **67.2%**, up **0.7 percentage
points** from MAT060T's 66.5%. Recovery is `git revert` of this packet commit;
only the private road lighting reference/WGSL, hidden fixture, focused test,
and this receipt are owned.
