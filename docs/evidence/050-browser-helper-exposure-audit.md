# Browser compiler helper exposure audit

Read-only audit at bootstrap `2ad3038819c508416e35d81284f0d57913d2f2d5`.
No artifact, export, manifest, schema, or ABI was changed.

## Verified path

`tools/build-browser-compiler.mjs` invokes the existing artifact generator with
`--entry run_tagged_dependency_source --prune-to-entry`. That flag computes the
transitive direct-call closure; it does not make reachable functions private.

`compiler/native/vkf_symbolic_kernel_artifact.cpp::manifest_value` publishes
every retained function's name, index, parameter count, and result type under
the version-1 `vektor-flow.symbolic-kernel` manifest's `functions` object.
`executable_typed_module` removes unreachable function bodies, while preserving
the reachable lexer helpers needed by the entry. Deleting those bodies would
break the compiler; reachability and public visibility are different concerns.

The shipped WASM exports memory and 15 generic VM functions, including
`vkf_vm_invoke` and `vkf_vm_evaluate`. It does not export individual lexer names.
However `web/vf-ui/vf-symbolic-kernel-runtime.mjs::invokePointer` resolves any
manifest name and passes its numeric index to `vkf_vm_invoke`. The public
generic `invokeValue` interface therefore exposes those helpers indirectly.

`web/playground/vkf-browser-compiler.mjs` wraps only
`compile_tagged_dependency_tape` and `run_tagged_dependency_source` as `compile`
and `run`. That wrapper does not prevent clients from instantiating the generic
runtime using the downloadable manifest/WASM themselves.

## Executed probe

Node `v22.14.0`, Windows `10.0.26200.0`, read-only local WASM instantiation:

```js
const kernel = createSymbolicKernel({ instance, manifest });
kernel.invokeValue("__vkf_module_lexer___tagged_function_punctuation_kind", ["+"]);
// 2
kernel.invokeValue("__vkf_module_lexer___tagged_function_punctuation_kind", ["="]);
// throws "unreachable"
```

Artifact SHA-256:

- WASM: `2f936751afeb338111ec5086bcac535405eb0a192e4d39602e05580453f6ef7f`
- Manifest bytes: `83b72747dbb8ba8b2d308a7794fcf36cee6cb8ec8e55c28b71f5dc0978205628`

No browser DOM/session test or performance measurement is implied.

## Decision boundary

The equality-token packet is paused at
`docs/plans/bootstrap-token-helper-boundary.md`. Its proposed numeric code is
observable through the generic interface even though no in-repository external
decoder was found. Do not change it without the language designer's decision.

A future visibility packet could separate compiler entry-point metadata from
internal call-graph reachability. Merely deleting manifest names is not a
security boundary: the generic VM still accepts numeric indices. Narrowing
that invocation boundary or removing exposed names would itself change the
ABI and needs a separate approved contract and regression tests. No such
change is implemented here.
