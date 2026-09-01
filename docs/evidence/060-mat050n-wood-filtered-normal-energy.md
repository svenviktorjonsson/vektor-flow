# 0.6.0 MAT050N — filtered wood normal-energy evidence

## Scope

- Base: `f1e4320f` (`MAT050M`).
- Branch: `codex/0.6/060-mat050n-wood-filtered-normal-energy`.
- Adds private scale-aware normal filtering to coherent wood cuts and feeds the filtered tangent normal into the private local-incidence energy oracle.
- No public VKF syntax, API, schema, ABI, shared 0.4 renderer, example, media, or manifest changes.

## Internal contract

- MAT050J cut grids now retain the already-required `detailLevel` and `footprint` values used to sample their coherent volume. This introduces no new input or policy.
- MAT050L material packets convert footprint to a per-axis integer filter radius using physical plane sample spacing. A zero footprint follows the previous exact finite-difference path.
- Non-zero footprints use one temporary summed-area material-height field. Derivative work is linear in demanded samples and independent of the radius; no filtered image or integral is retained.
- Radius is hard capped by the demanded grid. Under the 65,536-sample grid cap, the temporary `Float64Array` integral is bounded to at most 1,048,592 bytes. The retained material output remains exactly five bytes per sample.
- MAT050M decodes the packed tangent normal, evaluates local incidence for each fixed cosine probe, then applies the same conservative Schlick dielectric partition. This is a deterministic energy stress oracle, not a complete GGX hemisphere integral or a measured anisotropic wood BRDF.

## RED / GREEN

- RED `89e3afd5`: three focused failures proved that cut grids discarded scale, material packets did not filter derivatives, and the energy oracle ignored normals.
- GREEN `d82268d7`: cut scale is retained; bounded filtered derivatives feed packed normals and local-incidence energy. Focused suite passed 11/11 after accepting the changed energy identities.
- Oracle pin `adc9edbb`: pins all coarse, medium, and fine normal radii, normal images, and energy vectors.
- Bounded refactor `e37dceb8`: replaces radius-squared filtering with a summed-area field; focused suite remains 11/11 and constant coarse fields remain byte exact through a zero-derivative tolerance.

Full private procedural chain:

`node --test tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-forest-population.test.mjs tests/js/vf-tree-geometry-plan.test.mjs tests/js/vf-wood-growth-coordinates.test.mjs tests/js/vf-wood-volume-field.test.mjs tests/js/vf-wood-cut-plane-grid.test.mjs tests/js/vf-wood-cut-surface-packet.test.mjs tests/js/vf-wood-cut-material-packet.test.mjs tests/js/vf-wood-material-energy.test.mjs`

- 43/43 pass, 0 fail, 1.107 s.

## Refinement oracles

| Detail / cut | Filter radius | Normal SHA-256 | Energy SHA-256 |
| --- | --- | --- | --- |
| 0 end | `[1,1]` | `372C43A8FF89CC72A7A8CF53A9B2B6BEF55F7AFA376441249BC7F3238915CAA9` | `591DB2C18EA9E3AAD3BAC0AC16DD969D8BFDEB58455193C1F925E0B6D941C06E` |
| 0 side | `[1,0]` | `372C43A8FF89CC72A7A8CF53A9B2B6BEF55F7AFA376441249BC7F3238915CAA9` | `591DB2C18EA9E3AAD3BAC0AC16DD969D8BFDEB58455193C1F925E0B6D941C06E` |
| 1 end | `[0,0]` | `62381071B0DD79322A6768E7C8C1E3749B0774430DFD0F9B3B7321B972F5ACEA` | `D244A0FBFE32936DAF7450AF3A7BE0365992E53425B9BB67E4E51CEF39E22C2F` |
| 1 side | `[0,0]` | `A4DE96CFB543AFCB7870943FF69B5F5DBB8CA0D33F0573818F4C6C1A697822BE` | `27FA6629D19243A1051BC203F180D4177CA1445CFE13DAC321B1765E99021C55` |
| 2 end | `[0,0]` | `3509090CE388ECD8562F62586B6EC0154150BE71BA1561B9DACBA8A37247F2E3` | `2060F14A57FCED2F8E06DDA597E0334F6D0B3E3FCFE5A0FBF5E793A4B99DF2CA` |
| 2 side | `[0,0]` | `84E44E512EA80E1E52EF126629FDC7FD98D18A50593CC45D9248436F1AEE6F66` | `FE066CE5801A801EACEF16261BEB41B3480433D2257656356FC0128406BC60D2` |

