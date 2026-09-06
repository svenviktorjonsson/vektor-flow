# Concrete parameter, argument, and MachineModule assembly

Baseline: bootstrap `86217733e718b79e8d29a829ba3a23cec142c238`.

This tracer extends the general tagged cursor path from declaration/call
resolution into concrete parameter and argument arenas, then assembles the
resolved function body and entry into a complete MachineModule-shaped value.

## RED to GREEN

The public strict-CLI tracer first failed **0/1**, exit 1, 4186.1412 ms at the
previous direct-call boundary:

```text
direct x64 backend unsupported: machine IR supports direct calls only
```

GREEN iterates the declaration table into a concrete parameter arena and keeps
call order plus argument position in a separate concrete argument arena. The
current declaration contract remains one `num` parameter and the current
argument contract remains the imported `cpu_count: fn()->int`; unsupported
arity is rejected rather than guessed.

Machine IR uses uniform concrete instruction and function records plus dynamic
typed arenas. It does not route through `mir_function(... any ...)`, a
heterogeneous `any` adapter, or a fixed-token overload. The assembled entry
calls `cpu_count`, calls the resolved function, and returns f64. The function
loads its parameter, pushes the source numeric payload, multiplies, and returns
f64. A typed matcher materializes dynamic function/instruction rows and proves
their exact symbols, parameter, value, and source order.

Focused GREEN passed **1/1**, 6201.1819 ms. The complete cursor/source identity
suite passed **6/6**, 17891.9666 ms. The final expanded locked checkpoint
passed **36/36** after the one misconfigured bundle-tool invocation was rerun
with the locked explicit tool path. Stage 1 artifact plus locked Stage 2 source
graph passed **2/2**, 20896.1371 ms. Independent full executable bundle repeat
passed **1/1**, 12586.4391 ms.

No public syntax, semantics, API, ABI, schema, diagnostic contract, fallback,
timeout, assertion, or optimizer policy changed. The shared concrete Machine
IR records remain usable by native and WASM consumers.

This closes parameter/argument arena construction and the current numeric
function/entry module assembly only. General arity and argument expressions,
control flow, collections, full compiler-module parsing, successor compiler
production, generated-compiler fixed point, fallback removal, and the exact
I240 seed remain open. ADR-0005 stays conservatively 60% (delta 0).
