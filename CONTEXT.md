# Vektor Flow Context

## Goal

Vektor Flow is moving toward a runtime and toolchain with no Python dependency.

The end state is:

- `.vkf` for self-hosted language modules
- `C++` as the bootstrap implementation until self-hosting is strong enough
- Python limited to a build-time parser seam during migration, then deleted
- a native runtime executable as the authoritative runtime host
- the target machine runs the native runtime executable with no Python installed
- no `.py` files in the repository
- no Python fallback path in the CLI, parser, runtime, or stdlib

## Domain Terms

- **Vektor Flow**: the language, toolchain, and runtime.
- **Vector**: fixed-size, contiguous runtime value. Not a Python list, not a linked list. Axis labels for broadcasting use **tight** ``expr->access`` (no spaces around ``->``, same adjacency rules as ``.``): identifier suffix is a literal axis name (never a variable lookup), so ``->ij`` tags as ``ij`` even if ``ij`` is bound; use ``->(expr)`` for a dynamic string/number key. Examples: ``a->i``, ``[1,2,3]->j``, ``v->(axis_name)``; ``->_`` means axis ``i``. **Function and type arrows** after ``)`` use a **spaced** `` -> `` (e.g. ``(x:num) -> num``, ``() -> num``) so they never collide with postfix ``)->`` axis access on parenthesized values.
- **Tuple**: positional immutable aggregate with tuple semantics, distinct from vectors.
- **Multiset**: counted bag value.
- **Native frontend**: the authoritative C++ module that owns source loading, lexing, parsing, and frontend diagnostics.
- **Token stream contract**: the versioned JSON envelope (`vektorflow.token_stream` schema in `vektorflow/token_stream.py`) that is the lexer→parser **interface**. Declared golden payloads live under `tests/fixtures/token_stream/` and pair with `examples/native_core/*.vkf`; refresh them from the Python lexer via `vektorflow.native_lexer_proto.write_fixture_for_source` or the `python -m vektorflow.native_lexer_fixtures` tooling so a second **adapter** (native lexer) can be checked for parity.
- **Build-time parser seam**: the temporary bootstrap boundary where Python may still participate in parsing or parser-fixture generation during builds, but never in the shipped runtime path. This seam should keep shrinking until the parser is native or self-hosted.
- **Bootstrap parser**: the parser written in C++ that exists so Vektor Flow can eventually replace it with a self-hosted parser.
- **Native runtime**: the authoritative runtime for values, evaluation, and stdlib behavior.
- **Native runtime executable**: the authoritative executable host for evaluation, stdlib behavior, and UI runtime execution. The migration target is `parser-only Python, native runtime exe` before Python is deleted entirely.
- **UI runtime packet contract**: the authoritative interface for scene replacement, display replacement, widget state replacement, append patches, and host input packets. File mirroring and HTTP/WebView transport are adapters behind this seam.
- **Runtime bundle seam**: the deep seam that packages packet-first UI runtime behavior into a native-consumable runtime bundle. It should let callers depend on one small interface for display payload assembly, representation refresh, and packet-first execution instead of knowing about Python redraw, file mirroring, or polling details.
- **Deep UI runtime modules**: the modules that earn leverage by hiding packet-first display and representation behavior behind a small interface. Today that means `vektorflow.ui.display_runtime` and `vektorflow.ui.representation_runtime`.
- **Shallow UI runtime modules**: the modules whose interface still leaks packet transport, polling, file mirroring, or redraw orchestration details. These are the main blockers for `exe no Python on target machine`.
- **Whole app packages without Python**: the point where the shipped application can be built, packaged, and run on the target machine with the native runtime executable and its native/web assets only. At that point Python may still exist at the build-time parser seam during repository migration, but it is not required on the target machine for startup, evaluation, UI rendering, or UI input.
Current target-machine blockers:
- `vektorflow/stdlib/ui.py`
- `vektorflow/stdlib/events.py`
- `vektorflow/ui/payloads.py`
- `vektorflow/ui/session.py`
- **Linked list**: the `collections.list` runtime value. This is not a vector.
- **System stdlib**: the future native stdlib module that will expose process execution, filesystem operations, and host integration needed for self-hosting.

## Migration Direction

The migration order is:

1. Make the native frontend authoritative.
2. Collapse Python down to the build-time parser seam only.
3. Replace Python runtime behavior with a native runtime executable.
4. Add the system stdlib needed for self-hosting.
5. Self-host language modules in `.vkf`.
6. Delete Python from the repo.

## Non-Goals

- Keeping Python as a permanent fallback.
- Treating vectors as dynamic host lists.
- Maintaining two authoritative implementations long term.
