# Vektor Flow Context

## Domain Language

- **Browser host output boundary**: Viktor's accepted 2026-09-05 decision A
  keeps every VKF value inside WASM. JavaScript consumes compiler-formatted
  UTF-8 console output and versioned graphics/UI packets, never arbitrary
  scalars, vectors, tuples, records or value handles. VKF owns value semantics
  and formatting; byte transport is not language interpretation. See
  `docs/plans/browser-tuple-transport-decision.md`.

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
- **Geometry**: An object's canonical shape and topology, independent of its
  physical properties and placement. Geometry is authored once and retained by
  identity.
- **Properties**: The strict record of material and physical quantities attached
  to Geometry, including emission, mass, roughness, reflectivity, and refractive
  index. A property does not introduce a second geometry identity.
- **Physical laws**: The VKF relations owned by a World that determine how its
  objects and Properties interact and how world state evolves over time. Laws
  do not belong to individual objects.
- **World boundary**: A World contains objects that obey that World's physical
  laws and evolve through dynamic real-time updates. Static or precomputed data,
  including a `p_t` playback sequence, needs no World and is added directly to a
  Frame with ordinary `add` and `push`.
- **Rendering light transport**: The renderer's implicit optical presentation
  law that turns emissive Geometry and surface Properties into visible direct
  light, shadows, reflections, and caustics. It operates on ordinary Layers and
  therefore requires no World. A World owns light only when electromagnetic or
  coupled physical laws evolve simulation state, such as Maxwell fields,
  heating, forces, or a time-dependent medium. Both paths reference the same
  emissive Geometry identity; neither creates a separate light object.
- **Embedding**: A View-owned mapping from World objects and current state into
  visual channels. Data whose semantic channel names already describe its
  presentation uses the identity Embedding implicitly through ordinary `add`
  and `push`; an explicit Embedding is needed only to remap the data, such as
  presenting a World in momentum space. Embedding is separate from both World
  and its objects.
- **Time position**: A 2D position varying over time is the complex scalar array
  `p_t`; its real and imaginary parts are `x` and `y`. Position-component
  vectors use an explicit final `c` axis, as in `p_tc`. Either may be supplied as
  precomputed Layer data or produced and evolved by World laws; the compiled
  runtime materializes only the currently demanded `t` slice. It is not a
  function or callable.
- **Semantic index suffix**: The ordered axes after `_` state how a value varies.
  Suffix order is storage order from left/outermost to right/innermost, with the
  final axis varying fastest. `u/v/w` are topology axes and alone create
  implicit adjacency; their order is significant. `i/j/k` group independent
  items and never create adjacency between groups. `t` orders temporal samples
  or states and never creates spatial adjacency. Thus `x_u` is an x-coordinate
  array over topology axis `u`, complex `p_t` is a 2D position array over time,
  and complex `p_iu` is a group of independent `u`-topologies. For complex
  `p_<axes>`, real maps to `x` and imaginary maps to `y`; it infers 2D and does
  not introduce `z`. A final `c` denotes explicit position components. An
  unindexed channel is constant
  across every indexed axis. Coordinate presence determines inferred display
  dimensionality: `x_u` and `y_u` with `z` omitted are 2D, while an explicit
  scalar `z:0` is a constant third coordinate and therefore 3D. A constant
  coordinate is written once, never expanded into a repeated vector.
- **Layer time domain**: Every Layer owns its own `t` axis. Layers in one View
  may have different temporal lengths and different `t_min` and `t_max` bounds.
  Supplying `t` gives the Layer's temporal coordinates directly; otherwise its
  bounds define the temporal interval for its `t`-indexed data.
- **Time mode**: The Layer property `t_mode` controls what happens when that
  Layer's ordered `t` range ends. Its public values are `"repeat"`, `"mirror"`,
  `"stop"`, and `"reset"`. It acts on ordinary `t`-indexed data and does not
  introduce an animation object, callback, or special motion command. `repeat`
  wraps to the first sample and continues, `mirror` reverses direction, `stop`
  stays on the last sample, and `reset` jumps to the first sample and stops. A
  closed `0..2*pi` orbit uses `t_mode:"repeat"`.
- **Layer**: One retained rendering identity produced when a View applies its
  Embedding to a World object and current state. Main, picking, shadow, and
  reflection passes consume the same Layer identity; physical-law ownership
  remains in World.
- **Layered Screen Scene**: the retained VKF scene compositor that guarantees
  Face, Edge, Vertex, overlay, and selection ordering before GPU-buffer commit.
- **Scene Instance**: one retained geometry identity with one canonical GPU
  buffer set and one cached world transform per rendered frame. Main, picking,
  shadow, screen, and reflection passes consume the same Scene Instance; a pass
  may not clone, replace, or independently transform its geometry.
- **Mirror Projection**: the planar-mirror operation that reflects an observer
  (camera or light) across one Scene Instance's plane and locks its off-axis
  frustum to that mirror's four world-space corners. Camera observers produce
  mirror textures; light observers produce solkatt illumination and its shadow
  frustum over the same Scene Instances.
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
