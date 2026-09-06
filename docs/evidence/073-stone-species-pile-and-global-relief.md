# Stone species pile and global fine relief evidence

Status: bounded static rendering packet. The placement is deterministic authored
settling, not a physics simulation. No public VKF syntax or API changed, and the
fine relief adds no geometry.

## Specimen

- 20 closed stone meshes: four individuals from each of gray granite, red
  granite, pale quartzite, dark basalt, and banded gneiss profiles.
- Each individual has a distinct conditioned geology identity and geometry hash.
- Total retained geometry: 51,880 vertices, 103,680 triangles, 4,772,000 vector
  bytes (below the 5 MiB test bound).
- Each mesh has 2,594 vertices, 5,184 triangles, zero boundary edges, and a
  nonplanar rounded underside. Upper-layer stones have at least two projected
  supports; the base layer is grounded.
- Species selection changes private shape proportions, mineral albedo, and
  roughness distributions while retaining the same object-space triplanar R8
  fine-relief field.

## R8 fine-relief probe

Representative 16x16 conditioned probe: empty coverage tile fraction `0`,
minimum tile coverage `0.5`, tile-coverage coefficient of variation
`0.13229042537207494`, R7 amplitude ratio `0.653381445229219`, resolved-footprint
amplitude ratio `1`, left/right microshadow reversal fraction `0.5078125`, R5
density ratio `2.710691823899371`, and R5 median-radius ratio
`0.4677966101694916`. Coordinates are `object-triplanar-global`.

## Captures

All captures are 1318x777 real WebGPU frames with zero runtime/WGPU errors.

| Capture | SHA-256 |
| --- | --- |
| `070-weathered-granite-global-micro-overhead.png` | `9C517F2AF08A9BAF3E82AC0950FDEACB0EAF4DE69DE8383EC7E69FD896D0C9C4` |
| `070-weathered-granite-global-micro-close.png` | `327CA78FC907AA06758BFE00AB6E88F0B30273637FD5E497299481A7EC2916E3` |
| `070-weathered-granite-global-micro-left.png` | `AF637E26D9D72E6E1CADED31DB2AE553DED9FB9FBD731DA93E3E2204F0B5BD4F` |
| `070-weathered-granite-global-micro-right.png` | `89C893079E9084C02AF1A7B3367186384BB051D03B7B898F85AB2839C429D3BC` |
| `071-stone-species-pile-hero.png` | `F0E8BF61B45D8311572ABE437CEDA1F98DBD0846D63CC78D6C5DC25575C776B6` |
| `071-stone-species-pile-alternate.png` | `62054B85A181E377A8497536772DC7E9E34F9F9DDDB0761267CD4E558FB2A2E4` |

The hero frame was captured twice and both PNGs have the same SHA-256, proving
byte-exact deterministic replay for the fixed camera, lights, identities, and
renderer state.

## Gates

`node --test` over all 14 rock/stone/granite test files: **54/54 passed** in
34.560 seconds. The four pile tests cover exact species counts, distinct seeds
and forms, closed/nonplanar geometry, deterministic replay, grounded/projected
support, bounded memory, species material mapping, global fine-relief coverage,
and directional reversal. `git diff --check` reports no whitespace errors.

No performance claim is made. Microrelief remains a bounded fragment-material
variant; triangle and vertex counts are unchanged by enabling it.
