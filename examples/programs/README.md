# Full Program Examples

These examples are larger VKF programs that show how the language feels when it
models an application rather than a single feature.

- `chess_engine_core.vkf`: native-runnable chess-engine vertical slice with
  pawn captures, major-piece movement shapes, castling/en-passant/promotion
  rule predicates, king-safety gating, algebraic move notation, captured-piece
  tray placement, and visual piece records that point at local GLB assets.
- `chess_3d_scene_contract.vkf`: native-runnable UI contract for board-centered
  orbit rotation, theta/phi arrow controls, checker/mirror material mixing, and
  click-select/click-move/click-capture outcomes.
- `chess_playable_turns.vkf`: native-runnable playable-state model with
  alternating turns, same-side move rejection, side-frame move history, and a
  `New Game` reset contract. Accepted move/capture intents also emit animation
  plans for the browser renderer.
- `vkf_chess_3d/main.vkf`: foldered VKF-only chess application with typed
  modules for notation, rules, state, UI event reduction, and generic 3D scene
  construction. It builds a pickable board, baked CC0 GLB piece meshes, side
  camera controls, a move frame, and a deterministic smoke path.

Current visual gaps for chess:

- connect the bounded VKF `ui.events` reducer to a host-owned live pump
- update side-frame labels from reducer state during live interaction
- extend path-clear and king-safety checks from current reducer inputs into a
  full board occupancy model
