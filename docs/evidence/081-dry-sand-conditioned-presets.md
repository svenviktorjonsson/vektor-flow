# Conditioned fine/coarse dry-sand presets

Status: private deterministic sand-species reference. No public VKF syntax,
constructor, schema, semantic, or performance claim changes. These are bounded
authored comparison presets, not measured commercial or geological products.

## Shared truth

Each grain now retains one conditioned size scale alongside its existing aspect,
orientation, angular velocity, position, and velocity SoA state. Four independent
bounded uniform samples form a centered approximate-normal size draw. Presets
own mean diameter, size spread, longitudinal/transverse aspect ranges, friction,
rolling resistance, and restitution as one coherent descriptor.

- `fine`: mean diameter `0.042 m`, size spread `0.12`, narrower/rounder shape
  range, friction `0.52`, rolling resistance `0.08`, restitution `0.05`.
- `coarse`: mean diameter `0.065 m`, size spread `0.22`, broader/more angular
  shape range, friction `0.66`, rolling resistance `0.16`, restitution `0.03`.

The conditioned radius drives grain-pair exclusion, boundary/plane contact,
contact-point spin, discharge classification, pile-surface measurement, sphere
instances, and oriented ellipsoid vertices. Renderer packets retain the exact
authoritative size-state reference. No separate visual size distribution exists.

## RED to GREEN

RED first found no preset or size state. A second RED showed two enlarged grains
were separated only by the old constant diameter. A third RED showed the
ellipsoid packet did not retain the authoritative size view. GREEN proves:

- same preset/seed reproduces size bytes exactly;
- fine/coarse size and aspect populations remain finite and within preset bounds;
- broad-phase/contact resolution uses the conditioned sum of pair radii;
- render geometry consumes the same size SoA;
- fine/coarse comparison fixture uses real unified WebGPU with no canvas/image
  fallback;
- default standard-preset reset, mass, penetration, repose, outlet scaling,
  Janssen, friction/restitution/rolling, aggregate/BCRE, and LOD gates remain GREEN.

Full result: **23/23 GREEN** (`18/18` hopper/preset/contact plus `5/5`
aggregate/BCRE/LOD). `git diff --check` is GREEN.

## Measured fixed-condition comparison

Both trials use seed `0x8123`, 384 grains, a 4.2-mean-diameter outlet, and six
seconds of the same fixed-step solver.

| Metric | Fine | Coarse |
| --- | ---: | ---: |
| Realized mean diameter | `0.0420654982 m` | `0.0651858379 m` |
| Mean discharge rate | `117.5510253/s` | `85.1908419/s` |
| Repose angle | `24.1411958 deg` | `25.5036683 deg` |
| Settled RMS speed | `0.0260773 m/s` | `0.0836666 m/s` |
| Persistent penetration | `0.0007613 m` | `0.0012023 m` |
| Discharged grains | `384` | `372` |
| State hash | `fa401ee7` | `279af0b6` |

For the 192-grain population probe, fine size CV is `0.0353423` over
`[0.9115468, 1.1031936]`; coarse size CV is `0.0647193` over
`[0.8378358, 1.1891882]`. Coarse flow is 27.53% lower and its repose angle is
1.36 degrees higher under this pinned condition. No universal material law is
claimed from one authored comparison.

## Real WebGPU capture

`081-dry-sand-fine-coarse-webgpu.png` is a 2017x865 Chrome unified-WebGPU frame.
Fine sand is left; coarse sand is right. Self-inspection found the smaller,
faster-discharged fine population and larger, slower coarse population visibly
distinct in retained hopper fill, stream, grain size/shape, and receiving pile.
Application exception state was empty.

- SHA-256: `6EB02DFC4A92FDCF1C67570CBF5ADD1344450333914A2F0778545E1A3C9A6780`

## Files

- `web/vf-ui/vf-sand-hopper-reference.mjs`
- `tests/js/vf-sand-hopper.test.mjs`
- `tests/fixtures/dry-sand-presets.html`
- `tests/fixtures/dry-sand-presets-scene.mjs`
- `docs/evidence/081-dry-sand-fine-coarse-webgpu.png`
