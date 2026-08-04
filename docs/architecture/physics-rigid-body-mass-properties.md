# Physics Rigid Body Mass Properties

The rigid-body mass-property path uses exact tetrahedral volume integrals for
the current VKF volume-element representation. For a tetrahedron with uniform
density, the center of mass is the average of its four vertices and the second
moment matrix is integrated over the tetra volume before converting to the
inertia tensor.

For closed polygonal surface meshes without authored tetra volume elements, the
target algorithm is Mirtich-style polyhedral mass properties: reduce volume
integrals to surface integrals, then aggregate mass, center of mass, and inertia
tensor. That path should be added as a mesh-lowering step rather than replacing
the volume-element path.

Stiffness constants use these running-mode semantics:

- `0`: free, no spring constraint force
- finite number: spring/damper relation
- `inf`, `infinity`, or `rigid`: rigid constraint, handled by rigid-body mass
  properties and inertia tensor rather than infinite spring force

Uniform gravity applies a force at the center of mass and therefore translates a
free rigid body without inducing torque. Rotation comes from off-center forces,
non-uniform force fields, contacts, constraints, or later collision impulses.
