# 0.6.0 MAT050O — anisotropic GGX white-furnace evidence

## Scope

- Base: `b598830a` (`MAT050N`).
- Branch: `codex/0.6/060-mat050o-wood-ggx-furnace`.
- Adds a private CPU reference that integrates the complete anisotropic GGX
  single-scatter BRDF hemisphere for retained wood-cut material packets.
- No public VKF syntax, API, schema, ABI, shared 0.4 renderer, fixture, media,
  example, or manifest changes.

## Internal oracle

- Five fixed view probes exercise normal incidence and two tangent directions
  at cosines 0.5 and 0.25. MAT050N's filtered tangent normal changes each
  probe's local incidence.
- Perceptual roughness is decoded from `roughnessR8`, squared, and clamped to a
  private reference minimum alpha of 0.08.
- Each probe numerically integrates anisotropic Trowbridge-Reitz/GGX `D`,
  height-correlated Smith `G2`, and Schlick dielectric `F` over the complete
  light hemisphere. Uniform midpoint quadrature uses cosine and azimuth, so
  each cell has equal solid angle.
- The accepted pass uses 96 x 192 = 18,432 hemisphere cells. A paired 48 x 96
  = 4,608-cell pass records the maximum fine/coarse energy delta. The pinned
  roughness-0.502 sample has deltas 0.001551 isotropic and 0.002182
  anisotropic; all procedural refinements stay at or below 0.01.
- A unit-reflector integral exposes GGX single-scatter loss directly. The
  dielectric specular integral must remain between zero and that unit result.
  Conservative combined energy is `specular + baseColor * (1 - unit)` and
  therefore catches specular/diffuse double counting without pretending the
  single-scatter loss is a complete multiple-scattering wood model.
- Two profiles are retained: isotropic and anisotropy 0.65. The anisotropy and
  aspect mapping are private stress-oracle policy, not measured wood data,
  author controls, or a renderer material contract.
- The isotropic profile is rotation invariant within 1e-6 at paired tangent
  probes; the anisotropic profile differs by more than 1e-3.

