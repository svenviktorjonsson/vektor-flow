# Dry-sand contact-law refinement

Status: private deterministic solver refinement. No public VKF syntax,
constructor, schema, semantic, or performance claim changes.

## Contact truth

The fixed-step hopper previously stored friction, restitution, and rolling
resistance coefficients, but restitution did not affect grain impacts, friction
used an unbounded slip fraction, and rolling resistance damped grains even in
free flight. This packet keeps the same authoritative particle SoA, projection
iterations, hopper boundary, aggregate handoff, and WebGPU renderer while
refining only grain contact velocity response.

- Equal-mass normal impulses now target the configured coefficient of
  restitution for approaching contacts.
- Tangential impulse includes both linear slip and contact-point spin, and is
  clamped by the Coulomb `mu * normalImpulse` bound without reversing slip.
- Rolling resistance dissipates angular motion only at grain or receiving-plane
  contact. Free-flight spin is unchanged.
- The existing mildly nonspherical shape/rolling approximation remains explicit;
  this is not a claim of exact ellipsoid contact.

The model remains the bounded distinct-element/PBD reference documented in the
earlier sand receipts, based on Cundall and Strack's particle/contact dynamics
(https://doi.org/10.1680/geot.1979.29.1.47) and rolling resistance as an
effective shape parameter (https://arxiv.org/abs/1105.4418).

## RED to GREEN

Three focused REDs proved the previous gaps: restitution produced identical
rebound, rolling resistance damped free flight, and tangential impulse exceeded
its Coulomb impact bound. GREEN proves coefficient-sensitive rebound,
contact-only rolling dissipation, and bounded non-reversing slip.

Full result: **19/19 GREEN** (`14/14` hopper/contact plus `5/5`
aggregate/BCRE/LOD). Existing reset, mass, outlet-scaling/clogging, Janssen,
penetration, orientation replay, shared rendering, exact outlet, and no-fallback
contracts remain GREEN. `git diff --check` is GREEN.

The unchanged 640-grain validation condition now reports repose angle
`24.990147889765765 deg`, settled RMS speed `0.025952086434388063 m/s`, maximum
persistent penetration `0.0008558921318988361 m` (`1.65%` of diameter), all
640 grains discharged, and deterministic state hash `36d513f7`.

## Real WebGPU capture

`080-dry-sand-contact-laws-webgpu.png` is a 2017x865 Chrome unified-WebGPU frame
from the refined solver state. Self-inspection found the exact circular outlet,
active grain stream, individual oriented grains, receiving-plane contact, and a
wider stable repose pile readable. The renderer consumes the same particle SoA;
there is no sprite, canvas, image, or separate visual simulation. Application
exception state was empty.

- SHA-256: `2CF7A6B642F7A7E62D31B58BDCEC8A3E5514A2F90C51C3572D9C27B2617EAAD2`

## Files

- `web/vf-ui/vf-sand-hopper-reference.mjs`
- `tests/js/vf-sand-hopper.test.mjs`
- `docs/evidence/080-dry-sand-contact-laws-webgpu.png`
