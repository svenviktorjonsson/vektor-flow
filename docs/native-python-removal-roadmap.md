# Native Python Removal Roadmap

## Objective

Delete Python from the repository by replacing it with an authoritative native toolchain and then self-hosted `.vkf` modules where appropriate.

Near-term architecture target:
- `parser-only Python, native runtime exe`

Interpretation:
- Python may remain temporarily at the build-time parser seam for bootstrap parsing, fixture generation, or migration checks.
- The shipped runtime path should converge on a native runtime executable with no Python fallback in evaluation, stdlib behavior, or UI runtime execution.
- The UI side of that shipped path should converge on a **runtime bundle seam**: one deep seam that packages packet-first display, representation, and runtime execution behavior for the native executable.

Packaging claim:
- We can honestly say **whole app packages without Python** only when the target machine needs the native runtime executable and packaged assets, but no Python installation, no Python-side UI ingress, and no Python-side compatibility mirroring.

## Modules

1. **Native frontend**
Files:
- `native/VfCore`
- current Python frontend in `vektorflow/cli.py`, `vektorflow/lexer.py`, `vektorflow/parser.py`, `vektorflow/tokens.py`, `vektorflow/token_stream.py`

Problem:
- the frontend seam is shallow because source loading, tokenization, parsing, and diagnostics still live mainly in Python

Solution:
- move the authoritative frontend interface to C++
- reduce Python to the build-time parser seam only, with no runtime authority
- keep the first native interface small: source input, token output, parse output, diagnostics

Benefits:
- better locality because frontend behavior lives in one module
- better leverage because later runtime and self-hosted parser work can target one seam
- tests improve because frontend fixtures can validate one authoritative contract

2. **Native runtime**
Files:
- `vektorflow/interpreter.py`
- `vektorflow/runtime/*`
- future `native/VfCore/src/runtime/*`

Problem:
- evaluation and value semantics still depend on Python host behavior

Solution:
- move vectors, tuples, multisets, dispatch, and evaluation into a native runtime

Benefits:
- better locality for performance and semantics
- better leverage because host-language behavior stops leaking into language behavior
- tests improve because runtime semantics can be exercised without Python fallback assumptions

3. **System stdlib**
Files:
- future native stdlib module

Problem:
- self-hosting will need process execution, filesystem access, and host integration

Solution:
- add a native `system` stdlib with explicit operations

Benefits:
- better locality because host integration is behind one seam
- better leverage because self-hosted tooling can build on a stable stdlib instead of ad hoc bootstrap glue
- tests improve because host interactions can be covered through one interface

## Order

1. Stand up `native/VfCore` as the native frontend module.
2. Name and shrink the build-time parser seam so Python is bootstrap-only.
3. Define the native CLI contract and diagnostics contract.
4. Port lexer behavior.
5. Port parser behavior.
6. Port runtime behavior into the native runtime executable.
7. Add `system` stdlib.
8. Begin self-hosting selected modules in `.vkf`.
9. Delete Python.

## Current Step

Current step:
- establish `native/VfCore` as the native frontend seam
- keep its interface small and explicit
- stop adding new authoritative language behavior to Python
- grow the **token stream contract** surface: each new syntax slice should add or extend a paired `examples/native_core/*.vkf` + `tests/fixtures/token_stream/*_versioned.json` row (see `vektorflow/native_lexer_fixtures.py` and `CONTEXT.md` **Token stream contract**)

## Packet-First UI Guardrails

For the native UI runtime direction, treat the packet contract as the only interface new runtime work should depend on.

- Prefer `vektorflow.ui.payloads` packet snapshots and packet history over direct assumptions about mirrored JSON files.
- Treat `vektorflow.ui.session` file writes as compatibility adapters; tests should still pass when mirroring fails or no repo root is available.
- Keep no-live-host coverage for `test` and `headless` modes so packet production and packet ingress can be exercised without browser or overlay startup.
- When adding UI runtime behavior, extend regression coverage around packet ordering, packet kinds, and fallback behavior before adding transport-specific tests.

## Deep Modules Already Earning Leverage

These modules are getting deeper because callers can rely on a smaller interface while more implementation detail moves behind the seam.

1. `vektorflow.ui.display_runtime`
- owns display payload assembly and visibility checks
- gives leverage by shrinking what callers need to know about `Display._sync_all()`

2. `vektorflow.ui.representation_runtime`
- owns representation refresh and field-mesh lowering helpers
- gives leverage by shrinking what callers need to know about redraw and mesh lowering

