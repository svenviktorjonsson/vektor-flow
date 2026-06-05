# VKF Chess 3D

`vkf_chess_3d` is a full-program VKF example. The chess rules, turn state,
event reduction, camera controls, and scene construction are authored in VKF.
The browser/WebGPU layer remains generic rendering/runtime infrastructure.

## Layout

- `main.vkf` starts the program and keeps the executable smoke path small.
- `lib/types.vkf` defines the typed records shared by the program.
- `lib/notation.vkf` owns board coordinates and algebraic notation helpers.
- `lib/rules.vkf` owns chess movement predicates.
- `lib/state.vkf` owns turn state, selection, move history, and animation plans.
- `lib/events.vkf` maps UI events/object ids into chess actions.
- `lib/scene.vkf` builds the frames, board, pieces, arrows, and move panel.
- `lib/piece_meshes.vkf` contains baked GLB chess-piece triangle meshes.

Types are intentionally explicit on stable APIs. Local temporaries still use
inference where it keeps the code readable.

## Assets

The chess-piece source meshes are from OpenGameArt `3d chess pieces` by
tunakron, licensed CC0:

https://opengameart.org/content/3d-chess-pieces

The downloaded GLB sources are kept under `assets/source/chess_pieces/gltf`.
`lib/piece_meshes.vkf` bakes those meshes into VKF literals so the runnable
program remains VKF-only at runtime.
