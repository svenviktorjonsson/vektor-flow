# VKF Standard Library Ownership

The VKF standard library belongs in `vektor-flow`.

## Decision

VKF-owned standard library code should be tracked with the compiler, runtime,
examples, docs, and tests. That includes:

- language-level helpers
- `ui` stdlib declarations
- runtime-facing UI adapters that encode VKF semantics
- examples that demonstrate stdlib behavior
- tests that lock expected stdout, UI packets, and runtime lowering

External third-party dependencies may remain external or vendored under an
explicit dependency policy. VKF-owned stdlib code should not be a submodule.

## Why

The stdlib is part of the language contract. Changing it often requires
matching changes in parser/type behavior, runtime lowering, docs, examples, and
tests. Keeping those files together gives locality: one commit can explain the
language behavior and the runtime behavior together.

Splitting VKF stdlib or `vf-ui` into a separate repo creates a shallow seam. The
interface is not stable enough to buy independent release leverage, and the
extra repository boundary creates detached HEADs, hidden dirty state, and
submodule push-order failures.

## Repository Shape

Use one of these locations when stdlib files become explicit source files:

- `std/` for source-visible VKF modules
- `vektorflow/std/` for Python-side compiler/runtime support for stdlib modules
- `web/vf-ui/` for browser/runtime code that implements VKF `ui` stdlib
  semantics

The native overlay host remains separate in `transparent-overlay`. It may host
compiled modules and packets, but it must not know VKF stdlib semantics.
