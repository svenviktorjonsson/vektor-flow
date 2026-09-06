# Dry sand conservative aggregate and distance LOD

Status: second bounded granular-flow packet. This remains an internal browser
reference; it changes no public VKF syntax or API and makes no performance
claim.

## Conservative handoff

Settled explicit grains transfer once from the authoritative hopper SoA into a
33x33 dense height state. The explicit grain instance radius becomes zero only
after the corresponding `aggregated` bit is set, so the grain cannot be drawn
twice. `world.render.aggregate` points at the same aggregate state used by the
transport step.

The fixed capture state contains 320 grain masses: 206 in the dense aggregate
and 114 explicit/active. Aggregate mass is `23.962546052567692 kg`, equal to 206
times the fixed `0.11632303909013442 kg` grain mass. Repeating the same transfer
is a no-op.

## BCRE-style relaxation

The fixed `1/120 s` transport pass moves only height excess above the declared
31-degree repose slope between neighboring cells. Transfers are paired and
mass-conservative. The capture state finishes at `31.11846480687455 degrees`;
an injected 78.3-degree spike relaxes to 31 degrees in the quantitative gate.
Rolling-mass diagnostics stay finite and nonnegative.

Height identity:

- compact height revision: `84267583`
- height SHA-256: `4fd050c55f71bbc0525d1fbd8ae8f327b24c02eb77f0658f91e2a30b419ab255`
- conditioned glint SHA-256: `8af2af0c75922ebb8a2d030b2e95c53e07ca41165b23f7f97d08762026733f9e`

## Shared distance views

All packets retain the same source height revision and derive normals,
high-roughness specular response, sparse conditioned glints, and opacity from
that state:

| LOD | Vertices | Triangles | Vector/index bytes |
| --- | ---: | ---: | ---: |
| near | 1,089 | 2,048 | 68,136 |
| mid | 289 | 512 | 17,704 |
| far | 81 | 128 | 4,776 |

The glint field is byte-identical for replay and changes with a different
conditioned sand identity. Geometry values and indices are finite and bounded.

## Real WebGPU proof

`075-dry-sand-hybrid-webgpu.png` is a 2016x795 unified WebGPU frame showing the
circular hopper, retained active grain stream, and the softly bounded dense
aggregate footprint on the receiving plane. SHA-256:
`DE324579508559BDA477F9C915890A29482FC694A4BCB8FD68F8EDC40C46156D`.

The page reports no application error and emitted no shader, validation, or
WGPU error. Browser-extension diagnostics are excluded from the application
error count.

## Gates

The five new RED-to-GREEN tests cover conservative one-time transfer,
byte-exact replay and seed variation, BCRE mass/slope invariants, shared-revision
near/mid/far reduction, and height-derived normal/specular/glint channels.
Combined sand, physics-engine, physics-render-hook, and GPU pass-through cohort:
**53/53 passed** in 36.789 seconds. `git diff --check` reports no whitespace
errors.
