# Dry-sand visible outlet and repose pile

Status: private incremental sand reference. No public VKF syntax, constructor,
schema, semantic, or performance claim changes.

## Gap closed

The physical hopper previously had a circular outlet boundary, but the WebGPU
proof rendered only a conical wall. Its open lower rim was difficult to read as
the exact discharge hole. This packet derives both the conical hopper and an
annular outlet plate from the authoritative solver dimensions. The plate's
inner ring is exactly `world.outletRadius` at `world.hopperBottom`; no second
visual outlet model exists.

The capture uses the existing fixed-step contact/friction/rolling solver,
oriented ellipsoid grain mesh, conservative dense aggregate, and unified WebGPU
renderer. It uses no sprite, texture motion, canvas fallback, or separate visual
simulation. The bounded proof scene contains 384 explicit grains with a 5x8
ellipsoid tessellation; this is a capture choice, not a performance claim.

## RED to GREEN

RED failed because the shared hopper-hardware packet did not exist. GREEN proves:

- packet identity contains one conical hopper and one annular outlet plate;
- every plate vertex lies at the solver's exact hopper-bottom coordinate;
- the plate minimum radius equals the physics outlet radius within `1e-7`;
- every annular triangle touches the exact inner outlet boundary and all
  indices are bounded;
- reset, shared-state rendering, mass conservation, penetration, repose,
  outlet scaling/clogging, Janssen, rotational state, oriented geometry,
  aggregate/BCRE, LOD, and no-canvas-fallback gates remain GREEN.

Focused and dependency result: **16/16 GREEN** (`11/11` hopper plus `5/5`
aggregate/LOD). `git diff --check` is GREEN.

The established physical trials remain unchanged: the 640-grain repose angle is
24.5501 degrees; the 512-grain discharge trial has zero mass error and terminal
persistent overlap 3.37% of grain diameter. This packet changes only how the
already-authoritative hopper boundary is exposed to the renderer and the bounded
evidence scene framing.

## Real WebGPU capture

`078-dry-sand-hole-pile-webgpu.png` is a 2017x865 Chrome unified-WebGPU frame.
It visibly shows grains crossing the circular plate hole, an active falling
stream, contact at the receiving plane, and the emerging bounded repose pile.
Self-inspection found the hole, stream, conical pile, individual nonspherical
grains, and support contact readable with no fallback surface. Application
exception state was empty. The installed WebGPU developer extension's known
extension-only error is excluded from application/WGPU results.

- SHA-256: `8B2B044D5557D184930F7F8B32AA903F25F3905156DE68CA62C0A0C7E2E5EBAA`

## Files

- `web/vf-ui/vf-sand-hopper-reference.mjs`
- `tests/js/vf-sand-hopper.test.mjs`
- `tests/fixtures/dry-sand-hopper-scene.mjs`
- `docs/evidence/078-dry-sand-hole-pile-webgpu.png`
