# Absorbing spectral Fresnel seam

Status: private 0.6 reference contract. It adds no public VKF syntax, material
API, schema, ABI, compiler lowering, runtime, or shader behavior.

## Optical-constant sampling

An absorbing interface supplies measured wavelength samples of the complex
refractive index:

```text
N(lambda) = n(lambda) + i k(lambda)
```

The reference linearly interpolates `n` and `k` independently between adjacent
measured samples. It returns an exact tabulated value at a sample wavelength
and rejects requests outside the measured range. Silent extrapolation would
invent material behavior and is not permitted.

The extinction coefficient `k` is nonnegative for this passive convention.
Each requested spectral sample is transported independently before visible
color conversion, so infrared reflection and absorption remain in the energy
account.

## Complex Fresnel transport

For a real incident-medium index `n_i`, complex transmitted index `N`, and real
incidence cosine `c_i`, complex Snell transport is:

```text
s_t^2 = (n_i / N)^2 (1 - c_i^2)
c_t   = sqrt(1 - s_t^2)
```

The square-root branch has nonnegative real part. Signed complex reflection
amplitudes retain both power and relative phase:

```text
r_s = (n_i c_i - N c_t) / (n_i c_i + N c_t)
r_p = (N c_i - n_i c_t) / (N c_i + n_i c_t)
```

Let `R_s = |r_s|^2`, `R_p = |r_p|^2`, and
`z = r_s conjugate(r_p) = c + i d`. With the existing convention
`[I, Q, U, V]`, `Q = I_s - I_p`, the reflection matrix is:

```text
[ (R_s+R_p)/2, (R_s-R_p)/2,  0,  0 ]
[ (R_s-R_p)/2, (R_s+R_p)/2,  0,  0 ]
[             0,             0,  c, -d ]
[             0,             0,  d,  c ]
```

The off-diagonal `d` terms convert linear `U` polarization to circular `V`
and vice versa. Dropping them would preserve reflected intensity while losing
the phase state required by later mirror bounces. At `k = 0`, the matrix must
reduce exactly to the real dielectric Mueller oracle.

## Composition and passive energy

This matrix is one bounce in the existing ordered transport:

```text
S_(j+1, lambda) = M_j(lambda) R(psi_j) S_(j, lambda)
```

Every bounce first rotates into its incidence-plane basis, then applies the
wavelength-specific matrix. Repeating that operation supports multiple
absorbing and dielectric reflections without collapsing state to RGB.

For the passive, semi-infinite absorbing material represented by this bounded
oracle:

```text
0 <= I_reflected <= I_incident
sqrt(Q^2 + U^2 + V^2) <= I_reflected
I_absorbed = I_incident - I_reflected
```

Here `I_absorbed` means power entering a semi-infinite absorbing half-space and
eventually dissipated there. Finite layers require transmission matrices and
interference and are outside this slice.

## Evidence boundary

`tests/js/vf-absorbing-fresnel-transport.test.mjs` covers interpolation,
no-extrapolation, normal-incidence power, the real-dielectric limit, U/V phase
coupling, and passive Stokes bounds. Its helper is deliberately test-only.

Measured optical-constant provenance, validation of complete tables, complex
incident media, thin films, rough-surface depolarization, transmission Mueller
matrices, and production GPU integration remain later bounded packets.
