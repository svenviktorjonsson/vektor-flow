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
- **Color Field**: A VKF UI field that evaluates normalized weighted colors from
  point or segment sources and renders them through reusable raster adapters.
- **Physics engine**: The VKF simulation module that owns mechanical, thermal,
  fluid, granular, and electromagnetic laws over topology truth.
- **Physics stdlib**: The VKF `:physics` namespace for dimension basis
  quantities, unit constants, prefixes, and unit-checked quantity arithmetic.
  Geometry-derived properties such as `L`, `A`, and `V` are owned by the
  geometry/UI model that creates the topology.
- **Physics property core**: The physics module that resolves canonical geometry
  and material symbols such as `L`, `A`, `V`, `m`, `q`, `T`, `v`, `w`, and `I`.
- **Rigid body core**: The physics module that owns mass, center of mass,
  inertia tensor, rigid stiffness semantics, gravity, force, and torque stepping.
- **Contact core**: The physics module that owns rigid collision response,
  contact manifolds, friction constraints, and joint linear/angular impulse solving.
- **Thermal core**: The physics module that owns temperature diffusion,
  conductive networks, heat sources, and emissive radiative exchange.
- **Transport core**: The future physics module that will own air friction,
  viscosity, liquid motion, sand, and other continuum or particle transport.
- **Electromagnetic core**: The physics module that owns electrostatic Poisson
  solving, Maxwell-equation stepping, and global electric and magnetic fields.
- **Escaping property**: A geometry-authored field source whose influence leaves
  its source geometry and is therefore published as a globally sampleable field.
- **Layered Screen Scene**: the retained VKF scene compositor that guarantees
  Face, Edge, Vertex, overlay, and selection ordering before GPU-buffer commit.
- **Symbolic Document Runtime**: the VKF module that owns scoped definitions,
  incremental document-island compilation, and compiler publication order while
  products provide only their document-segmentation profile.
- **Automatic structural call lifting**: the core call rule that applies a
  one-parameter function at each maximal compatible substructure of a tuple,
  record, or vector. The normal conversion relation decides compatibility
  (`int` to `num` is compatible; `str` to `num` is not), incompatible metadata
  is preserved, and an exact whole-argument match always takes precedence.
- **Axis-tagged outer product**: arithmetic between values tagged with distinct
  axes such as `->i` and `->j` appends those axes and preserves one tensor rank
  per distinct axis. Matching axes remain elementwise.
- **Static named map**: a `collections.map` whose keys are named arguments known
  at compile time. It uses the core typed-record layout and preserves each
  value's exact type; runtime-key maps remain a distinct dynamic collection.
