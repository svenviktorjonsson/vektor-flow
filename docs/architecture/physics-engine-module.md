# Physics Engine Module

The physics engine is a deep module under `vektorflow.physics`. It owns
simulation laws over topology truth. UI rendering, native scene staging, and
symbolic display may inspect physics state, but they should not reimplement
physics formulas.

## Package Seam

New code imports from:

- `vektorflow.physics`
- `vektorflow.physics.properties`
- `vektorflow.physics.dynamics`
- `vektorflow.physics.rigid_body`

The old top-level modules remain compatibility adapters:

- `vektorflow.physics_properties`
- `vektorflow.physics_dynamics`
- `vektorflow.physics_rigid_body`

Those adapters should stay thin. Physics implementation belongs in the package.

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
