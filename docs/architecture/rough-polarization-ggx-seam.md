# Rough-surface polarization GGX seam

Status: private 0.6 reference contract. It changes no public VKF syntax,
material API, schema, ABI, compiler lowering, runtime, or shader.

## Deterministic orientation ensemble

The bounded oracle treats an isotropic rough surface as a deterministic
ensemble of GGX microfacet orientations. Perceptual roughness `r` maps to
`alpha = r^2`. For stratified radial sample `u`, the GGX inversion is:

```text
tan(theta_m)^2 = alpha^2 u / (1 - u)
```

Azimuth uses a fixed golden-ratio sequence. There is no mutable random state,
so identical wavelength, optical constants, angle, roughness, and sample budget
produce bit-identical matrices independent of demand order.

The sample budget is an integer from 1 through 4096. Microfacets facing away
from the incident direction are rejected; accepted samples retain equal weight
because orientations were drawn from the GGX normal distribution itself. The
reported requested and accepted counts make the finite quadrature observable.

## Polarized facet composition

For every accepted microfacet:

1. derive its incidence-plane `s` axis;
2. compute the signed rotation `psi` from the macro incidence basis;
3. interpolate `n(lambda) + i k(lambda)` at the requested wavelength;
4. evaluate the complex absorbing Fresnel Mueller matrix at the facet's local
   incidence cosine; and
5. return the facet matrix to the shared macro basis:

```text
M_facet_macro = R(-psi) M_fresnel(lambda) R(psi)
```

The rough-surface matrix is the arithmetic mean of those common-basis facet
matrices. At zero roughness the oracle bypasses sampling and returns the exact
smooth absorbing Fresnel matrix. Thus wavelength phase, U/V coupling, and
mirror handedness are inherited rather than reconstructed from RGB.

## Depolarization and energy

A smooth deterministic facet maps a fully polarized Stokes state to another
fully polarized state. A rough ensemble mixes differently rotated incidence
planes and therefore generally lowers:

```text
degree = sqrt(Q^2 + U^2 + V^2) / I
```

This is physical ensemble depolarization, not an arbitrary roughness multiplier
on Q, U, or V. Because every facet matrix is passive and the average is a
convex combination, the result retains:

```text
0 <= I_reflected <= I_incident
sqrt(Q^2 + U^2 + V^2) <= I_reflected
I_absorbed = I_incident - I_reflected
```

The averaged matrix can be used as one bounce in the existing ordered
Mueller/Stokes multiple-reflection product.

## Evidence boundary

`tests/js/vf-rough-polarization-transport.test.mjs` covers deterministic
sampling, bounded work, the exact smooth limit, roughness-induced
depolarization, wavelength-aware absorbing composition, and passive energy.
Its implementation is test-only.

This seam is an orientation-ensemble oracle, not yet a complete directional
microfacet BRDF estimator. Smith masking/shadowing, the reflection Jacobian,
multiple scattering compensation, anisotropic GGX, finite-area illumination,
and production GPU integration remain later bounded packets.
