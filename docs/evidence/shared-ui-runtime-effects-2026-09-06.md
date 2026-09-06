# Shared UI runtime effects: first WASM slice

Date: 2026-09-06

Base: `92155d9a feat(wasm): retain private UI compilation form`

## Scope

This packet lowers compiler-private `retained_ui_effect` nodes into the emitted
WASM program and captures executed operands in source order. A private compiler
probe reads only the program's WASM memory and passes evaluated numeric vectors
to the existing compiler-owned retained-scene geometry packer. UI-effect values
are excluded from console formatting. No host import, JavaScript evaluation,
metadata replay, source rewrite, fallback, public export, or canonical response
field is introduced.

The focused fixture executes a Display/Frame program containing two `add`
calls separated by `.y:y+1`. It verifies two packets in source order, unchanged
x bounds, y bounds shifted by exactly one, distinct authored IDs, empty console
output, and byte-for-byte-equivalent JSON from a fresh execution.

The follow-up checkpoint executes ordered side-effecting operands, an untaken
conditional effect, a retained-handle alias, and two adds separated by an
in-place vector mutation. `CaptureUiEffect` recursively clones the compiler's
private effect array inside emitted WASM; immutable scalar/string leaves may be
shared, while nested arrays are owned by the captured effect.

## RED to GREEN

- RED: `tests/bootstrap/shared-ui-runtime-effects.test.mjs` failed 0/1 because
  `vkf_format_ui_packets` did not exist in the isolated private probe.
- GREEN: the same focused test passes 1/1 after emitted-program execution and
  compiler-owned packet extraction were implemented.

## Regression gates

Pinned toolchain: `emscripten/emsdk:4.0.14` via the repository's
`vkf-trig-toolchain:14` image.

- focused runtime UI fixtures: 5/5
- UI/frontend bootstrap group: 42/42
- execution/public-boundary group: 91/91
- fresh strict native suite: 451/451
- full native/WASM comparison: 133/451 pass, 318 known failures
- exact comparison with the compilation-form baseline: 451 entries,
  0 differences

The public shared compiler export boundary and canonical compile response remain
unchanged; the packet formatter is exported only by `scripts/shared-ui-probe.mk`.

## Remaining RED gates

- connect compiler-owned versioned packets to the production browser runner;
- execute the failure-short-circuit fixture with the exact native diagnostic;
- implement and verify the corresponding native effect execution path;
- complete every README and linked-guide example through the same client-side
  compiler/WASM pipeline.
