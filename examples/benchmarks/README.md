# Benchmark Suite

These examples are the current end-to-end benchmark set for Vektor Flow.

They are meant to do two jobs at once:

- prove that a representative slice of the language still runs correctly
- give us stable timings for parse, lower, interpret, C++ emit, and native compile/run when a compiler is available

Run them with:

```bash
vkf bench --list
vkf bench
vkf bench vectors records
```

Current benchmark lanes:

- `scalar_control.vkf`: scalar control flow, functions, loops, `??`, and return-channel behavior
- `vectors_shapes.vkf`: fixed vectors, symbolic sizes, and vector arithmetic
- `records_dynamic.vkf`: records mixed with dynamic `map(...)` / `list(...)`
- `multisets_records.vkf`: multisets inside record transforms
- `bitmask_match.vkf`: integer match specificity cases
- `custom_overloads.vkf`: interpreter-only overload coverage that is intentionally outside the current native subset
- `scalar_hotloop.vkf`: heavier scalar runtime loop workload
- `vector_hotloop.vkf`: heavier fixed-vector loop workload

The intent is to grow this folder into the practical compiler contract. When we add a new language feature to the native subset, we should usually add or extend a benchmark here too.
