# Vektor Flow Context

## Domain Language

- **VKF source bundle**: A `.vkf` source file plus any generated runtime payloads
  needed to run it as a compiled executable.
- **Native scene staging**: The native step that turns VKF scene/UI source into
  overlay-ready web session files and a manifest.
- **Compiled scene executable**: A standalone `.exe` copied from the native VKF
  runner with the current scene bundle appended to it.
- **Axis mode deck**: The graphical API test deck in
  `examples/100_axis_4_panel.vkf`, covering 2D crosshair, 2D box, 2D polar,
  3D crosshair, and 3D box axis modes.
- **Physics engine**: The VKF simulation module that owns mechanical, thermal,
  fluid, granular, and electromagnetic laws over topology truth.
- **Physics property core**: The physics module that resolves canonical geometry
  and material symbols such as `L`, `A`, `V`, `m`, `q`, `T`, `v`, `w`, and `I`.
- **Rigid body core**: The physics module that owns mass, center of mass,
  inertia tensor, rigid stiffness semantics, gravity, force, and torque stepping.
- **Contact core**: The future physics module that will own collision detection,
  contact manifolds, friction constraints, and collision matrix solving.
- **Thermal core**: The future physics module that will own temperature,
  diffusion, heat transfer, and thermal coupling.
- **Transport core**: The future physics module that will own air friction,
  viscosity, liquid motion, sand, and other continuum or particle transport.
- **Electromagnetic core**: The future physics module that will own charge
  transfer and Maxwell-equation simulation.
