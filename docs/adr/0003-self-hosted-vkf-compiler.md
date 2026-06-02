# ADR 0003: VKF Compiler Becomes Self-Hosted And Native-Driven

Date: 2026-05-31

## Status

Accepted.

## Context

`vkf` currently resolves to a Python entrypoint in common developer shells. That
means even deciding whether a source file needs compilation can pay Python
startup cost. It also keeps the language frontend, scene lowering, launch
staging, and runtime execution entangled with compatibility code.

The desired developer loop is:

```powershell
vkf examples\110_mirror_showcase.vkf
```

or, once already compiled:

```powershell
.\examples\110_mirror_showcase.exe
```

That loop must be fast and truthful. It must not silently fall back to Python.

## Decision

`vkf.exe` is the native compiler driver.

Its interface is:

- `vkf <source.vkf>` compiles stale or missing artifacts, then runs the compiled
  executable
- `.\example.exe` runs the already compiled artifact directly
- stale detection happens before compiler startup and does not require Python
- missing native compiler support is a hard error, not a fallback

The compiler frontend becomes self-hosted:

- the new lexer, parser, and typed-IR builder are VKF source
- the old Python parser may compile the first self-hosted compiler artifacts
  during bootstrap only
- parity tests compare old parser output to the self-hosted compiler output
- once parity is complete, the old Python parser path is removed

The native compiler driver owns the build plan:

`VKF source -> dependency scan -> manifest check -> self-hosted compiler -> artifact -> run`

The runtime path is:

`example.exe -> compiled VKF program/runtime bundle -> overlay/runtime host`

Python is not part of either path.

## Artifact Model

For `examples/foo.vkf`, the compiler produces:

- `examples/foo.exe`
- `examples/.vkfbuild/foo.manifest.json`
- generated runtime bundle files referenced by the manifest

The manifest records:

- compiler identity and version
- source hash
- imported VKF/stdlib dependency hashes
- runtime asset hashes or runtime ABI version
- output executable path
- generated bundle paths

Timestamps may be used as a fast prefilter, but correctness comes from hashes
and manifest contents.

## Bootstrap Plan

1. Native `vkf.exe` owns command dispatch, artifact naming, dependency checks,
   and run behavior.
2. Write a narrow VKF lexer in VKF and compile it with the old Python path.
3. Add token-stream parity tests against the current lexer.
4. Write the VKF parser in VKF over the token stream.
5. Add AST and typed-IR parity tests against the current parser/lowering path.
6. Move scene lowering and package staging behind the self-hosted compiler
   interface.
7. Make `vkf <file>` use only the self-hosted compiler.
8. Delete the old Python parser/runtime compiler path.

## Language Pressure From Self-Hosting

The compiler is expected to be possible to build in VKF. Self-hosting is the
test that the language has enough expressive power for real programs, not only
examples.

While implementing lexer, parser, typed IR, and lowering code, we should record
language friction as first-class compiler work. Likely pressure points:

- string scanning and slicing
- byte/character iteration
- parser combinators or pattern matching
- result/error propagation
- maps/sets with stable ordering
- spans and source diagnostics
- immutable update ergonomics for AST/IR nodes
- small syntax sugars that remove noise without hiding semantics

Any sugar added during this work must pay for itself in compiler code clarity
and still lower cleanly to typed IR, C++, and WASM.

## Consequences

- Compatibility code can no longer hide inside the default `vkf` path.
- Compile speed is measurable at the native driver seam.
- Runtime speed is measurable through the compiled executable seam.
- The old parser remains useful only as a temporary bootstrap adapter.
- Tests must prove parity before deletion, not rely on visual examples alone.
