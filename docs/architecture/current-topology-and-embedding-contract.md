# Current Topology And Embedding Contract

This note records topology and explicit-remapping contracts already present in
the repo. ADR 0008 is authoritative where older callable or `native_scene`
wording below conflicts with the current model.

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

The legacy normalization implementation has been removed. Replacement ownership
must live in the native compiler and overlay contracts before `ui` ships.

## Explicit Embedding Contract

Data whose semantic channel names already describe its presentation uses an
implicit identity embedding through `add` and `push`. A custom View-owned
embedding is needed only for explicit remapping, such as momentum space, and is
separate from topology.

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

This follows the broader VKF model:

- a "constructor" is just a function
- the function builds or spills local scope
- overrides happen by rebinding names in that scope
- returning `:` means "return the current struct/scope"

So inheritance-style behavior is not a separate system here. It is ordinary
function composition plus struct spill/override.

Important:

- `face_indices` here are draw instructions, not topology truth
- one topology may have many embeddings
- an embedding may group topology differently for display

So:

- topology says what exists
- embedding says how it is drawn

The legacy owner has been removed. The contract remains design input for the
future native `ui` module and is not part of the 0.1.x release surface.

## Existing Selectors

The repo already has stable sub-entity selectors on graphics representations:

- `.vertex(i)`
- `.edge(i)`
- `.face(i)`

Example selectors in practice:

- `face_rep.face(0)`
- `edge_reps >> $.edge(0)`
- `vertex_reps >> $.vertex(0)`

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

## Legacy Native Scene Property Embedding

There is a second legacy meaning of `embedding` in native scene IR:

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

This is migration input only:

- native scene `embedding` = legacy property-name remapping
- View embedding = optional explicit remapping of ordinary Layer data

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
