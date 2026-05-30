# UI Runtime Arena ABI

This note defines the first shared-memory contract for the Python-free UI
runtime.

The purpose of the ABI is simple:

- compiled VKF cores write state here
- renderer adapters read state here
- inspection adapters may snapshot it
- Python and JSON are not required in the hot path

This is the first seam that all three workstreams must share.

See also:

- [python-free-ui-runtime-roadmap.md](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\docs\architecture\python-free-ui-runtime-roadmap.md)
- [../adr/0001-ui-runtime-shared-memory-gpu.md](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\docs\adr\0001-ui-runtime-shared-memory-gpu.md)

## Goals

The ABI must support:

- pointer and keyboard input
- retained widget state
- transform authoring state
- cached world transforms
- geometry and index buffers
- append-only UI commands for setup
- cheap dirty-range detection

The ABI does not need to encode:

- full parser AST
- full typed IR
- every high-level VKF value shape
- doc/debug metadata on the hot path

## Core Rule

The arena ABI is a runtime contract, not a language contract.

That means:

- the language may stay functional
- runtime resources may be mutable
- arenas are explicit mutable resources
- callers should never confuse arena mutation with ordinary struct/vector rebinding

## Arena Set

The first arena set is:

1. `EventArena`
2. `TransformArena`
3. `GeometryArena`
4. `WidgetArena`
5. `CommandArena`

Each arena has:

- a header
- one or more typed record regions
- generation counters
- dirty min/max range

## Shared Header Shape

Every arena begins with:

```text
struct ArenaHeader {
  u32 version;
  u32 record_stride;
  u32 capacity;
  u32 count;
  u32 generation;
  u32 dirty_generation;
  u32 dirty_min;
  u32 dirty_max;
}
```

Rules:

- `generation` increments whenever arena-visible content changes
- `dirty_generation` increments whenever dirty range changes
- `dirty_min` and `dirty_max` describe the inclusive modified record range
- `dirty_min > dirty_max` means "no dirty records"

## EventArena

Purpose:

- current input truth
- no history-heavy semantics in the first slice

First record shape:

```text
struct EventSnapshot {
  u32 frame_id;
  u32 object_id;
  u32 hover_kind;
  u32 buttons_mask;
  u32 modifiers_mask;
  f32 cursor_px_x;
  f32 cursor_px_y;
  f32 cursor_norm_x;
  f32 cursor_norm_y;
  f32 cursor_data_x;
  f32 cursor_data_y;
  f32 wheel_step;
  f32 drag_dx_px;
  f32 drag_dy_px;
}
```

Notes:

- `cursor_px_*` is absolute screen or frame-local pixel position
- `cursor_norm_*` is normalized frame-local position
- `cursor_data_*` is data-space position when known
- `hover_kind` is one of none/frame/object/face/edge/vertex

## TransformArena

Purpose:

- authoring transforms
- cached local matrices
- cached world matrices

First record shape:

```text
struct TransformRecord {
  u32 id;
  u32 parent_id;
  u32 flags;
  u32 reserved;
  f32 tx, ty, tz, tw;
  f32 qx, qy, qz, qw;
  f32 sx, sy, sz, sw;
  f32 local_mat4[16];
  f32 world_mat4[16];
}
```

Rules:

- TRS is the semantic authoring state
- quaternion is authoritative for 3D rotation
- cached matrices are renderer-facing truth
- parent/child propagation writes `world_mat4`

## GeometryArena

Purpose:

- dynamic geometry buffers
- index ranges
- draw metadata

First record shape:

```text
struct GeometryRecord {
  u32 id;
  u32 topology;
  u32 vertex_offset;
  u32 vertex_count;
  u32 index_offset;
  u32 index_count;
  u32 transform_id;
  u32 material_id;
  u32 flags;
  u32 reserved[3];
  f32 bounds_min[4];
  f32 bounds_max[4];
}
```

Backed by:

- one vertex arena/buffer region
- one index arena/buffer region

Rules:

- record points to vertex/index slices
- renderer updates only dirty slices
- geometry records do not own widget semantics

## WidgetArena

Purpose:

- retained widget state
- dispatch routing
- visual control state

First record shape:

```text
struct WidgetRecord {
  u32 id;
  u32 frame_id;
  u32 kind;
  u32 route_kind;
  u32 transform_id;
  u32 state_flags;
  f32 rect_px[4];
  f32 value0;
  f32 value1;
  f32 value2;
  f32 value3;
}
```

Examples:

- slider values
- button pressed/hovered state
- axis runtime state handles

## CommandArena

Purpose:

- append-only setup or structural commands
- not per-frame pointer movement

First command family:

- create frame
- attach widget
- attach geometry handle
- declare material/style handle

Rules:

- command arena changes rarely compared to transforms/events
- interaction should mostly mutate transform/widget/geometry state, not append commands

## Dirty-Range Protocol

Each arena must support:

- `mark_dirty(index)`
- `mark_dirty_span(min, max)`
- `clear_dirty()`

Writer rules:

- after mutating a record, widen dirty range
- after finishing a frame/update, increment `generation`

Renderer rules:

- if `generation` unchanged, skip
- if changed, upload only dirty span
- after successful consume, renderer may track last seen generation locally

## Initial ABI Constraints

For the first executable slice:

- fixed-width little-endian layout
- 32-bit ids
- 32-bit counters
- `f32` numeric state
- no pointer fields inside records
- no variable-length strings on hot path

Strings, labels, and doc/debug metadata should remain outside this hot seam in
the first phase.

## Relationship To JS And Python

JavaScript:

- may allocate or map the shared memory
- may expose typed views over these arenas
- should not become the long-term home of the heavy state mutations

Python:

- may create snapshots of these arenas
- may generate fixtures or docs from these arenas
- should not own live mutation of these arenas during interaction

## Acceptance For Phase 1

This ABI is good enough for the first truthful runtime slice when:

- one draggable demo can update `EventArena`
- compiled runtime mutates `TransformArena`
- renderer consumes `TransformArena` dirty ranges
- no per-frame `vf-display.json` write/read is needed

## Open Questions

- whether `WidgetArena` should directly store axis runtime state or only references
- whether `GeometryArena` should split static and dynamic draw records
- whether `CommandArena` should stay general or become several specific setup arenas
- how soon material/light state needs its own arena
