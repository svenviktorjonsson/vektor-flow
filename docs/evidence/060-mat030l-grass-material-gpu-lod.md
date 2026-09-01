# MAT030L filtered grass material GPU evidence

Date: 2026-09-01

## Packet

- Base: `d03317677ff759e2e40b19edb40787e7b8aa2ae1` (MAT030K).
- Branch: `codex/0.6/060-mat030l-grass-material-refinement`.
- Verified head before this evidence receipt: `c39c314e0e5cb509bc5fd2885bceed77599f3612`.
- Scope: an internal image-stable CPU/WGSL oracle for future per-fragment grass color and roughness refinement.
- Public VKF syntax/API/schema changes: none.
- Existing renderer, display, packet, demand, cache, fixture, and 0.4-owned files changed: none in the final diff.

## Observable contract

- Grass material detail levels 0 through 3 return the supplied base color object and roughness value exactly, without refinement arithmetic.
- Level 4 admits one deterministic micro-material octave at wavelength `1/64`; level 5 admits a second half-amplitude octave at wavelength `1/128`.
- Each octave is filtered by projected footprint. It is exactly absent at or above one wavelength, exactly resolved at or below half a wavelength, and follows cubic smoothstep between those boundaries.
- Stable conditioned stream words, blade index, and pinned Philox counter lanes make every refinement independent of traversal, frame order, worker partitioning, and unrelated demand.
- Refinement changes only color and roughness. Geometry, height, coverage, cell IDs, blade IDs, shadow density, batch identity, record sizes, and upload behavior remain outside this packet.
- Color is bounded to `[0, 1]`; roughness is bounded to `[0.72, 0.98]`.

The existing capture demands are detail levels 1, 3, and 2. They therefore stay on the exact identity branch even when their footprints are small.

## RED to GREEN

1. `8573a80` pinned exact coarse identity and a half-weight transition; RED failed because the grass material GPU module did not exist. `232ff73` added the smallest deterministic CPU oracle.
2. `fb248a9` pinned the 12-word input, 8-float output, stream words, and verifier diagnostics; RED failed because the WGSL and fixture functions were absent. `a976851` added the matching shader and parity fixture.
3. `252b545` required a real headless WebGPU execution fixture; RED failed with `ENOENT`. `c39c314` added the hidden compute/readback fixture.

An earlier descriptor-rebake prototype was reverted before these cycles. Pipeline inspection showed it would upload cell descriptors during camera motion while grass roughness is not yet consumed by the shared fragment renderer. The final three-file diff avoids that work and preserves the active 0.4 ownership boundary.

## Real WebGPU parity

Command:

```text
node tests/helpers/run_headless_webgpu_fixture.cjs tests/fixtures/grass-material-gpu-parity-smoke.html "window.__grassMaterialGpuParityEvidence || null" 9441
```

Result:

```json
{"outcome":"pass","detail":"3 filtered grass materials matched","records":3,"maxAbsoluteError":1.4901161193847656e-8,"exactIdentity":true,"stream":{"key":[3971784265,3413052385],"counterPrefix":[3471859904,3947789436]}}
```

The fixture compiles the actual WGSL, dispatches its compute entry point, maps GPU output, and compares coarse, transition, and fine samples to the CPU oracle. It opens no visible window.

## Existing hidden-capture parity

All captures used headless Edge and the repository frame capture system. They report no shader, initialization, provider, or runtime failure.

| Scene | PNG bytes | SHA-256 | MAT030K parity |
| --- | ---: | --- | --- |
| zero-light horizon | 26,322 | `4D51B1365A376B258829505AEFDA8D9561A404D5AA90441EE557EE40322D77E7` | exact |
| near lit shadows | 154,171 | `165AF490C81AE4BEEF87E1D3DBED489D67B86BEB364C4B1888775F8EC5F0BE8B` | exact |
| far lit shadow LOD | 81,011 | `612F7A80ACA9DBE6670FAC3EE90E3C65C3C251FE6FAB7F40599075E7CC9315F6` | exact |

Transient PNGs were removed after hashing.

## Executable evidence

Affected material/display/renderer chain:

```text
node --test tests/js/vf-grass-material-gpu.test.mjs tests/js/vf-grass-material-realization-cache.test.mjs tests/js/vf-grass-blade-gpu-compute.test.mjs tests/js/vf-grass-material-instances.test.mjs tests/js/vf-grass-camera-demand-runtime.test.mjs tests/js/vf-grass-view-demand.test.mjs tests/js/vf-grass-material-field.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-demand-random.test.mjs tests/js/vf-demand-random-wgsl.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-display-grass-gpu-pass-through.test.cjs tests/js/vf-display-rock-material-pass-through.test.cjs tests/js/vf-geom-grass-gpu-compute.test.mjs tests/js/vf-geom-grass-blade-instances.test.mjs tests/js/vf-geom-grass-shadow.test.mjs tests/js/vf-geom-shared-grass-template.test.mjs tests/js/vf-geom-clustered-light-wiring.test.mjs tests/js/vf-geom-retained-part-identity.test.cjs tests/js/vf-geom-render-evidence.test.cjs
tests 74; pass 74; fail 0
```

Repository suite:

```text
npm test
tests 503; pass 500; fail 3
```

The same inherited generated HTML catalog drift and two symbolic sign/endpoint failures remain. No MAT030L-owned test failed.

## Content hashes

| Path | Git blob | working-tree SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-grass-material-gpu.mjs` | `3ff4ecdbcd1875c879f3c0380b764e9b4cbbad3c` | `722872A978E8831359613A7984C55BE4F7DC8A0D4B26B4F66875C1949112DB83` |
| `tests/js/vf-grass-material-gpu.test.mjs` | `62d988142566f159863f8b9872502a383cb661ee` | `6E853BEDC2FED01215BADA81F10BFDDE0B6B7AA088080FFC81EE0E21165DAF20` |
| `tests/fixtures/grass-material-gpu-parity-smoke.html` | `fee1ed9418b61fdcd9edcf7b134fa5266beb6219` | `FA5DCA6AF864BC21ED7CB735A147DED739FBDFCDD4D8D556315976C2E0F29BA3` |

## Remaining boundary

MAT030L proves the filtered material node but deliberately does not claim visible runtime refinement. After the active 0.4 renderer ownership clears, a path-isolated consumer can pass stable blade material coordinates into the grass fragment path, derive footprint with `dpdx`/`dpdy`, and feed both refined color and roughness into lighting. That follow-up can consume this oracle without camera-triggered CPU rebakes or continuous cell-descriptor uploads.

Integration can cherry-pick `8573a80^..c39c314` onto MAT030K; this excludes the earlier reverted exploration. Recovery is otherwise a drop of commits after base `d033176`.
