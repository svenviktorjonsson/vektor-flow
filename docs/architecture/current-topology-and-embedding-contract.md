# Current Topology And Embedding Contract

This note records the current contract already present in the repo.

It exists so future system work can reuse the existing deep parts instead of
re-inventing them under new names.

See also:

- [system-view-screen-model.md](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\docs\architecture\system-view-screen-model.md)
- [planar-mirror-rendering-seam.md](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\docs\architecture\planar-mirror-rendering-seam.md)

## Topology Truth

The current topology truth for simplicial geometry is:

- `points`
- `add_simplices.edges`
- `add_simplices.faces`
- `add_simplices.volumes`

Example:

```vkf
object: (
    kind: "simplices",
    points: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
    add_simplices: (
        edges: [[0, 1], [1, 2], [2, 0]],
        faces: [[0, 1, 2]]
    )
)
```

Important properties of the contract:

- indices are plain numeric indices into `points`
- empty groups may be omitted
- points-only geometry may omit `add_simplices` entirely in the future system
- faces are simplex faces, not generic rendered patches

Today this contract is normalized in:

- [vektorflow/native_scene_topology.py](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\vektorflow\native_scene_topology.py)
- [vektorflow/native_overlay_scene_bundle.py](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\vektorflow\native_overlay_scene_bundle.py)

## Embedding Contract

The current custom graphics embedding contract is separate from topology.

An embedding callable returns local scope with keys like:

- `vertices`
- `edge_indices`
- `face_indices`
- `vertex_color`
- `edge_color`
- `face_color`
- `vertex_scale`
- `edge_scale`
- `vertex_style`
- `edge_style`
- `face_style`

Example shape:

```vkf
my_embedding(v, view):
    vertices: [...]
    edge_indices: [[0, 1]]
    face_indices: [[0, 1, 2, 3]]
    edge_color: [0.0, 0.8, 0.0, 1.0]
    face_color: [1.0, 0.0, 0.0, 0.3]
    :
```

Important:

- `face_indices` here are draw instructions, not topology truth
- one topology may have many embeddings
- an embedding may group topology differently for display

So:

- topology says what exists
- embedding says how it is drawn

Today this contract is owned by:

- [vektorflow/ui/representation_runtime.py](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\vektorflow\ui\representation_runtime.py)
- [vektorflow/stdlib/ui.py](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\vektorflow\stdlib\ui.py)

## Existing Selectors

The repo already has stable sub-entity selectors on graphics representations:

- `.vertex(i)`
- `.edge(i)`
- `.face(i)`

Example:

- [examples/ui_face_edge_vertex_drag.vkf](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\examples\ui_face_edge_vertex_drag.vkf)

Important lines there:

- `face_target: face_base_rep.face(0)`
- `edge_targets: edge_base_reps >> $.edge(0)`
- `vertex_targets: vertex_base_reps >> $.vertex(0)`

This is important because the future system model should reuse this idea.

The likely deepening is:

- today selectors live on frame/display representations
- future selectors should live on system/object handles too

That would let the same face identity be used for:

- picking
- styling
- properties
- mirror assignment
- other surface systems

## Native Scene Property Embedding

There is a second meaning of `embedding` already in native scene IR:

- canonical property name on the left
- actual property name on the right

Example shape:

```vkf
embedding: (
    points: "my_points",
    add_simplices: "my_topology",
    face_color: "my_face_color"
)
```

This is a name-mapping contract, not a graphics embedding contract.

That distinction should stay sharp:

- native scene `embedding` = property-name remapping
- graphics embedding callable = draw lowering

## Direction For System Work

The future system model should preserve the deep parts already earned here:

- keep `points + add_simplices` as topology truth
- keep graphics embedding as a separate draw contract
- move selectors onto system/object handles in addition to frame reps
- keep mirrors and screen systems attached to topology truth, not embedding draw faces

In short:

- topology truth stays
- embedding truth stays
- selectors move deeper
- system work should compose these, not replace them
