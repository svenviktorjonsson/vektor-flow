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

- ordered input truth for one UI/runtime pump
- built-in host input and custom/subsystem input use the same path
- no string dispatch in the hot path

The event arena is an append-only queue for the current pump slice. The host
normalizes raw platform events into typed event records, appends them, and calls
the compiled VKF update entrypoint. The compiled program consumes typed records
and writes state/effects through arenas.

Every event record starts with a small common header:

```text
struct EventHeader {
  u32 tag;
  u32 byte_len;
  u32 sequence;
  u32 frame_id;
  f64 time_ms;
}
```

Notes:

- `tag` is generated from the compiled event variant schema
- `tag` is not a user-facing string such as `"pointer.move"`
- debug labels may exist in side metadata, but behavior must not branch on them
- built-in tags occupy the low range; program/custom tags occupy compiler-owned
  ranges declared by the event program manifest
- the renderer/host validates record size and tag against the manifest before
  appending

Built-in event records are typed layouts, for example:

```text
struct PointerMoveEvent {
  EventHeader header;
  u32 pointer_id;
  u32 buttons_mask;
  u32 modifiers_mask;
  u32 target_frame_id;
  u32 target_object_id;
  f32 x_px;
  f32 y_px;
  f32 x_norm;
  f32 y_norm;
  f32 x_data;
  f32 y_data;
}

struct PointerDownEvent {
  EventHeader header;
  u32 pointer_id;
  u32 button;
  u32 buttons_mask;
  u32 modifiers_mask;
  u32 target_frame_id;
  u32 target_object_id;
  f32 x_px;
  f32 y_px;
  f32 x_norm;
  f32 y_norm;
  f32 x_data;
  f32 y_data;
}

struct KeyDownEvent {
  EventHeader header;
  u32 key_code;
  u32 scan_code;
  u32 modifiers_mask;
  u32 repeat_count;
  u32 target_frame_id;
}

struct FrameTickEvent {
  EventHeader header;
  u32 tick_index;
  f32 dt_ms;
}
```

The VKF-facing source shape should stay type-driven:

```vkf
PointerMove : (
    pointer_id:num,
    buttons_mask:num,
    modifiers_mask:num,
    target_frame_id:num,
    target_object_id:num,
    x_px:num,
    y_px:num,
    x_norm:num,
    y_norm:num,
    x_data:num,
    y_data:num,
    time_ms:num
)

PointerDown : (
    pointer_id:num,
    button:num,
    buttons_mask:num,
    modifiers_mask:num,
    target_frame_id:num,
    target_object_id:num,
    x_px:num,
    y_px:num,
    x_norm:num,
    y_norm:num,
    x_data:num,
    y_data:num,
    time_ms:num
)

FrameTick : (
    tick_index:num,
    frame_id:num,
    time_ms:num,
    dt_ms:num
)

UiEvent : PointerMove | PointerDown | FrameTick
```

Program logic must dispatch on the typed variant, not on string values:

```vkf
update(state:GameState, event:UiEvent) -> GameState:
    event??
        PointerMove => events.pointer_move(state, event)
        PointerDown => events.pointer_down(state, event)
        FrameTick => events.frame_tick(state, event)
        state
```

Custom events follow the same rule: the VKF event program declares the event
type, the compiler assigns the tag/layout, and the host appends only validated
records. No callback or stringly typed side channel is part of the ABI.

## Enum Lowering

Closed symbolic sets should use ordinary VKF record values with named numeric
values. This keeps the source language small, preserves dotted access, and
makes the runtime representation explicit.

Example:

```vkf
PieceRole: (
    none: 0,
    pawn: 1,
    knight: 2,
    bishop: 3,
    rook: 4,
    queen: 5,
    king: 6
)

Side: (
    none: 0,
    white: 1,
    black: 2
)
```

Usage remains normal dotted scope access:

```vkf
piece: (
    side: Side.white,
    role: PieceRole.knight,
    file0: 1,
    rank0: 0
)
```

Rules:

- enum-like values are numbers in arenas and manifests
- names are source/debug metadata, not hot-path dispatch strings
- fixed lookup tables should prefer vectors over discriminant arms
- `??` remains the right shape for real variant/control branching

For example, fixed chess back-rank role lookup should be a vector:

```vkf
back_rank_roles: [
    PieceRole.rook,
    PieceRole.knight,
    PieceRole.bishop,
    PieceRole.queen,
    PieceRole.king,
    PieceRole.bishop,
    PieceRole.knight,
    PieceRole.rook
]

back_rank_role(file0:num) -> num:
    @: back_rank_roles.(file0)
```

This avoids both string roles and switch-shaped logic for static tables.

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
