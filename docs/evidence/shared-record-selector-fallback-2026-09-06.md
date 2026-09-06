# Shared WASM record-selector fallback — 2026-09-06

- Artifact SHA-256: `1071e178cde8e86beca27fc67d03a0186d5b05dbae298401c8400f552fa668f7`.
- Public actual-worker fallback tracer changed from `unreachable` to exact native
  `[9, 9, 0]`: real fields win, then the compiler-resolved dot overload runs.
- The selector plan now carries its optional fallback symbol. Program
  reachability follows that canonical semantic edge, and bytecode lowering
  validates the retained function arity/result before calling it with the
  once-evaluated record and selector.
- Native language suite: 451/451. Shared native/WASM parity moves from 322/451
  to 324/451 with no regression. Newly exact cases are dynamic numeric fallback
  and independent real/fallback string lifetimes.
- Documentation exact parity remains 63/87 (72.41%); execution smoke remains
  68/87. Shared frontend/UI: 37/37; execution/public-boundary: 91/91.
  Production artifact imports: zero.
- No JavaScript language values, metadata replay, fallback simulation, host
  import, or public compiler response change was introduced.

Full reports: `shared-documentation-exact-record-selector-fallback-2026-09-06.json`
and `native-wasm-suite-record-selector-fallback-2026-09-06.json`.
