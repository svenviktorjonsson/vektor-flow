# Dry sand hopper fixed-step reference

Status: first bounded granular-flow packet. This is an internal reference and
real WebGPU demonstration; it adds no public VKF syntax or API.

## State and solver

- One authoritative structure-of-arrays state owns 3D grain position,
  velocity, orientation, angular velocity, and bounded aspect variation.
- Rendering reads that state through one derived `sphere-list` instance buffer;
  there is no sprite, texture-motion, or JavaScript canvas fallback.
- Fixed step: `1/120 s`; four deterministic positional contact iterations.
- Contact parameters include friction `0.58`, rolling resistance `0.12`, and
  restitution `0.04`. A bounded spatial hash supplies grain contacts.
- Circular conical hopper-wall and outlet constraints share the physics frame.
  A deterministic three-grain throat occupancy rule retains a stable arch near
  a 2.2-grain-diameter opening.
- The receiving plane participates in contact solving. The visible pile is the
  particle state, not a separate render-only height field.

## Quantitative gates

The fixed fixtures report:

| Fixture | Result |
| --- | --- |
| 512 grains, 4.5D outlet | 512 discharged; rate `239.999987/s`; terminal persistent overlap `0.0017542 m` (`3.37%` of diameter); mass error `0` |
| 640 grains, 4.2D outlet, 7 s | repose angle `24.5501 deg`; settled RMS speed `0.00900 m/s` |
| Outlet 2.2D | deterministic arch; rate `51.1927/s` |
| Outlet 3.2D | rate `110.2262/s` |
| Outlet 4.5D | rate `241.8897/s` |
| Fill height 15D / 24D | rates `195.2542/s` / `217.4545/s`; relative difference `10.21%` |

Reset reproduces initial position bytes exactly. A repeated fixed-step trial
reproduces the complete state hash. The 384-grain fixture uses `24,960` vector
bytes, below its `256 KiB` gate. Grain aspect components remain in the bounded
`0.78..1.22` interval.

## WebGPU capture

`074-dry-sand-hopper-webgpu.png` is a 2016x865 frame captured from the real
unified WebGPU renderer. It shows 640 instanced active grains in the transparent
circular hopper, the discharging stream, and the forming plane pile.

SHA-256:
`05D3D0EE4BCC5CDE8F45F8C10A1307EF92A494A9964B014F646CA7975DEA88CE`.

The application emitted no shader, validation, or WGPU errors. Browser-extension
diagnostics are excluded from the application error count.

The combined sand, physics-engine, physics-render-hook, and GPU pass-through
cohort passed **48/48** gates: 47/47 in 36.801 seconds plus the final fixture
contract gate in 0.114 seconds. `git diff --check` reports no whitespace errors.

## Scope boundary

This packet deliberately establishes the active near-grain reference first.
The planned dense-interior BCRE/height-field state and mid/far procedural
normal/specular/glint LOD are not claimed here. No performance claim is made;
the CPU reference is the baseline to measure before an execution adapter is
selected.