Together these modules are forming the **runtime bundle seam** for the UI runtime path:
- callers should eventually depend on one small runtime-bundle interface, not separate Python redraw, mirroring, and polling details
- this is the deep seam that makes `exe no Python on target machine` realistic for shipped UI execution

## Remaining Shallow Modules After The Runtime Bundle Seam Cut

These modules are still shallow in the shipped runtime path. Their interface is still close to their implementation, so they continue to leak Python runtime details that block the target machine goal.

1. `vektorflow/stdlib/ui.py`
- `Display._sync_all`
- display payload assembly
- representation refresh and redraw fan-in
- shallow because callers still feel orchestration and redraw details that should collapse behind the runtime bundle seam

2. `vektorflow/ui/payloads.py`
- packet sequencing
- packet history snapshots
- JSON serialization before transport adapters
- shallow because packet contract authority still shares a module with adapter-facing serialization work

3. `vektorflow/ui/session.py`
- per-session file mirroring
- compatibility copies into repo and built-web trees
- shallow because the adapter interface is almost the whole implementation

4. `vektorflow/stdlib/events.py`
- overlay/browser polling transport
- event normalization and dispatch fan-out
- shallow because ingress success still depends on polling adapters and callback timing outside the runtime bundle seam

5. `vektorflow/stdlib/screen.py`
- frame command emission
- widget state mutation and append patch production
- shallow because scene authoring and packet-shape details are still coupled at the same seam

## Next UI Runtime Milestone Guardrails

The next milestone should make packet transport an implementation detail rather than an architectural dependency.

- Native consumers should prefer packet history and packet kinds over direct reads of `vf-display.json`, `vkf-scene.json`, or `vf-ui-state.json`.
- Browser and overlay launch tests should continue proving transport precedence: reuse a healthy existing transport, fall back when stale, and keep packet semantics unchanged.
- Input tests should continue proving that `publish_ui_event_payload(...)` works without live overlay startup, so ingress stays contract-first.
- New docs and tests should avoid describing mirrored files as authoritative; they are fallback adapters until deletion.

## Next Slices For The Top Blockers

1. `vektorflow/stdlib/ui.py`
- Slice A: split pure scene/display payload building away from host launch and file-transport side effects.
- Slice B: isolate representation refresh (`_refresh_representation`, `_refresh_all_representations`) behind a native-consumable scene graph builder seam.
- Slice C: replace Python mesh/style lowering (`_embedding_scope_to_draw_ops`, `_build_field_mesh_geometry`) with a native runtime builder while keeping packet-shape tests stable.

Current leverage:
- `vektorflow.ui.display_runtime` now owns display payload assembly and visibility checks, so `Display._sync_all()` can keep shrinking toward orchestration only.
- `vektorflow.ui.representation_runtime` now owns representation refresh and field-mesh lowering helpers, so `Display` is closer to orchestration-only and the next cut can target native replacement of that seam directly.

2. `vektorflow/stdlib/events.py`
- Slice A: keep `OverlayPoller._drain_runtime_packets_once` as the authoritative ingress path and keep `/api/pop` out of the Python success path entirely.
- Slice B: move typed event normalization (`ui_event_from_payload`) behind a narrower seam so native ingress can own event object creation or a native event-code contract.
- Slice C: shrink Python callback queue ownership to tests and legacy adapters only.

3. Packet transport precedence and fallback
- Slice A: direct runtime packet publish remains preferred whenever the runtime packet API is healthy.
- Slice B: packet-history mirroring stays available as a compatibility path until native consumers no longer need filesystem fallbacks.
- Slice C: transport tests should pin precedence, stale-endpoint fallback, and packet-history compatibility before any adapter deletion.

## Fallback Removal Gates

- Keep `/api/pop` out of Python ingress entirely now that runtime-packet ingress tests prove a healthy `/api/runtime-packets/input` snapshot remains authoritative even when it contains zero `input.event` packets.
- Remove packet-file fallback reliance only after native-shell transport tests prove `keep_packet_mirror=False` works for both healthy direct publish and transport-down cases without changing packet history semantics in memory.
- Shrink `vektorflow/stdlib/ui.py` ownership only while keeping `_sync_all()` guardrails stable: scene writes remain tied to command-topology changes, and pure representation/view refreshes remain display-only updates.

### Suggested Deletion Order

- Step 1: keep `/api/runtime-packets/input` as the only authoritative input-ingress contract in tests, with `/api/runtime-packets` treated as compatibility ingress and `/api/pop` treated as host-side legacy only.
- Step 2: default native-shell and packet transport tests to `keep_packet_mirror=False`, and keep mirror-enabled coverage only as a temporary legacy adapter suite.
- Step 3: keep reducing `vektorflow/stdlib/ui.py` to scene-topology decisions only, with draw-op refresh and display payload rebuilding pinned as replaceable implementation details.

