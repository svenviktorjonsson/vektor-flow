# Benchmark Suite

These examples are the current end-to-end benchmark set for Vektor Flow.

They are meant to do two jobs at once:

- prove that a representative slice of the language still runs correctly
- give us stable timings for parse, lower, interpret, C++ emit, and native compile/run when a compiler is available
- make the Python/interpreter path and native path directly comparable in `ms`

Run them with:

```bash
vkf bench --list
vkf bench
vkf bench --json
vkf bench --samples 5
vkf bench --samples 5 --native-runs 7
vkf bench --samples 5 --native-runs 7 --native-warmups 1
vkf bench --save-baseline examples/benchmarks/baseline.json
vkf bench --compare-baseline examples/benchmarks/baseline.json
vkf bench vectors records
```

The benchmark output now reports:

- raw phase timings in `ms`
- medians when sampling is enabled with `--samples N`
- compile-once/run-many native timing when `--native-runs N` is used
- optional cold-run discard via `--native-warmups N`
- baseline save/load with `--save-baseline FILE` and `--compare-baseline FILE`
- `python_roundtrip_ms` = parse + interpret
- `native_roundtrip_ms` = parse + lower + emit + compile + native run
- `native_steady_speedup` = interpreter runtime / native runtime
- `native_roundtrip_vs_python` = Python roundtrip / native roundtrip
- optional runtime-only reference lanes:
  - `python_ref_ms`
  - `numpy_ref_ms`
  - `native_vs_python_ref`
  - `native_vs_numpy_ref`
- raw per-sample arrays in JSON output

That gives us both:

- a steady-state runtime comparison
- an end-to-end comparison that includes native compile cost

Current benchmark lanes:

- `scalar_control.vkf`: scalar control flow, functions, loops, `??`, and return-channel behavior
- `vectors_shapes.vkf`: fixed vectors, symbolic sizes, and vector arithmetic
- `records_dynamic.vkf`: records mixed with dynamic `map(...)` / `list(...)`
- `multisets_records.vkf`: multisets inside record transforms
- `bitmask_match.vkf`: integer match specificity cases
- `stdlib_numeric.vkf`: portable `math` / `stat` intrinsic coverage in the native subset
- `custom_overloads.vkf`: interpreter-only overload coverage that is intentionally outside the current native subset
- `scalar_hotloop.vkf`: heavier scalar runtime loop workload
- `vector_hotloop.vkf`: heavier fixed-vector loop workload
- `vector_large_elementwise.vkf`: large fixed-vector elementwise arithmetic, compared against pure Python and NumPy references
- `vector_large_reduce.vkf`: large fixed-vector indexed reduction, compared against pure Python and NumPy references

Reference timings are runtime-only checks. They do not include parse, lower, C++ emit, or native compile cost. That makes them useful for answering a different question:

- how fast is the generated native code once it exists?
- how close are we to plain Python loops?
- how close are we to NumPy for the same operation?

The intent is to grow this folder into the practical compiler contract. When we add a new language feature to the native subset, we should usually add or extend a benchmark here too.
