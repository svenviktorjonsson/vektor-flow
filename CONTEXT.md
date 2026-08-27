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
- **Physical dimension**: The target-independent compile-time fact that records
  exact exponents over the seven bases `L`, `M`, `T`, `Theta`, `I`, `N`, and
  `J`, independent of any unit system.
- **Unit**: An immutable compile-time descriptor that reveals one physical
  dimension and owns its exact scale, optional affine offset, quantity kind,
  prefix policy, aliases, and display symbol.
- **Quantity**: A numeric or symbolic magnitude carrying one physical dimension
  inferred from its unit or surrounding typed expression.
- **Unit catalog**: A `physics.units` module whose atomic units and aliases share
  one conversion and prefix-resolution interface.
- **Unit system**: A unit-catalog adapter such as `si`, `cgs`, `imperial`,
  `us_customary`, or `astronomical` that changes unit names, scales, and display
  preferences without changing physical dimensions.
- **Quantity literal**: Source such as `2km` or `2 km` that resolves through a
  spilled or qualified unit catalog into a typed quantity without general
  implicit multiplication.
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
- **Automatic vector call lifting**: the core call rule that first prefers an
  exact whole-argument match, then recursively descends only through vector
  layers until it reaches the function's exact parameter type. Conversions do
  not select lifted leaves. Tuples and records are atomic and require an exact
  parameter type or an explicit operator overload.
- **Axis-tagged outer product**: arithmetic between values tagged with distinct
  axes such as `->i` and `->j` appends those axes and preserves one tensor rank
  per distinct axis. Matching axes remain elementwise.
- **Static named map**: a `collections.map` whose keys are named arguments known
  at compile time. It uses the core typed-record layout and preserves each
  value's exact type; runtime-key maps remain a distinct dynamic collection.
- **Symbolic relation**: an unevaluated equality or ordered comparison between
  symbolic expressions. Relations are solver input. `=` is type-directed:
  ordinary values compare to a `bit`, while any symbolic operand constructs a
  `Relation`.
- **Symbolic proposition**: an expression with mathematical truth semantics.
  `Relation IS Proposition IS Expression`; infix `=>` combines propositions
  after relational precedence and preserves its premise and conclusion.
- **Symbolic condition**: a relation restricted to an evaluation point or a
  derivative at an evaluation point, such as `f(0) = 0` or `f'(0) = 2`.
- **Geometric boundary**: a symbolic value constraint paired with a domain
  relation through `where`, such as `f(x,y) = 1` on `x^2 + y^2 = 1`.
- **Symbolic problem**: governing relations plus ordered unknowns and conditions.
  ODE, PDE, recurrence, algebraic, and transform strategies consume this model.
- **Symbolic strategy planner**: the native VKF stdlib dispatch that classifies
  a symbolic problem and chooses an exact algebraic, transform, or differential
  strategy without a host-language solver.
- **Verified solution set**: an opaque native symbolic result whose candidates
  satisfy their declared domains and whose original residuals and conditions
  have been checked. It may be finite or an affine family represented by one
  particular point plus verified null-space directions. Construction alone
  never marks a solution as verified.
- **Linear algebra module**: the VKF `.linalg` stdlib module that owns numeric
  and exact-symbolic vector, matrix, tensor, factorization, and solve algorithms
  over ordinary rectangular nested vectors.
- **Scalar algebra seam**: the internal `.linalg` interface through which the
  numeric scalar adapter supplies tolerance-aware arithmetic and the symbolic
  scalar adapter supplies exact zero proofs, assumptions, and simplification.
- **Transform module**: the VKF `.transforms` stdlib module that owns Fourier,
  Laplace, Z, and wavelet transforms. The same operation names dispatch on
  exact input type: numeric vectors use numerical algorithms while symbolic
  expressions use analytic rules and return verified symbolic expressions.
- **Physics state buffer**: a dense, deterministic typed-buffer representation
  of authored and simulated state shared by native, WASM, and future GPU
  adapters without per-particle JavaScript objects.