The equations follow the anisotropic GGX and Smith model in Eric Heitz,
[Understanding the Masking-Shadowing Function in Microfacet-Based BRDFs](https://jcgt.org/published/0003/02/03/),
and the independent formulation in
[PBRT v4: Roughness Using Microfacet Theory](https://www.pbr-book.org/4ed/Reflection_Models/Roughness_Using_Microfacet_Theory).

## RED / GREEN

- RED `306b14f0`: the focused test failed at module instantiation because the
  full-GGX export did not exist.
- GREEN `4f8e5b30`: complete-hemisphere isotropic/anisotropic integration,
  energy planes, and weak-key retention passed the focused suite.
- RED `56ebc052`: the next tracer required paired-quadrature convergence
  evidence; the oracle exposed no coarse sample count or delta.
- GREEN `22a40d4d`: paired integration was added. Its first 48 x 96 / 24 x 48
  attempt exposed a 0.022158 anisotropic delta; raising the accepted pair to
  96 x 192 / 48 x 96 brought the same sample below 0.01.
- `1c70f8b9` pins tangent-rotation invariance and anisotropic response.
- `ede3bdd9` pins isotropic and anisotropic combined-energy hashes for all six
  current wood refinements.
- `f5862992` removes all per-cell temporary arrays from the integrator; the
  exact energy hashes remain green and scratch stays scalar/constant.

## Executable evidence

Full private MAT010-through-MAT050O procedural chain:

```text
node --test tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-forest-population.test.mjs tests/js/vf-tree-geometry-plan.test.mjs tests/js/vf-wood-growth-coordinates.test.mjs tests/js/vf-wood-volume-field.test.mjs tests/js/vf-wood-cut-plane-grid.test.mjs tests/js/vf-wood-cut-surface-packet.test.mjs tests/js/vf-wood-cut-material-packet.test.mjs tests/js/vf-wood-material-energy.test.mjs
```

- 46/46 pass, 0 fail, 8.875 s.
- The focused energy file is 7/7 green; its six-level integrated refinement
  oracle completed in 7.085 s inside the final full-chain run on the shared
  host.
- All isotropic and anisotropic unit-reflector, dielectric-specular, and
  combined-energy rows have zero violations and remain within `[0,1]`.

## Refinement identities

| Detail / cut | Isotropic combined-energy SHA-256 | Anisotropic combined-energy SHA-256 |
| --- | --- | --- |
| 0 end | `4FB13768FB88FC54CB0147867914C0291F862BC9023B0925BA0794F5123E1E57` | `B12F958DA1A0F499C2F89CBED2F586DF9CBF7F1C9774BDF25D0D9E0E13D3DA54` |
| 0 side | `4FB13768FB88FC54CB0147867914C0291F862BC9023B0925BA0794F5123E1E57` | `B12F958DA1A0F499C2F89CBED2F586DF9CBF7F1C9774BDF25D0D9E0E13D3DA54` |
| 1 end | `A22AFFFAD79892E008A65603E3FFDCBC262ADE55CEC8F35B625B5C2E3B0A0BCD` | `5743273C8F6EE1A5ECDA8CE175564276D88E0DDB224FC0AA2C82034B6124C095` |
| 1 side | `81FA13131F379F4D151756FABDC2673C3A77DADCC071B95F62E12A7091304E57` | `D76DAC3666A0F12D86614474D1DF126BC9BF8645CF881AAFEB9D357FFC14E344` |
| 2 end | `25355A6CD12104F9467BAD02266261BE2BBEBCE11DF576D4A5DBDA45FA5FE3B5` | `231A9BB17793391D7D8A374484AE605133D4423DC44C62ACDD92DD7B139990D3` |
| 2 side | `0C4289B22FC8AAD38A31D7BB36FD29C6ACAA30B71B738BA42BA2E34670392E64` | `718BC11D2CAE3433E322674EB0310BFE08AD0ABAB4699E63F45BC3C222A46DC5` |

## Bounded retention and cost

- Each retained sample uses exactly 216 bytes across the two reference
  profiles: alpha axes, unit/specular energies, and combined RGB energy.
- The inherited 65,536-sample cap therefore bounds retained GGX vectors to
  14,155,776 bytes. Quadrature direction state is scalar and constant; no
  hemisphere table or per-cell object is retained.
- Seven local passes of ten fresh one-sample packets measured 34.816310 +/-
  6.064550 ms per cold oracle (30.933030-49.403180 ms). Seven passes of
  10,000 retained lookups measured 0.000150 +/- 0.000102 ms
  (0.000059-0.000371 ms).
- The host was shared, so these are feedback bounds, not a release performance
  claim. This high-accuracy CPU oracle is an offline acceptance reference, not
  an interactive renderer path.

## Hidden capture

Offscreen Edge/WebGPU capture:

```text
node tests/helpers/capture_mirror_scene.js tests/fixtures/rock-material-field-smoke.html .w/mat050o-rock-oracle.png 0 9489 rock_material_field_frame
```

- The helper completed and produced a 58,298-byte PNG.
- SHA-256: `20C7B5A2E8B1BA73F2CA56AEB5B22159F3D5F1AA8D07B3AAA5066A5DEC8F0B7A`,
  exact inherited reference parity.
- The transient capture was removed after verification.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-wood-material-energy.mjs` | `7b209090ab4a72d7e6e85586875d09f692e2962d` | `385036B2E6F2E1CD699FFA8FE216DC2161F07BAF706FE430D051108A1DA7D1E8` |
| `tests/js/vf-wood-material-energy.test.mjs` | `b302516969cddc1758720ea1abe219d176da77ad` | `F75F6CCABB5698251D792085A9AB5E79749B40E1A6ADEE9889BE309059D94F7C` |

## Acceptance and recovery

MAT050O advances the 0.6 material-truth/white-furnace gate from a local
Schlick partition to a converged complete-hemisphere anisotropic GGX oracle.
Estimated 0.6.0 completion is **40.0%**, up **0.5 percentage points** from
MAT050N's 39.5%.

It does not add GGX to the renderer, solve multiple scattering, freeze a
measured wood BRDF, expose anisotropy controls, or change the public compact
PBR contract. Those remain separate renderer, research, and Language Design
Authority packets. Recovery is `git revert` of commits after `b598830a`; only
the private energy module, its test, and this evidence receipt are owned.
