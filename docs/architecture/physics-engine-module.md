# Physics And Units

The VKF-facing `:physics` stdlib is the place for dimensions, unit constants,
prefixes, and quantity checks. Geometry-owned values such as edge length, face
area, and body volume belong to the geometry/UI model that creates the
topology, not to the public `:physics` namespace.

The compiler implementation still keeps physics-engine formulas in one internal
area so running mode has a single source of truth for dynamics. UI rendering,
native scene staging, and symbolic display may inspect physics state, but they
should not reimplement physics formulas.

## VKF Stdlib Surface

VKF code imports physics through:

```vkf
physics: .physics
d: physics.dimensions
s: d.L
t: d.T
x: 3 * physics.km
```

The stdlib surface owns:

- seven-dimensional basis quantities: `L`, `T`, `M`, `K`, `A`, `Cd`, `Mole`
- unit constants and aliases: `m`, `km`, `cm`, `mm`, `um`, `s`, `sec`,
  `second`, `seconds`, `min`, `minutes`, `h`, `d`, `month`, `months`, `y`
- prefixes through `physics.prefixes`
- quantity arithmetic where multiplication/division add or subtract dimension
  exponents
- addition, subtraction, equality, and ordering only between matching
  dimensions, or between unitless quantities/numbers
- math functions only over unitless quantities or plain numbers

## Internal Engine Area

New code imports from:

- `vektorflow.physics`
- `vektorflow.physics.properties`
- `vektorflow.physics.dynamics`
- `vektorflow.physics.rigid_body`

The old top-level modules remain compatibility adapters:

- `vektorflow.physics_properties`
- `vektorflow.physics_dynamics`
- `vektorflow.physics_rigid_body`

Those adapters should stay thin. Physics implementation belongs in this internal
compiler area.

## Current Modules

### Physics Property Core

File: `vektorflow/physics/properties.py`

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

File: `vektorflow/physics/dynamics.py`

Interface:

- density-lumped effective vertex masses
- axial edge spring/damper stepping
- orthogonal edge spring/damper stepping
- edge rotational spring/damper stepping

This module is for deformable edge-level running mode. It should not own rigid
body collision or contact solving.

### Rigid Body Core

File: `vektorflow/physics/rigid_body.py`

Interface:

- tetra volume mass properties
- rigid body mass aggregation
- center of mass
- inertia tensor
- parallel-axis shifting
- gravity, force, and torque stepping

The current mass-property implementation is exact for tetra volume elements. A
future closed-polyhedron adapter should use Mirtich-style mass properties and
then feed the same rigid-body interface.

## Planned Internal Seams

These are not separate packages yet. They are named now so future work has
locality and does not spread formulas across renderers or examples.

### Contact Core

Owns:

- broad phase
- narrow phase
- contact manifolds
- friction model
- collision matrix solving
- restitution and impulse integration

This is the next high-risk seam. Collision detection and contact solving should
enter through one interface, not through ad hoc geometry helpers.

### Thermal Core

Owns:

- temperature fields
- heat capacity
- conduction and diffusion
- heat sources and sinks
- thermal coupling to material properties

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

The `q` and `sigma_*` properties belong to the physics property core; field
evolution belongs here.

## Performance Direction

The package interface should stay small and data-oriented. Future performance
adapters may include:

- Python reference implementation for correctness
- native implementation for runtime stepping
- GPU implementation for field, fluid, granular, or electromagnetic solvers

One adapter is hypothetical. Add real adapter seams only when there are at least
two implementations or a clear runtime/codegen split.

## Test Surface

The interface is the test surface:

- property tests lock canonical symbols and material semantics
- dynamics tests lock edge stepping
- rigid-body tests lock mass properties, center of mass, inertia, gravity, force,
  and torque
- future contact tests should lock contact manifolds and matrix solve outputs
- future thermal/transport/electromagnetic tests should lock conservation and
  stability invariants
