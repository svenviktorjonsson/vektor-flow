# Physics And Units

The VKF-facing `:physics` stdlib is the place for dimensions, unit constants,
prefixes, and quantity checks. Geometry-owned values such as edge length, face
area, and body volume belong to the geometry/UI model that creates the
topology, not to the public `:physics` namespace.

The compiler keeps physics-engine formulas in VKF stdlib modules so native and
WASM running modes share one source of truth for dynamics. UI rendering,
native scene staging, and symbolic display may inspect physics state, but they
should not reimplement physics formulas.

Platonic Play follows the same rule: it supplies stable editable topology
records, authored geometry and properties, input, and rendering. Constraints
and boundary relations remain VKF relations. VKF derives collision geometry
from the authored topology and returns authoritative physics state and
diagnostics through dense typed buffers. Moving or splitting an edge therefore
updates collision geometry immediately without duplicating collision rules in
Platonic Play.

## VKF Stdlib Surface

VKF code imports physics through:

```vkf
:.physics
:.physics.units

distance: 3km
duration: 2s
velocity: distance / duration
```

The stdlib surface owns:

- one compiler-owned seven-exponent dimension model over length, mass, time,
  current, temperature, amount, and luminous intensity
- an SI catalog under `physics.units` and `physics.units.si`, separate from the
  engine namespace
- SI base and coherent-derived unit constants, with the complete decimal
  prefix range synthesized from one catalog
- quantity arithmetic where multiplication/division add or subtract dimension
  exponents
- addition, subtraction, equality, and ordering only between matching
  dimensions, or between unitless quantities/numbers
- math functions only over unitless quantities or plain numbers

Units reveal dimensions, and ordinary arithmetic composes them:

```vkf
:.physics.units

area: 3m * 4m
velocity: 10m / 2s
force: 2kg * 3m / 1s^2
```

## Internal Engine Area

Physics semantics belong in VKF source under
`compiler/self_hosted/stdlib/physics.vkf`. No compatibility adapter remains.

## Current Modules

### Physics Property Core

Planned source: `compiler/self_hosted/stdlib/physics.vkf`

Interface:

- canonical geometry symbols: `L`, `A`, `V`
- material and state properties: `m`, `q`, `T`, `v`, `w`, `I`
- density-derived values: `rho_L`, `rho_A`, `rho_V`, `sigma_L`, `sigma_A`, `sigma_V`
- spring constants and stiffness semantics:
  - `0`: free
  - finite: spring/damper relation
  - `inf`, `infinity`, `rigid`: rigid path

This module is deliberately deterministic and symbolic-friendly. It should not
perform time stepping.

### Edge Dynamics Core

Planned source: `compiler/self_hosted/stdlib/physics.vkf`

Interface:

- density-lumped effective vertex masses
- axial edge spring/damper stepping
- orthogonal edge spring/damper stepping
- edge rotational spring/damper stepping

This module is for deformable edge-level running mode. It should not own rigid
body collision or contact solving.

### Rigid Body Core

Canonical source: `compiler/self_hosted/stdlib/physics.vkf`

Interface:

- tetra volume mass properties
- rigid body mass aggregation
- center of mass
- inertia tensor
- parallel-axis shifting
- gravity, force, and torque stepping

The VKF module compiles through the native artifact path and to a WASM artifact.
The historical compatibility adapter has been removed. VKF is the only source
of physics semantics.

The current mass-property implementation is exact for tetra volume elements. A
future closed-polyhedron adapter should use Mirtich-style mass properties and
then feed the same rigid-body interface.

## Internal Solver Seams

These are not separate packages yet. They are named now so future work has
locality and does not spread formulas across renderers or examples.

All vector, matrix, tensor, factorization, and linear-solve work belongs to the
separate `.linalg` module described by ADR 0007. `.physics` consumes that module
and must not retain parallel matrix implementations.

### Contact Core

Canonical model: `compiler/self_hosted/stdlib/physics.vkf`

Owns:

- broad phase
- narrow phase
- contact manifolds
- friction model
- collision matrix solving
- restitution and impulse integration

Collision detection and contact solving enter through this interface, not
through ad hoc geometry helpers.

The rigid, non-compliant material contract is:

- `e_n`: normal restitution, applied only above `restitution_threshold`
- `e_t`: tangential restitution after a contact enters the sticking branch
- `mu_s`: static Coulomb limit
- `mu_d`: dynamic Coulomb limit, constrained by `mu_d <= mu_s`
- `mu_r`: bounded rolling-resistance moment, scaled by contact radius and normal impulse

