# Dry-sand rotational state and oriented grain shape

Status: private incremental sand reference. No public VKF syntax, constructor,
schema, semantic, or performance claim changes.

## Gap closed

The previous hopper state retained bounded grain aspect, quaternion orientation,
angular velocity, friction, and rolling-resistance values, but contacts never
generated rotation and its real renderer averaged every grain to a sphere.

This packet retains the existing fixed-step translational/contact solver and
adds bounded contact torque from tangential grain relative motion, rolling
coupling at the receiving plane, quaternion integration, and normalization.
The WebGPU fixture now consumes those exact positions, orientations, and three
aspect components as one dynamic, indexed ellipsoid mesh. It does not use a
sprite, texture animation, image fallback, or separate visual simulation.

This is an evidence-backed subset rather than a claim of full rigid ellipsoid
contact. The positional exclusion still uses the documented effective spherical
contact radius while rolling resistance approximates nonspherical hindrance.
That bounded approximation is consistent with published comparisons of rolling
resistance as an effective particle-shape parameter.

Research basis:

- Cundall and Strack (1979), explicit particle-by-particle/contact-by-contact
  distinct-element dynamics: https://doi.org/10.1680/geot.1979.29.1.47
- Estrada et al. (2011), rolling resistance as an effective angular-shape
  parameter: https://arxiv.org/abs/1105.4418

## RED to GREEN

The RED import failed because no oriented-ellipsoid packet existed. GREEN proves:

- contact-driven angular velocity is nonzero after discharge;
- every quaternion remains within `2e-6` of unit length;
- same-seed position/orientation/angular bytes replay exactly;
- dynamic vertices change after stepping and directly retain authoritative SoA
  position/orientation references;
- finite indexed geometry, exact bounded triangle count, and less than 2 MiB for
  the 96-grain focused fixture;
- previous mass, overlap, repose, outlet-scaling, Janssen, reset, aggregate,
  LOD, and no-canvas-fallback gates remain GREEN.

Focused and dependency result: **15/15 GREEN** (`10/10` hopper plus `5/5`
aggregate/LOD). `git diff --check` is GREEN.

## Real WebGPU capture

`077-dry-sand-oriented-grains-webgpu.png` is a 2017x865 Chrome unified-WebGPU
frame showing the hopper, falling stream, and receiving pile rendered from the
oriented mildly nonspherical particle state. Visual inspection found the stream,
pile, and hopper visible with no fallback surface. Application exception state
was empty and renderer WebGPU initialization completed. The installed WebGPU
developer extension emitted its own known extension error; it is explicitly not
counted as an application/WGPU error.

- SHA-256: `CAE208789869A9F1BDFD3883FF4B289774B754FBD72878D06C58246C29253753`

## Files

- `web/vf-ui/vf-sand-hopper-reference.mjs`
- `tests/js/vf-sand-hopper.test.mjs`
- `tests/fixtures/dry-sand-hopper-scene.mjs`
- `docs/evidence/077-dry-sand-oriented-grains-webgpu.png`
