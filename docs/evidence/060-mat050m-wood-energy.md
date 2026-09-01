# 0.6.0 MAT050M — private wood material-energy oracle

## Scope

- Base: `d5e03833` (`MAT050L`).
- Adds a private, renderer-independent white-furnace reference for the retained wood cut material packet.
- No public VKF syntax, API, schema, ABI, shared 0.4 renderer, example, media, or manifest changes.
- The reference is demand bounded to 65,536 material samples and retains exact packet identity through a `WeakMap`.

## Physical reference

For five fixed cosine probes, each RGB channel uses the conservative dielectric partition:

`energy = F + (1 - F) * base_color`

where `F` is Schlick Fresnel with internal dielectric `F0 = 0.04`. This proves the current procedural wood base colors cannot create energy under the reference partition. Roughness redistributes the lobe and is validated structurally, but this packet does not claim measured IOR, anisotropy, multiple scattering, or complete renderer/GGX integration.

## RED / GREEN

- RED `0f87a13e`: `node --test tests/js/vf-wood-material-energy.test.mjs` failed with `ERR_MODULE_NOT_FOUND`.
- GREEN `6607ca6f`: the same command passed 2/2 after adding the bounded oracle.
- Refinement coverage `b940bf31`: every current end-grain and side-grain detail level conserves energy.
- Pinned oracle `98a7b99a`: focused suite passes 3/3.

Full private procedural chain:

`node --test tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-forest-population.test.mjs tests/js/vf-tree-geometry-plan.test.mjs tests/js/vf-wood-growth-coordinates.test.mjs tests/js/vf-wood-volume-field.test.mjs tests/js/vf-wood-cut-plane-grid.test.mjs tests/js/vf-wood-cut-surface-packet.test.mjs tests/js/vf-wood-cut-material-packet.test.mjs tests/js/vf-wood-material-energy.test.mjs`

- 41/41 pass, 0 fail, 1.477 s.
- Fine end-grain energy SHA-256: `30AB2A11FD08E2820CC255419E45A7B12F64461C6B69CD0155BD7C48C13583F6`.
- Fine side-grain energy SHA-256: `B5D08139AB8D21AB494440A15CC8E033CEDE8E1040FDAD851D8995014BDF9009`.

## Bounded performance

Synthetic deterministic 64x64 wood packet, 4,096 samples, five probes, three channels:

- Output vector: exactly 245,760 bytes.
- Cold realization: 2.535583 +/- 0.262694 ms per packet (7 passes x 100 unique packets; min 2.031726, max 2.877018 ms).
- Retained lookup: 0.000137 +/- 0.000052 ms (7 passes x 10,000 exact lookups; min 0.000077, max 0.000216 ms).

## Hidden capture

Offscreen Edge/WebGPU capture:

`node tests/helpers/capture_mirror_scene.js tests/fixtures/rock-material-field-smoke.html .w/mat050m-rock-oracle.png 0 9485 rock_material_field_frame`

- Init failures: 0; runtime failures: 0.
- PNG: 58,298 bytes.
- SHA-256: `20C7B5A2E8B1BA73F2CA56AEB5B22159F3D5F1AA8D07B3AAA5066A5DEC8F0B7A` (exact inherited reference parity).
- Transient benchmark and capture files were removed after verification.

## Content identities

- `web/vf-ui/vf-wood-material-energy.mjs`
  - Git blob: `7e8d108d7f3a43a7623f53117c39e5cf9d2e8f7e`
  - SHA-256: `6981103CB5D666E0E4B62932BA92B5BA72A4C662798E04D7E1BCDD5DD413482A`
- `tests/js/vf-wood-material-energy.test.mjs`
  - Git blob: `6d202d679eadeacf5d1cde0331f159c573546739`
  - SHA-256: `3984E930C4957A58AA7FAF72A349156505082EF1EC08E7A20A420E659922873C`

## Acceptance boundary

This advances the physical-material/white-furnace gate with a deterministic private oracle. The remaining release work still includes renderer BRDF integration evidence, measured material parameters, procedural road and broader natural-material families, public design decisions, gallery coverage, and release integration.
