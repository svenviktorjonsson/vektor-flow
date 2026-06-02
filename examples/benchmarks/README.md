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
- per-metric statistics: mean, median, min, max, standard deviation, and 95%
  confidence interval when at least two samples are available
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
- a benchmark score with two views:
  - `available_score`: weighted score over categories that have benchmark data
  - `complete_score`: weighted score where missing categories count as zero

The score is confidence-aware: when a metric has multiple samples, categories
score against the 95% upper confidence bound rather than the most optimistic
single timing.

Benchmark `ok` means the timing run completed without execution errors.
Correctness parity is tracked separately with `output_match` and the text report
prints an `output mismatches:` line when interpreter/native formatting or
semantics still drift.

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
- `eventloop_dispatch.vkf`: event-loop style dispatch/pump workload
- `ui_scene_loading.vkf`: scene payload construction and native compile/load proxy

UI scene FPS space is benchmarked by the Python-free Node runner:

```bash
node scripts/run-ui-scene-fps-benchmark.cjs
node scripts/run-ui-scene-fps-benchmark.cjs --frames=120 --warmups=20 --json
```

That runner samples authored scene configurations and reports estimated FPS for
each case. The contract includes object mix, view changes per frame, object
changes per frame, vertices, edges, faces, and approximate effect settings for
lighting, shadows, and reflections.

The UI FPS runner currently measures:

- runtime object transform mutations
- runtime geometry vertex mutations
- transform arena dirty reads
- geometry arena dirty reads

It currently approximates:

- camera/view projection work
- lighting evaluation
- shadow pass overhead
- reflection pass overhead

This makes it useful for answering "given this sample of scene configuration
space, what FPS can I expect under the current runtime/effect-cost model?"
It is not yet a browser/WebGPU presentation benchmark.

Current score categories:

- `compile_time`: native compile cost for representative small cases
- `runtime`: steady native scalar/control and stdlib runtime cost
- `array_operations`: steady vector and large-array runtime cost
- `eventloops`: steady event dispatch/pump runtime cost
- `ui_scene_loading`: scene payload construction/native load proxy plus the
  Python-free Node UI scene-space FPS runner; browser/WebGPU presentation
  measurement still needs a dedicated future lane

Reference timings are runtime-only checks. They do not include parse, lower, C++ emit, or native compile cost. That makes them useful for answering a different question:

- how fast is the generated native code once it exists?
- how close are we to plain Python loops?
- how close are we to NumPy for the same operation?

The intent is to grow this folder into the practical compiler contract. When we add a new language feature to the native subset, we should usually add or extend a benchmark here too.
