# Shared WASM standard-library classification — 2026-09-06

- Artifact SHA-256: `5e6a3d527efaea2914c18a379121da0e6f8bb6a9f2f93a4e583387890fc85cbc`.
- A public actual-worker tracer now proves the unchanged time guide reports
  `unsupported standard-library call time.wall_seconds ...`; it no longer
  misclassifies the zero-argument capability as a unary math intrinsic.
- `vkf_stdlib_classification.hpp` is a target-neutral classification seam for
  unary math, statistics, output, collections, browser capabilities, and
  unsupported calls. WASM arity checks now run only after exact family selection.
- Documentation failures for time, IO, system, process, and regex now identify
  their exact unsupported calls. No host import, fallback, or JS semantics were
  introduced.
- Public actual-worker tracers: 20/20. Native language suite: 451/451;
  shared native/WASM: 316/451; documentation exact: 62/87 (71.26%), smoke:
  67/87; shared frontend/UI: 37/37; execution/public-boundary: 91/91.
  Production artifact imports: zero.

Full reports: `shared-documentation-exact-stdlib-classification-2026-09-06.json`
and `native-wasm-suite-stdlib-classification-2026-09-06.json`.