All six energy oracles have zero budget violations and remain within `[0,1]`. Fine zero-footprint normal bytes are exactly unchanged from MAT050L.

## Bounded performance

Deterministic synthetic 64x64 cut, 4,096 samples, filter radius `[3,3]`, seven passes:

- Retained normal output: exactly 20,480 bytes.
- Temporary integral: exactly 33,800 bytes.
- Cold filtered normal realization: 3.404887 +/- 1.210909 ms per packet (7 x 100 unique packets; 2.121840-6.050883 ms).
- Retained material lookup: 0.000090 +/- 0.000045 ms (7 x 10,000; 0.000041-0.000184 ms).
- Retained energy output: exactly 245,760 bytes.
- Cold normal-aware energy realization: 5.283832 +/- 1.347408 ms per packet (7 x 100; 3.764071-7.584341 ms).
- Retained energy lookup: 0.000191 +/- 0.000196 ms (7 x 10,000; 0.000050-0.000649 ms).

The host was shared with other release work, so these are bounded feedback measurements rather than release benchmark claims.

## Hidden capture

Offscreen Edge/WebGPU capture:

`node tests/helpers/capture_mirror_scene.js tests/fixtures/rock-material-field-smoke.html .w/mat050n-rock-oracle.png 0 9487 rock_material_field_frame`

- Init failures: 0; runtime failures: 0.
- PNG: 58,298 bytes.
- SHA-256: `20C7B5A2E8B1BA73F2CA56AEB5B22159F3D5F1AA8D07B3AAA5066A5DEC8F0B7A` (exact inherited reference parity).
- Transient benchmark and capture files were removed after verification.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-wood-cut-plane-grid.mjs` | `778b76d41b3401a8898ee82c698f64ed17633784` | `E6AFF04EA326BBA9B282C20F027FF6CE6F34EE17F7F721396118E4C0722D2F22` |
| `web/vf-ui/vf-wood-cut-material-packet.mjs` | `e5ea1daea28d54e25f33f3ff6d411bd7afdace58` | `4DF8B72E400744A6DB0D9B8D263CA562E08D5F1437095D69F8DB48F5D6D9A9FF` |
| `web/vf-ui/vf-wood-material-energy.mjs` | `bf1d06c8ea617f7d8070b62aa75f3c39181f3cc8` | `BD71112AB64EE58F2D0D6F13707E8B225DB39932251F14217E27B28555CE1C68` |
| `tests/js/vf-wood-cut-plane-grid.test.mjs` | `13055b927f525491573c95e7965ee6b7c93beeff` | `2171CCF8ABFEE24BCC9A54FA45287B1A557E3EF170B6C4BCDE7C50D89D78CDA1` |
| `tests/js/vf-wood-cut-material-packet.test.mjs` | `33fd2e582d9ff3f9c9cca2772aaa33dd870318c3` | `9E9A33DDE3AB23191C1DFA0C977E96135586580FFC6F0C9E99FDE3877673973B` |
| `tests/js/vf-wood-material-energy.test.mjs` | `bc1fa18c48dccc553e293b48ad6ea519d74112c2` | `899F1D3414365A3251E2AF0D37A8D41CB7923FEBB609BDC6B9660B8C72986476` |

## Acceptance boundary

MAT050N advances the filtered-derivative and material-energy gates for coherent wood cuts. It does not submit the packet to WebGPU, prove a complete white-furnace integral, define measured anisotropic wood response, or expose author controls. Those remain later private renderer/research slices and Language Design Authority decisions.
