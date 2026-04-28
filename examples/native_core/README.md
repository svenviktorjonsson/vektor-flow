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
- `named_record_scene_native.vkf` - nested named records carrying compiled collection state
- `named_record_scene_chain_native.vkf` - chained scene updates through multiple compiled named-record locals
- `named_record_scene_helpers_native.vkf` - helper-based scene reconstruction through named-record locals
- `named_record_scene_handoff_native.vkf` - helper-based chained scene handoff through multiple compiled locals
- `named_record_scene_relay_native.vkf` - helper-return scene relay through staged compiled named-record locals
- `named_record_scene_fanout_native.vkf` - helper fanout/merge through typed Point, State, and Scene locals
- `named_record_scene_compose_native.vkf` - helper-return scene composition through final typed Scene merge
- `named_record_scene_overlay_native.vkf` - merge two helper-return Scene values through a final typed Scene overlay
- `named_record_scene_patch_native.vkf` - patch a helper-return Scene with a separately computed typed State local
- `named_record_scene_split_native.vkf` - split a staged Scene into typed Point and State locals before final Scene rebuild
- `named_record_scene_splice_native.vkf` - splice typed Point and State locals from separate helper-return Scene paths
- `named_record_scene_rebuild_native.vkf` - rebuild typed Scene locals in two successive top-level update steps
- `named_record_scene_crossfade_native.vkf` - crossfade two rebuilt Scene locals into one final typed Scene
- `named_record_scene_reverse_native.vkf` - derive final Point and State from a rebuilt Scene in the opposite update order
- `named_record_scene_checkpoint_native.vkf` - direct typed Scene-to-Scene checkpoint handoff after a helper-return step

Typical workflow:

```bash
vkf build examples/native_core/hello_native.vkf
./examples/native_core/hello_native.exe
```

As the frontend moves out of Python, this folder should stay the same. The goal
is to keep the contract stable while the implementation underneath changes.

