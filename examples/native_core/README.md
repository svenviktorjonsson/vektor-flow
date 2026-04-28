# Native Core Examples

These are the examples that define the current **Python-free runtime** contract:

- they should run under the interpreter
- they should compile with `vkf build`
- the resulting executable should run without Python at runtime

This folder is intentionally narrower than `examples/benchmarks`:

- `benchmarks/` is about timing and optimization
- `native_core/` is about the standalone language slice we are promising

Current examples:

- `hello_native.vkf` - scalar arithmetic and direct printing
- `vectors_native.vkf` - fixed vectors and symbolic-size-safe vector math
- `records_native.vkf` - records mixed with vectors and multisets
- `numeric_native.vkf` - compiled `math` / `stat` intrinsic coverage
- `named_record_native.vkf` - compiled named record declarations and return flow
- `named_record_nested_native.vkf` - nested compiled named record resolution
- `named_record_collections_native.vkf` - named records with compiled vector and multiset fields

Typical workflow:

```bash
vkf build examples/native_core/hello_native.vkf
./examples/native_core/hello_native.exe
```

As the frontend moves out of Python, this folder should stay the same. The goal
is to keep the contract stable while the implementation underneath changes.