The solver maps the generalized impulse `delta P = (delta p, delta L)` through
all four blocks of the joint collision matrix. Tangential sticking and
normal-axis spin are solved as one coupled block. Sliding uses `mu_d`; static
contact uses `mu_s`. Rolling resistance acts in the tangent plane. Relative spin
acts about the contact normal and is not conflated with rolling. Persistent
contact uses the normal constraint impulse produced after external forces, so a
resting or inclined body retains a friction budget even when restitution is off.

Per-body material mixing uses maximum restitution and geometric-mean friction.
Callers needing measured pair data should provide a pair material explicitly.
Settled contact uses configurable linear/angular sleep thresholds and delay to
turn numerically negligible residual motion into exact persistent rest.

The browser 2D rigid-body reference accepts convex geometry in three forms:

- `localVertices`: a polygonal boundary
- `shape: { type: 'circle', radius }`: a full analytic circle
- `shape: { type: 'boundary', edges }`: an ordered, closed boundary whose edges
  are straight `segment` records or signed circular `arc` records

A segment records `from` and `to`. An arc records `center`, `radius`,
`startAngle`, and `sweepAngle`; the `cx`, `cy`, `r`, and `sweepRad` authoring
aliases are also accepted. Body `position` denotes the center of mass, so the
boundary is recentered internally without changing its authored output.

Mixed segment/arc area, centroid, and polar moment use closed-form Green
integrals. Collision projections query exact arc support points, and arc
contacts therefore use radial normals rather than chord normals. No arc
vertices are generated. Arbitrary interpolated edges remain a separate future
adapter: they can provide cached adaptive segments because their curvature is
not a single analytic primitive, while circular arcs should stay exact.

### Thermal Core

Owns:

- temperature fields
- heat capacity
- conduction and diffusion
- heat sources and sinks
- thermal coupling to material properties
- emissive Stefan-Boltzmann exchange with an environment

The browser reference implementation is exported from `vektor-flow/physics-engine`.
It provides conservative thermal networks and explicit finite-difference heat
fields with a checked stability limit.

The `T` property belongs to the physics property core, but diffusion and heat
transfer belong here.

### Transport Core

Owns:

- air friction
- viscosity
- liquid motion
- sand and granular flow
- particle/grid coupling

This seam can later choose adapters such as particle-based, grid-based, or
hybrid solvers without changing the rest of the engine.

### Electromagnetic Core

Owns:

- charge transfer
- electric and magnetic fields
- Maxwell-equation stepping
- coupling between fields, charges, and motion
- charged-particle motion with electric and magnetic Lorentz forces
- particle-particle charge interaction or a verified particle-in-cell
  approximation
- explicit plate boundaries and absorbing/open field boundaries
- SI-scaled fields, charges, masses, timesteps, and configurable time units

The browser reference implementation provides electrostatic Poisson solving and
time-domain Maxwell stepping for every vector component in one through three
spatial dimensions. It checks the Courant limit and publishes `E` and `B` as
global fields. Geometry properties marked as escaping use the same global-field
registry; disabled modules publish no symbols or fields.

The `q` and `sigma_*` properties belong to the physics property core; field
evolution belongs here.

Particle and field state uses structure-of-arrays typed buffers. The target
interface supports at least 100,000 particles without allocating one host
language object per particle.

## Performance Direction

The package interface should stay small and data-oriented. Future performance
adapters may include:

- native and WASM adapters executing the same canonical VKF source
- GPU adapters for field, fluid, granular, or electromagnetic kernels
- dense typed state buffers suitable for large particle clouds without
  per-particle host objects

One adapter is hypothetical. Add real adapter seams only when there are at least
two implementations or a clear runtime/codegen split.

## Test Surface

The interface is the test surface:

- property tests lock canonical symbols and material semantics
- dynamics tests lock edge stepping
- rigid-body tests lock mass properties, center of mass, inertia, gravity, force,
  and torque
- contact tests lock matrix outputs, Coulomb hold/slide thresholds, analytical
  sliding and rolling acceleration, rolling resistance, and exact settled rest
- future thermal/transport/electromagnetic tests should lock conservation and
  stability invariants
- dropped-ball impact time and restitution bounce height
- sliding-block stopping distance and time under declared friction
- live polygon collision while a wall vertex moves
- exact circle/polygon and circle/arc normals, impulses, and inertia
- electron-gun field trajectory, electron repulsion, and unit consistency
- native/WASM state and output parity within fixture-specific tolerances