### Packaging Gate To Claim `whole app packages without Python`

1. Frontend gate
- Python is limited to the build-time parser seam only.
- The target machine does not need Python for CLI startup, parsing, diagnostics, or runtime launch.

2. Runtime bundle gate
- The native runtime executable consumes the runtime bundle seam directly for shipped UI execution.
- `vektorflow/stdlib/ui.py` no longer owns shipped-runtime redraw or display assembly behavior.

3. Input ingress gate
- `vektorflow/stdlib/events.py` is out of the shipped-runtime success path.
- `/api/runtime-packets/input` is authoritative, `/api/runtime-packets` is compatibility-only, and `/api/pop` is host-side legacy only or deleted.

4. Compatibility adapter gate
- `vektorflow/ui/session.py` is deleted from the shipped-runtime path.
- Packet-file mirroring is either removed or provably irrelevant to successful direct runtime publishing.

Current residue after the latest session cut:
- built overlay trees may still receive `sessions/<id>/vkf-scene.html` so the native host can open a staged page path
- payload, state, and packet-history files should stay repo-session compatibility adapters instead of being copied into built overlay trees

### Exact Target-Machine Blockers

These are the shallow modules that must move behind the runtime bundle seam or die outright before we can honestly say `whole app packages without Python` on the target machine:

1. `vektorflow/stdlib/ui.py`
- must move: shipped-runtime redraw orchestration and any remaining display assembly cannot stay Python-owned

2. `vektorflow/stdlib/events.py`
- must move or die: shipped-runtime input ingress, polling, and callback fan-out cannot stay Python-owned

3. `vektorflow/ui/payloads.py`
- must move: packet sequencing, packet history ownership, and adapter-facing serialization cannot stay on the shipped runtime path

4. `vektorflow/ui/session.py`
- must die from the shipped path: file mirroring and compatibility copies cannot be required for successful packaged execution

### Ownership Exit Steps

- `vektorflow/stdlib/events.py`: keep `/api/runtime-packets` as compatibility-only ingress and keep `/api/pop` out of Python ingress entirely; if the native overlay retains `/api/pop`, treat it as host-side legacy only.
- `vektorflow/stdlib/events.py`: keep Python responsible only for publishing already-normalized `input.event` payloads into tests and legacy adapters; move typed event shaping out of the hot loop next.
- `vektorflow/stdlib/ui.py`: keep scene topology changes as the only reason to rewrite scene payloads; display draw ops, representation refresh, and view-state churn should remain guardrailed as display-only work.
- `vektorflow/stdlib/ui.py`: once packet-first display rebuilding is owned elsewhere, trim `_sync_all()` down to orchestration and delete file-transport assumptions from the remaining Python seam.

### Concise Candidate List

1. `vektorflow/stdlib/ui.py`
- deepest remaining UI orchestration seam to shrink
- blocks `exe no Python on target machine` because redraw and scene orchestration still sit outside the runtime bundle seam

2. `vektorflow/stdlib/events.py`
- highest-leverage ingress seam to delete from the shipped runtime path
- blocks `exe no Python on target machine` because polling and event fan-out still live in Python outside the runtime bundle seam

3. `vektorflow/ui/payloads.py`
- smallest remaining packet-authority seam to move into the native shipped path
- blocks `exe no Python on target machine` because packet sequencing and packet-history ownership still live in Python

4. `vektorflow/ui/session.py`
- shallowest adapter to delete outright
- blocks `exe no Python on target machine` because file mirroring still assumes Python-owned compatibility copies

Build-time parser seam
- not a target-machine blocker if it stays build-only
- still blocks the stronger claim “Python deleted from the repo” if it grows back into the shipped path

### Last Legacy Tests Standing

- `/api/pop` is no longer part of the Python ingress success path. If the native overlay keeps that route temporarily, treat it as host-side compatibility only rather than a Python runtime dependency.
- Keep exactly one mirror-enabled packet transport suite: proving compatibility mirroring still works when intentionally enabled. All native-first transport regressions should default to `keep_packet_mirror=False` or treat mirror failure as non-authoritative.
- Keep `vektorflow/stdlib/ui.py` regression focus on scene-topology versus display-only churn. If a future test needs file outputs to explain behavior, prefer packet/display snapshots instead so file semantics can disappear without test rewrites.
