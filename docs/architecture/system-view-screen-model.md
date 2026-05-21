# System / View / Screen Model

This note captures the direction for the UI engine and VKF plugin around shared
worlds, multiple views, and reflective surfaces.

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

- A **system** owns shared world truth.
- A **view** is a camera over that system.
- A **frame** is UI chrome over a viewport that shows one view.
- A **screen** is a surface that shows a view output.
- A **mirror** is not a primitive. It is a screen whose source view comes from a
  camera dependency.

This gives one family of concepts instead of separate special cases.

## World Truth

The world should separate:

- **properties**: axis-bound data
- **connections**: topology
- **embeddings**: geometric or visual lowering

The canonical topology contract already exists:

- `points`
- `add_simplices.edges`
- `add_simplices.faces`
- `add_simplices.volumes`

That is the topology truth. It should stay the thing the renderer trusts and
lowers into GPU buffers.

The existing graphics embedding contract is separate and should stay separate:

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
- `mirror_F.(F)` means lookup on face index `F`
- `mirror(F)` means derived per-face property

## Views And Frames

A view should be independent from frame chrome.

The frame or panel decides the viewport.
The view renders into that viewport.

`aspect: "equal"` should mean equal x/y scale mapping inside the viewport. It
must not mean "make the outer window square".

Long-term this suggests:

- `frame` is the real primitive
- `panel` is sugar for a constrained frame
- a frame shows a view
- a view belongs to a system

So the conceptual shape is:

- create or obtain frames from the UI layer
- create a system
- add cameras/views to that system
- show those views in frames

## Cameras

Cameras should be first-class system members, not ordinary properties.

The same is true for lights.

That means:

- properties live on entity axes such as `F` and `E`
- cameras and lights live beside topology, embeddings, and properties as scene
  actors

Cameras should support:

- ordinary pose and lens state
- dependency on another camera
- optional explicit matrices when needed by the renderer

The important rule is:

- explicit matrix camera and centered `pos/target/up/fov` camera must not be
  blended serially
- if explicit matrices exist, they are authoritative

## Lights

Lights should deepen the same way cameras do.

Current point and spot lights are useful sugar, but the deeper model for mirror
lighting is a **projected light**:

- source pose
- power / intensity
- planar aperture
- edge spread

That means:

- `kind: "point"` stays omnidirectional sugar
- `kind: "spot"` stays cone sugar
- `kind: "projected"` is the core seam for aperture-shaped emission

The important rule for `spread` is:

- it should not damp the light inside the aperture
- it should soften only the transition to dark outside the aperture
- that softness should reuse the same penumbra idea already used by shadows

For planar mirror virtual lights:

- the real light stays ordinary
- the virtual light uses a reflected source pose
- the mirror face becomes the aperture
- the projected light is clipped by that face before it reaches the world

## Screens And Mirrors

Screens belong on surfaces.

A screen should simply bind a view output onto a surface.

A mirror should not be a separate primitive.
It should be composition:

- a camera dependency creates a derived camera
- a screen surface displays that derived camera

So the direction is:

- camera dependency belongs to camera state
- surface binding belongs to the screen / surface system
- the mirror renderer is just one Adapter of that more general model

Planar mirrors are the simple case:

- one derived camera
- one off-axis projection
- one planar screen sampling rule

The caller-facing form should be mirror-view sugar, not a shallow list of
runtime toggles. A view should be able to say:

```vkf
camera: (
    mirror_of: (
        frame_id: "main_frame",
        mesh_id: "mirror_quad"
    )
)
```

That should lower to the current reflected-eye plus locked-frustum protocol,
instead of forcing callers to know fields like:

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

1. `SystemTopology`
   - world truth
   - stable entity selectors
   - properties / connections / embeddings

2. `SceneView`
   - camera state
   - camera dependency
   - explicit matrix camera contract

3. `SurfaceScreen`
   - view-to-surface binding
   - output target contract
   - sampling model

4. `FrameViewport`
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
