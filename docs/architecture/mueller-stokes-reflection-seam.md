# Mueller/Stokes multiple-reflection seam

Status: private 0.6 material/reference contract. It changes no public VKF
syntax, material API, schema, ABI, compiler lowering, runtime, or shader.

## Spectral execution model

Transport is evaluated independently at each wavelength sample before any
visible-color projection. The scalar refractive indices in this bounded oracle
therefore mean `n_incident(lambda)` and `n_transmitted(lambda)` for one sample.
A spectral implementation repeats the same operation with its dispersive index
values and retains invisible wavelengths in the energy account.

## Stokes and basis convention

The Stokes vector is `[I, Q, U, V]`, with `Q = I_s - I_p`. The local transverse
basis is the right-handed `(s, p, propagation)` frame of the current incidence
plane. Rotating coordinates by `psi` into a new incidence basis uses:

```text
I' = I
Q' =  Q cos(2 psi) + U sin(2 psi)
U' = -Q sin(2 psi) + U cos(2 psi)
V' = V
```

The doubled angle is essential: polarization orientation has period `pi`, not
`2 pi`. Each bounce records its basis rotation relative to the preceding ray's
transported basis.

## Dielectric reflection

For real, non-absorbing indices and incidence below total internal reflection,
Snell's law gives `cos(theta_t)`. Signed field-amplitude coefficients are:

```text
r_s = (n_i cos(theta_i) - n_t cos(theta_t))
      / (n_i cos(theta_i) + n_t cos(theta_t))
r_p = (n_t cos(theta_i) - n_i cos(theta_t))
      / (n_t cos(theta_i) + n_i cos(theta_t))
```

With `R_s = r_s^2`, `R_p = r_p^2`, the Mueller reflection matrix is:

```text
1/2 [ R_s + R_p, R_s - R_p,       0,       0 ]
    [ R_s - R_p, R_s + R_p,       0,       0 ]
    [           0,           0, 2r_sr_p,   0 ]
    [           0,           0,       0, 2r_sr_p ]
```

Unspecified incident polarization means `[I, 0, 0, 0]`, not an arbitrary
linear state. At Brewster incidence `r_p = 0`, so p-polarized reflection is
extinguished while s-polarized reflection remains.

## Multiple reflections and handedness

For bounce `j`, transport is:

```text
S_(j+1) = M_j R(psi_j) S_j
```

This ordered matrix product preserves polarization through arbitrary sequences
of incidence planes. It cannot be replaced by multiplying RGB reflectivities.

The signed amplitude product retains reflection handedness. At normal
air-to-dielectric incidence `r_s` and `r_p` have opposite signs, so one mirror
reflection reverses `V`; two reflections restore its sign while their energy
losses multiply. Moving the sign outside the matrix or reflecting the view
twice would regress this invariant.

## Physical bounds and scope

For every physical input, the passive dielectric oracle requires:

```text
0 <= I_reflected <= I_incident
sqrt(Q^2 + U^2 + V^2) <= I_reflected
```

The focused tests cover unpolarized defaults, basis rotation, Brewster
incidence, physical Stokes bounds, and one/two-bounce mirror handedness. Complex
indices, absorbing conductors, total-internal-reflection phase, transmission
Mueller matrices, rough-surface depolarization, and production spectral
integration remain later bounded slices.

Executable evidence lives in
`tests/js/vf-mueller-reflection-transport.test.mjs`; its helper is deliberately
test-only.
