# MAT010D-LT: measured stone-mineral spectral transport

Date: 2026-09-03

## Packet

- Release gate: MAT-010 statistical/material correctness.
- Base: `d9fce929c9535b2ff5e07deb7ca2c2eef0aca39d`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Scope: private native reference transport over the existing MAT-010D
  measured stone sample.
- Public VKF syntax, API, schema, ABI, diagnostics, compiler, renderer, UI,
  and 0.4.1 paths: unchanged.
- Owned paths:
  - `native/material/vf_stone_mineral_spectral_transport.hpp`
  - `native/material/vf_stone_mineral_spectral_transport_test.cpp`
  - `docs/evidence/060-mat010d-stone-mineral-spectral-transport.md`

## Observable internal behavior

The tracer composes the existing validated MAT-010B stone population and
MAT-010D dominant-mineral condition before transporting one nonnegative
incident spectral contribution at the measured 450, 550, and 650 nm bands.
For each band it computes:

```text
projected = incident radiance * incidence cosine
reflected = projected * measured conditioned reflectance
absorbed = projected - reflected
```

Thus the exact conditioned specimen and population factors reach light
transport while `reflected + absorbed = projected`. The existing measured
pipeline continues to validate the CC0 USGS source DOI, pinned archive hash,
licence, calibrated center, and evidence compatibility before producing the
sample.

Changing dominant-mineral identity changes reflected energy. Roughness,
reflectivity, and local variation remain untouched because MAT-010D does not
measure those effects. Inflating every local spectral-fit standard error by
100 times leaves the transported result identical, proving measurement error
is not sampled as material variation.

Negative or non-finite incident radiance and a non-finite or out-of-range
incidence cosine are rejected before transport. The cosine is bounded to
`[0, 1]` and work is fixed at three bands.

This packet deliberately does not infer a refractive index, extinction
coefficient, polarized Fresnel response, GGX multiple scattering, or a
wavelength outside the measured bands. Those require separate evidence; the
current tracer is only the passive measured-reflectance energy split.

## RED to GREEN

Strict command for both cycles:

```text
clang++ -std=c++20 -O2 -Wall -Wextra -Werror -pedantic -I. native/material/vf_stone_mineral_spectral_transport_test.cpp -o .work/060-mat010d-stone-mineral-transport/vf_stone_mineral_spectral_transport_test.exe
.work/060-mat010d-stone-mineral-transport/vf_stone_mineral_spectral_transport_test.exe
```

1. Measured spectral-energy tracer:
   - RED compile exit 1: `vf_stone_mineral_spectral_transport.hpp` was absent.
   - GREEN exit 0: mineral identity reached reflected energy, all three bands
     closed passive energy, unrelated properties were preserved, and a 100x
     fit-error perturbation left the result identical.
2. Malformed illumination:
   - RED run exit 1: negative incident radiance was accepted.
   - GREEN exit 0: negative/non-finite incident values and invalid incidence
     cosines were rejected with `std::invalid_argument`.

Pinned GREEN output:

```text
stone mineral spectral transport: reflected=0.0912475,0.0540269,0.0498778 passive=true fit_error_sampled=false
```

## Verification receipt

Environment:

```text
Microsoft Windows NT 10.0.26200.0, X64
clang version 22.1.4 (llvm-project 35990504507d79e0b9deb809c8ee5e1b34ceef20)
```

Focused strict dependency chain compiled and ran five executables in 28.58 s:

```text
vf_material_reference_fit_test
vf_material_researched_preset_test
vf_material_population_distribution_test
vf_stone_mineral_conditioned_distribution_test
vf_stone_mineral_spectral_transport_test
```

Result: 5 passed, 0 failed. The existing conditioning test retained:

```text
conditions=3 members=12
source_sha=D232645740869A82AAFCAD5839448C50B1DC72965CE042D1374F29B7A798A91C
fit_error_sampled=false population_integrated=true
```

SHA-256 at GREEN:

| Artifact | SHA-256 |
| --- | --- |
| reference header | `5AF70668689024A710D3F84AE1FA587C08D7EA73BFC5273224C619A518135B26` |
| behavior test | `00C0121FF998A1B740AB243A63D5950C34A60A6C65BDC0A38D17260A963E4125` |
| strict test executable | `02CF4809FC136746B0088D2EB5736EE90DFA4FF2B72EB9D62E8E543296D93DCA` |

## Handoff

The new module is private, fixed-work, CPU-only, and consumed only by its
native reference test. Reverting this packet cannot alter current VKF output,
renderer behavior, or any public contract. No language-design decision is
needed. A later renderer packet may consume the measured bands only after its
own internal record ownership and target-parity evidence are assigned.
