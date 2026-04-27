# Python Dependency Audit And De-Pythonization Plan

This document audits the current runtime and UI surface from the perspective of the long-term target:

`vkf source -> native frontend -> IR -> C++ -> binary`

with **no Python dependency** required to build or run the core language.

It complements [NATIVE_CORE.md](./NATIVE_CORE.md) by focusing specifically on what still depends on Python and how to remove it in a controlled order.

## Boundary Model

We should keep three layers explicit:

1. **Portable core runtime**
   - Required for `vkf -> binary`.
   - No Python.
   - May use C++ standard library and OS APIs where needed.
2. **Host shell / adapters**
   - UI windows, browser launch, HTTP bridge, event pumps, platform process management.
   - Can remain platform-specific, but should not require Python once replaced.
3. **Reference interpreter host**
   - Python-only implementation used while the native pipeline grows.
   - This layer should shrink over time instead of being treated as permanent runtime.

The mistake to avoid is mixing (1) and (2). `math`, `stat`, core `collections`, and basic `io` belong in the portable runtime. `ui.launch`, browser serving, and overlay bridging belong in the host shell.

## Current Inventory

| Surface | File(s) | Current Python / host dependency | Classification | Priority | Native replacement boundary |
| --- | --- | --- | --- | --- | --- |
| `math` stdlib | `vektorflow/stdlib/math.py` | Python `math` module; namespace factory in Python | Portable core runtime | P0 | Native intrinsic table plus runtime math shims |
| `stat` stdlib | `vektorflow/stdlib/stat.py` | Python loops, lists, sorting, `math.sqrt` | Portable core runtime | P0 | Native numeric buffer + stat kernels |
| `collections.map/list/queue` | `vektorflow/stdlib/collections.py` | Python factories, `deque`, `VMap`, `VFLinkedList` | Portable core runtime | P0 | Native collection runtime types with same surface constructors |
| `io` text/bytes/numbers/sleep` | `vektorflow/stdlib/io.py` | Python `Path`, file IO, `time.sleep`, optional NumPy fallback already removed as hard dep | Portable core runtime | P0 | Native file/bytes API + numeric table loader over native buffers |
| `time` stdlib | `vektorflow/stdlib/time.py` | Python `time`, `datetime` | Portable core runtime with OS hooks | P1 | Native clock/sleep formatting shim |
| `capture` stdlib | `vektorflow/stdlib/capture.py` | Python `re` | Portable core runtime | P2 | Native regex facade, or keep out of native core until regex policy is fixed |
| stdlib registry | `vektorflow/stdlib/__init__.py` | Python namespace factory registry | Interpreter host glue | P1 | Native stdlib symbol table / import registry |
| UI scene model | `vektorflow/ui/ir.py`, parts of `vektorflow/stdlib/screen.py` | Python dataclasses / JSON writing | Host adapter boundary, but structurally portable | P1 | Freeze JSON/IR schema, then reimplement writer in native host |
| UI widget/frame API | `vektorflow/stdlib/screen.py`, `vektorflow/stdlib/ui.py` | Heavy Python object graph, JSON file sync, direct repo file copying | Host shell | P0 for boundary, P2 for full port | Native UI emitter built on frozen scene/event protocol |
| UI event system | `vektorflow/stdlib/events.py` | Python threads, `urllib`, deque, port discovery, HTTP polling | Host shell | P0 for separation | Native event pump / overlay bridge process |
| UI HTTP bridge | `vektorflow/ui/bridge.py`, `vektorflow/stdlib/bridge.py` | Python `urllib`, regex, JSON, filesystem port probing | Host shell | P1 | Native RPC/HTTP bridge client |
| UI launch | `vektorflow/ui/launch.py` | Python `subprocess`, `webbrowser`, `http.server`, env resolution | Host shell | P0 for removal from runtime path | Native launcher or separate dev-only tool |
| Browser assets | `web/vf-ui/*`, `native/VfOverlay/*` | JS/WebView2/native host, not Python at runtime | Host shell, already outside Python mostly | P1 | Keep as host shell; remove Python mediation around it |

## What Is Already In Better Shape

- The native compiler already lowers a growing subset of `math.*` and `stat.*` directly, so the language semantics are no longer fully blocked on Python there.
- NumPy is no longer a mandatory dependency for `io.read_numbers`; that was the right move and should be treated as the model for future cleanup.
- The UI scene representation in `vektorflow/ui/ir.py` is already close to a portable boundary: simple records, enums, JSON-serializable payloads.

## Highest-Value Python Dependencies To Remove

### P0: Portable runtime blockers

These keep the core language tied to Python even when the compiler can emit C++.

1. **Core collections runtime**
   - Current blockers: `VMap`, `VFLinkedList`, `deque`-backed queue factories live behind Python factories.
   - Why first: collections sit underneath both stdlib and general runtime semantics.
   - Exit condition: `collections.map`, `collections.list`, `collections.queue` have native runtime implementations and native reflection/printing.
   - Current progress:
     - `VMap` and `VFLinkedList` already live under `vektorflow/runtime/`.
     - `VFQueue` and shared runtime factories now exist in `vektorflow/runtime/collections_runtime.py`.
     - Remaining step: switch stdlib collection factories and event plumbing over to this runtime seam.

2. **Basic `io`**
   - Current blockers: file reads/writes, path normalization, sleep all call Python directly.
   - Why first: a standalone binary needs file IO without Python.
   - Exit condition: text/bytes IO and `sleep_ms`/`time.sleep` equivalents work in native binaries through runtime shims.

3. **`math` / `stat` runtime fallback**
   - Current blockers: interpreter-hosted namespace factories still own the portable definitions.
   - Why first: even if compiler inlines many cases, the runtime contract still lives in Python.
   - Exit condition: portable native stdlib table contains these functions, with Python only as reference implementation.

### P0: UI/runtime separation blockers

These do not need to be part of the portable runtime, but they need a hard boundary so the compiler/runtime can be Python-free while UI remains available.

1. **`ui.launch`**
   - Current blockers: Python spawns overlay/browser and serves files.
   - Desired end state: a native launcher/dev tool or direct shell integration, not a runtime dependency.

2. **`stdlib.events` / `ui.bridge`**
   - Current blockers: Python owns polling threads, HTTP requests, and event queue draining.
   - Desired end state: native host process or platform shell owns the event pump; VKF/native runtime consumes a stable event stream.

3. **`stdlib/ui.py` / `stdlib/screen.py` mediation**
   - Current blockers: Python writes `vf-scene.json`, `vf-display.json`, state files, and syncs assets into built directories.
   - Desired end state: native UI emitter writes the same protocol directly, without Python file-copy logic.

## Recommended Extraction Order

### Phase 1: Finish the portable core runtime

Do these before frontend rewrites start absorbing too much attention.

1. **Native collection runtime**
   - Replace Python-backed `VMap`, `VFLinkedList`, queue surface for the native core.
   - Preserve current semantics and printing.
2. **Native basic IO/time shims**
   - `read_text`, `write_text`, `read_bytes`, `write_bytes`, `sleep_ms`, `time.sleep`, timestamp/time formatting.
3. **Native stdlib table for portable math/stat**
   - Move from “compiler recognizes some names” to “native runtime owns the namespace contract”.
4. **Numeric buffer path**
   - Let `stat` and `io.read_numbers` converge on the same native buffer representation.

### Phase 2: Freeze the UI host boundary

1. **Declare the scene/event protocol stable**
   - `vektorflow/ui/ir.py` is the candidate contract.
2. **Separate dev-only launch helpers from runtime API**
   - Browser auto-launch, repo-root probing, file syncing, and overlay discovery should be tooling, not runtime.
3. **Move event transport behind one narrow interface**
   - Native host can later speak the same protocol without reproducing Python thread/HTTP details.

### Phase 3: Replace the frontend host pieces

1. Native lexer
2. Native parser
3. IR serialization/loading
4. Retain Python interpreter as a reference implementation until parity is high enough to demote it from the default toolchain

This ordering matters: if the portable runtime is still Python-backed, a native frontend alone does not give a Python-free language.

## Explicit Keep / Replace Decisions

### Keep as host-shell concerns

These do **not** need to be in the portable runtime:

- browser auto-launch
- WebView2 / overlay process management
- HTTP polling details
- repo-root probing and asset syncing
- Playwright/browser test glue

They should still be removed from Python eventually, but they belong to the host shell, not the core runtime.

### Must move out of Python for the language to be standalone

- stdlib `math`
- stdlib `stat`
- stdlib `collections`
- stdlib `io`
- stdlib `time`
- stdlib registry/import hookup for the native core
- frontend lexer/parser/IR loading

## Practical Milestones

### Milestone A: Standalone numeric CLI core

A fresh machine needs only:

- VKF source
- native frontend/compiler
- C++ toolchain

No Python required to:

- build a native-core example
- run numeric/stat/math/vector examples
- read/write files

### Milestone B: Standalone hosted UI shell

A fresh machine needs only:

- native frontend/compiler
- native runtime
- native UI host shell / browser shell

No Python required to:

- build a UI example
- launch the host shell
- poll events
- write scene/display state

## Short-Term Action Queue For The Orchestrator

1. **Collections-native worker**
   - Port `collections.map/list/queue` off Python factories and runtime objects.
2. **IO/time-native worker**
   - Port file/text/bytes/sleep/time primitives into the native runtime.
3. **Math/stat-native worker**
   - Finish moving the stdlib contract from Python namespace factories into native runtime-owned intrinsics/buffers.
4. **UI-boundary worker**
   - Extract a stable scene/event protocol doc from `ui/ir.py`, `screen.py`, and `events.py`; move launch/file-sync logic behind a dev-only seam.
5. **Frontend worker**
   - Continue lexer/parser/token/IR extraction only after the portable runtime above is no longer Python-backed.

## Definition Of Done For “No Python”

The project should not claim to be Python-free until all of these are true:

- `vkf build` does not require Python
- produced native binaries do not require Python
- portable stdlib core (`math`, `stat`, `collections`, `io`, `time`) is not implemented in Python
- UI support, if enabled, is provided by a non-Python host shell
- Python remains optional reference tooling only
