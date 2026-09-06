# Shared WASM record-selector semantics — 2026-09-06

- Artifact SHA-256: `fdcf0941c17b589d8c9e03b462a95c367f0dd5cbdd228b70f7774ef9ea34b17c`.
- `vkf_record_selector_plan.hpp` owns the target-neutral ordered-field plan,
  selector/result types, and canonical missing-key assertion semantics.
- The WASM adapter evaluates the record and selector exactly once, tests real
  fields in frontend order, preserves numeric and owned string values, and
  constructs caught missing-key errors inside emitted WASM.
- Public actual-worker tracers: 3/3, including exact `[8, 7]`, owned/local
  string selection, and `unknown record selector key` output.
- Native language suite: 451/451. Shared native/WASM parity moves from 318/451
  to 322/451. Newly exact cases are numeric selector promotion, dynamic
  homogeneous selection, owned selector evaluation, and owned string fields.
- Documentation exact parity remains 63/87 (72.41%); execution smoke remains
  68/87. Shared frontend/UI: 37/37; execution/public-boundary: 91/91.
  Production artifact imports: zero.
- No JavaScript language values, metadata replay, fallback, host import, or
  public compiler response change was introduced.

Full reports: `shared-documentation-exact-record-selector-2026-09-06.json`
and `native-wasm-suite-record-selector-2026-09-06.json`.
