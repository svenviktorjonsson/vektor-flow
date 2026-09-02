# System / View / Screen Model

This note captures the direction for the UI engine around Layer data, optional
World physics, multiple views, and reflective surfaces. ADR 0008 is
authoritative where older wording in this note conflicts with it.

It is intentionally more general than the current planar mirror seam. The goal
is to stop re-deriving the same design in wrapper code and ad hoc camera logic.

## Current Friction

Today the codebase mixes several concerns:

- world geometry and topology
- camera definition
- frame placement
- mirror and screen behavior
- reflected and aperture camera setup

That lowers locality. A caller must know too much about:

- `native_scene`
- `surface_system`
- frame `rect` and aspect behavior
- camera `pos/target/up/fov`
- optional `view_matrix/projection_matrix`
- special mirror properties such as `reflect_of_frame_id`

The result is a shallow Module: complexity leaks across the seam instead of
being concentrated behind one Interface.

## Deep Model

The deeper model is:

- A **Layer** retains data added to a frame.
- A **World** is present only when objects obey its laws under dynamic updates.
- A **view** observes Layers through a camera.
- A **frame** is UI chrome over a viewport that shows one view.
- A **screen** is a surface that shows a view output.
- A **mirror** is a screen that automatically derives a reflected camera from
  its source camera and mirror Geometry.

This gives one family of concepts instead of separate special cases.

## World Truth

Dynamic World truth separates:

- **properties**: axis-bound data
- **connections**: topology
- **physical laws and evolving state**

The canonical topology contract already exists:

- `points`
- `add_simplices.edges`
- `add_simplices.faces`
- `add_simplices.volumes`

That is the topology truth. It should stay the thing the renderer trusts and
lowers into GPU buffers.

Ordinary Layer channel names provide the identity embedding. An explicit
View-owned embedding is only needed to remap data, for example into momentum
space. Its output contract remains separate from topology:

- `vertices`
- `edge_indices`
- `face_indices`
- optional color / scale / style fields

So:

- topology says what exists
- embedding says how to draw it

See the current concrete contracts in:

- [current-topology-and-embedding-contract.md](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\docs\architecture\current-topology-and-embedding-contract.md)

## Axis Model

Properties should remain axis-bound.

The current direction is:

- lowercase axes such as `u v w i j k t h d` remain for data, ordering,
  grouping, relation, or time
- uppercase axes are entity axes:
  - `N` object / system member
  - `P` point
  - `E` edge
  - `F` face
  - `V` volume

Two property forms should be allowed:

- stored ledgers, for example `mirror_F`
- computed ledgers, for example `mirror(F): ...`

That gives:

- `mirror_F` means a per-face stored property
- `mirror_F.F` means lookup on face index `F`
- `mirror(F)` means derived per-face property

## Views And Frames

A view should be independent from frame chrome.

The frame or panel decides the viewport.
The view renders into that viewport.

`aspect: "equal"` should mean equal x/y scale mapping inside the viewport. It
must not mean "make the outer window square".

This gives:

- `frame` is the real primitive
- `panel` is sugar for a constrained frame
- a frame shows a view
- a view observes ordinary Layers or a law-driven World

So the conceptual shape is:

- create or obtain frames from the UI layer
- add data and `push` a View
- optionally attach law-driven World state
- select the View's camera
- show those views in frames

## Cameras

Cameras are special View actors rather than ordinary Geometry Properties. They
define observation and may be shared or derived without duplicating scene data.

That means:

- Geometry and Properties remain Layer data
- camera state belongs to a View

Cameras should support:

- ordinary pose and lens state
- dependency on another camera
- optional explicit matrices when needed by the renderer

The important rule is:

- explicit matrix camera and centered `pos/target/up/fov` camera must not be
  blended serially
- if explicit matrices exist, they are authoritative

## Emissive Geometry

Lights do not deepen like cameras. Ordinary Geometry becomes a source through
its emissive Properties. The same identity is visible, illuminates Layers,
casts shadows, and is reflected by screens. Private virtual-source and aperture
records may be derived by the renderer, but they are not authored objects or a
second public light hierarchy.

## Screens And Mirrors

Screens belong on surfaces.

A screen binds a camera's View output onto a surface.

A mirror should not be a separate primitive.
It should be composition:

- a mirror automatically creates a reflected camera dependency
- a screen surface displays that derived camera

So the direction is:

- camera dependency belongs to camera state
- surface binding belongs to the screen / surface system
- the mirror renderer is just one Adapter of that more general model

Planar mirrors are the simple case:

- one derived camera
- one off-axis projection
- one planar screen sampling rule

The caller-facing form is mirror-screen sugar over ordinary `add` and `push`,
not a shallow list of runtime toggles. It lowers to the reflected-eye plus
locked-frustum protocol without forcing callers to know fields like:

- `reflect_of_frame_id`
- `reflect_mirror_mesh_id`
- `aperture_mirror_mesh_id`
- `reflect_eye_only`
- `lock_aperture_camera`
- `controls_enabled`
- `flip_x`

This is a good deepening opportunity because the Interface becomes
concept-shaped:

- "mirror this view across this screen"

instead of implementation-shaped.

More concretely, a planar mirror should use this protocol:

- reflect a source camera pose across the mirror plane
- use the mirror rectangle corners as the aperture
- build the reflected off-axis projection from those corners
- clip against the mirror plane with a tiny epsilon shift for stability
- render to an offscreen target
- show that target only on the mirror front side

So for planar mirrors:

- the dependent camera is exact
- the screen mapping is exact
- no special geometry duplication is needed

Curved reflective surfaces should not be forced into that planar model.

## Future Curved Mirrors

For non-planar reflective screens, the next practical approximation should be:

- capture the world into a cubemap or probe set
- sample the probe from the surface using the reflected direction

That keeps the architecture clean:

- camera
- camera dependency
- screen binding
- surface sampling model

Planar mirrors collapse to one derived camera.
Curved mirrors usually do not.

## Refactoring Direction

The refactoring target is to deepen four Modules:

1. `LayerTopology`
   - static and precomputed data truth
   - stable entity selectors
   - properties and connections

2. `WorldPhysics`
   - physical laws
   - evolving object state
   - real-time updates

3. `SceneView`
   - camera state
   - camera dependency
   - explicit matrix camera contract

4. `SurfaceScreen`
   - view-to-surface binding
   - output target contract
   - sampling model

5. `FrameViewport`
   - outer frame rect
   - inner viewport rect
   - aspect mapping rule

The leverage is:

- shared worlds with multiple views
- one consistent camera model for normal frames and mirror renders
- less wrapper code
- clearer test surfaces

The locality is:

- fewer bugs caused by camera logic leaking across runtime, renderer, and frame
  chrome code
