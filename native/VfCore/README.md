# VfCore

`VfCore` is the native frontend module for Vektor Flow.

Its job is to become the authoritative seam for:

- source loading
- tokenization
- parsing
- frontend diagnostics

This module is the bootstrap implementation that will eventually be replaced by self-hosted `.vkf` language modules. Until then, new authoritative frontend work should land here instead of in Python.

## Scope

Current scope:

- native CLI entrypoint scaffold
- source loading seam
- command contract for future `lex`, `parse`, and `run`

Future scope:

- token model
- lexer
- parser
- typed frontend
- runtime entrypoint
