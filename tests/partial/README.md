# Partial native suites

These VKF tests cover unfinished modules. They are intentionally outside
`tests/vkf`, so they cannot enter a release gate before their complete module is
native on Windows, Linux, and macOS.

The intended final test model is:

- physics and symbolic behavior asserted directly in VKF;
- the same VKF semantics compiled to native and WASM targets;
- UI scene and event assertions written in VKF and executed by a headless host;
- platform harnesses limited to starting the target and returning results.
