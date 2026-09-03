# ADR 0008: World, Object, View, And Layer Own Rendering Truth

Date: 2026-09-02

## Status

Accepted.

## Context

Early renderer bring-up introduced implementation-shaped source such as
`native_scene`, `add_light`, authored projected lights, and special
`motion:"orbit"` records. Those forms duplicate identities and leak render-pass
implementation into VKF programs. They are migration debt, not the Vektor Flow
model.

The public model already has the concepts needed to describe animated physical
worlds without renderer-specific objects.

## Decision

Ownership is strict:

- **World** owns physical laws and world state.
- **Object** owns one Geometry and its Properties.
- **View** owns its Embedding, separately from World and Object.
- **Layer** is the retained rendering identity produced when a View applies its
  Embedding to an Object in the current World state.

Programs compose these concepts through ordinary `add` and `push` operations.
A World receives an Object through `world.add(object)`. When the Object's
axis-bound data already uses presentation channel names, the View applies an
implicit identity Embedding. An explicit View-owned Embedding is needed only
when the author asks to remap that data, for example into momentum space.

A World is required only for objects that obey its physical laws and evolve
through dynamic real-time updates. Static or precomputed data, including a
`p_t` playback sequence, is added directly to a Frame; `add` and `push` are
sufficient.

Time-varying position is axis data. `p_t` is an array over the `t` axis, in the
same sense that `x_u` is an array over the `u` axis. It is neither a callback nor
a special motion command. The compiled runtime materializes only demanded time
slices. `t_mode` controls end-of-range playback and accepts `"repeat"`,
`"mirror"`, `"stop"`, or `"reset"`. `repeat` wraps to the first sample and
continues, `mirror` reverses direction, `stop` stays on the last sample, and
`reset` jumps to the first sample and stops. A closed `0..2*pi` orbit uses
`t_mode:"repeat"`.

The `t` domain is Layer-local. Different Layers in one View may have different
sample counts, `t_min`, `t_max`, and `t_mode` values. An explicit `t` supplies
that Layer's temporal coordinates directly; otherwise its bounds define the
interval for the Layer's `t`-indexed channels.

An ordinary compiled VKF loop may update any axis-bound data. Dependency
tracking determines the consequence: a position-only change may update only an
object transform, while changed vertex or topology data rebuilds or refits the
affected Geometry. The language does not restrict loops to transform-only
updates.

An emitting object is ordinary Geometry with emissive Properties. There is no
separate public light-source kind. Reflection, refractive index, roughness,
color, polarization, mass, and emission remain Properties of the same Object.

Ordinary optical light transport is an implicit rendering law over Layers, so
emissive Geometry can illuminate a 3D Frame without a World. A World becomes
the owner only when electromagnetic or coupled laws evolve physical state, for
example Maxwell fields, heating, forces, or a time-dependent medium. Rendering
and simulation reference the same emissive Geometry identity.

The renderer may derive private camera, light-view, aperture, shadow, and mirror
records. Those records are implementation details and must all reference the
same Layer and Object identities. They may not clone geometry or introduce
independently authored transforms.

Cameras remain special View actors because they define observation rather than
Geometry. A Screen binds a camera View onto a surface. A Mirror is Screen sugar
that automatically derives a reflected camera from the source camera and the
mirror Geometry, then locks that camera's frustum to the mirror aperture.
Convenience APIs must lower to the same `add` and `push` model rather than
creating another scene hierarchy.

## Migration Rule

`native_scene`, `add_light`, authored projected-light objects, and
`motion:"orbit"` must not appear in new public examples or define new public
interfaces. Existing occurrences are legacy migration inputs until the
World-to-View compiled renderer owns their remaining behavior.

New renderer work starts at the public seam:

`World state + Objects -> View Embedding -> Layers -> shared arenas -> GPU`

The browser or overlay host remains an Adapter. It may supply time and platform
events, but it must not evaluate physical laws, animation mathematics, or
renderer geometry in JavaScript.

## Verification

Tests at the public interface must prove that:

- one Object identity reaches main, picking, shadow, and reflection passes;
- emissive Geometry is visible and illuminates other Objects;
- mirror-derived illumination and shadows reference the original emitter;
- position-only updates upload no Geometry or material data;
- changed vertex or topology data rebuilds or refits affected Geometry;
- `p_t` behaves as axis data and large or procedural time arrays remain lazy;
- `t_mode:"repeat"` wraps one closed temporal run without a motion object;
- independently timed Layers retain distinct temporal lengths and bounds;
- precomputed `p_t` playback compiles through `Frame.add` without a World;
- law-driven real-time object evolution retains World ownership;
- new public examples contain no legacy scene, light, projected-light, or orbit
  commands.

## Consequences

The World-to-View lowering becomes a deep Module. Its small Interface gives
callers ordinary VKF composition while its implementation owns render planning,
virtual observers, dirty ranges, and GPU scheduling. This increases locality:
one ownership fix applies to every pass and every future renderer Adapter.
