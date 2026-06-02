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

Next visual slice for chess:

- add `chess_3d_visual.vkf` once the native UI scene subset can consume the
  `chess_3d_scene_contract.vkf` payload directly
- render a controllable 3D checkerboard from any side
- use side lighting, shadows, and a reflective checker material
- add mesh-backed pieces from a licensed `assets/chess/` manifest
- wire the move-history frame and `New Game` button to the browser/runtime UI
