# Planar Mirror Rendering Seam

Planar mirror rendering is intentionally isolated behind a small Module seam in `web/vf-ui/geom/vf-geom-wgpu.js`.

## Module

`PlanarMirrorAdapter`

## Seam

`createPlanarMirrorAdapter()`

This is the only place a planar mirror algorithm should be installed. The renderer calls the adapter from `_mirrorTargetDimsForFrame()` and `_buildPlanarSurfaceRenderCamera()`; it should not contain mirror math inline in the surface render loop.

## Interface

The Adapter must provide:

- `targetDims(frameWidth, frameHeight) -> { width, height }`
- `buildRenderCamera({ part, surfaceCamera, timeMs, targetAspect, math }) -> renderCamera`
- `buildApertureCamera({ part, surfaceCamera, timeMs, targetAspect, math }) -> apertureCamera`

The returned `renderCamera` must provide the same camera shape used by `_encodeScenePartsColorPass()`:

- `pos`
- `target`
- `up`
- `view_matrix`
- `projection_matrix`
- `_mirrorViewProjection`
- `_mirrorFlipU`
- Optional `_mirrorDebug`

## Invariants

- A mirror reflects the same world. It must not synthesize duplicate reflected geometry.
- The mirror surface is a screen fed by an offscreen render pass from a reflected camera.
- Missing active camera, invalid mirror plane, invalid frustum, or invalid render target dimensions must fail fast.
- The renderer must not show an empty frame or silently fall back to a fake mirror.
- The contact line between the real floor and reflected floor must be numerically testable.
- Mirror replacement work should add tests against this Interface before changing shader or render-loop code.
- `view_matrix` and `projection_matrix` are the core truth. `pos/target/up/fov` are sugar and must not override an explicit matrix camera.

## Camera / Screen Model

The deeper model is:

- A `screen` is just a surface that displays a camera output.
- A `mirror` is not a separate rendering primitive. It is a screen whose source camera is derived from another camera by a reflection dependency.
- The source camera stays a normal camera. The mirror path must reuse the same scene/render path with a different camera and a different output target.

That means:

- Camera derivation belongs to camera state, not to geometry duplication.
- Surface binding belongs to the surface system, not to camera construction.
- The planar mirror Adapter exists because a planar screen can be rendered exactly by one derived camera plus one off-axis projection.

For the current runtime this means:

- `surface_system.kind = "mirror"` should be treated as a thin composition of:
  - a screen surface
  - a derived camera
- the renderer must not silently replace that model with a centered `fov` camera path
- any view used as a mirror reference frame should be explainable as "the same world through the same derived camera", with the only difference being output medium

## Planar Mirror Protocol

The planar mirror protocol should be:

1. Start from a real source camera `C`.
2. Reflect that camera pose across the mirror plane to produce `C'`.
3. Use the mirror rectangle corners as the aperture for `C'`.
4. Build an off-axis projection from the reflected eye to those mirror corners.
5. Use the mirror plane as the clip boundary, shifted by a tiny epsilon toward the reflected front side to avoid flicker.
6. Render the shared world to an offscreen target with that reflected camera.
7. Sample that target only on the front side of the mirror face.

This gives:

- one reflected camera
- one mirror-defined off-axis frustum
- one epsilon-shifted clip plane
- one-sided screen sampling on the mirror face

That is the correct exact model for a planar mirror.

## Mirror View Sugar

The low-level protocol should not leak to callers as a bag of unrelated camera
flags.

The deeper Module seam is a **mirror view**:

```vkf
camera: (
    fov: 34.0,
    up: [0.0, 0.0, 1.0],
    mirror_of: (
        frame_id: "front_camera_frame",
        mesh_id: "quad_0"
    )
)
```

This sugar lowers to the current runtime contract:

- `reflect_of_frame_id`
- `reflect_mirror_mesh_id`
- `aperture_mirror_mesh_id`
- `reflect_eye_only: true`
- `lock_aperture_camera: true`
- `controls_enabled: false`
- `flip_x: true`

So callers describe the concept:

- this view mirrors another view
- across this screen / mirror mesh

And the runtime owns the implementation details:

- reflected eye
- frustum lock to screen corners
- clip plane from the screen plane
- x reflection
- disabled local controls

That is a deeper Interface with better leverage and locality than requiring
callers to reassemble the protocol from six independent flags.

The matching caller-facing sugar for the non-mirror source view is:

```vkf
camera: (
    pos: [0.0, -4.2, 3.5],
    target: [0.0, 3.5, 3.5],
    fit_to_mesh_id: "quad_0",
    controls_mode: "look_only"
)
```

This lowers to:

- `aperture_mirror_mesh_id`
- `look_only_controls`

So the complete calibration example can stay concept-shaped on both sides:

- source view fits itself to a screen and rotates in place
- mirror view mirrors that source view across the same screen

## Projected Virtual Lights

Planar mirrors also need a light-side analogue of the mirror camera.

The deeper model is:

- real light stays an ordinary scene light
- virtual mirror light uses a reflected source position
- the mirror face acts as a planar aperture
- lighting begins only after the ray reaches that aperture plane
- the aperture edge uses the same soft transition idea as shadow penumbra

For the current core seam:

- `kind: "projected"` means light emission is gated by a planar aperture
- `aperture_face_id` is the caller-facing face/surface reference
- the runtime currently lowers that to its internal aperture mesh lookup
- `spread` softens only the transition to dark outside the aperture
- `spread` does not dim the interior of the lit aperture

This keeps planar mirror virtual lighting on the same deep model as the mirror
camera:

- source pose
- reflected pose
- planar aperture
- small clip epsilon
- geometry truth instead of cone-only hacks

### Important Distinction

The mirror rectangle and the clip plane come from the same geometric mirror face,
but they are not the same numerical thing in the render path:

- the mirror corners define the projection/aperture rectangle
- the mirror plane defines the clip boundary
- the clip boundary must be nudged by epsilon for stability

So:

- same mirror geometry
- different render roles

### No Self-Recursion By Default

The first correct planar mirror implementation should not recurse.

That means the reflected render should exclude or downgrade the mirror surface
itself instead of trying to reflect the mirror through itself.

So the protocol should assume:

- mirror face shown as a one-sided screen in the final view
- mirror face not sampled recursively in the reflected source pass

This keeps the first mirror path exact and stable before any later recursive
mirror work.

## Future Curved Screens

Planar mirrors are the simple case because one reflected pinhole camera is exact.

Curved reflective screens are different:

- a spherical mirror should not be forced into the planar single-camera model
- the future non-raytraced approximation should be a probe/cubemap capture plus a curved-surface reflection sampler
- in practice that means six directional renders around a capture point, then surface sampling by reflected direction

So the long-term architecture should keep these concerns separate:

- camera
- camera dependency
- screen/surface binding
- surface sampling model

Planar mirrors happen to collapse to a single derived camera. Curved mirrors generally do not.

## Current Adapter

The current Adapter is deliberately unimplemented. This removes the contaminated algorithm while preserving the seam where a correct implementation can be added.
