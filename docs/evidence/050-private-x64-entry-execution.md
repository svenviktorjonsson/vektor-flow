# Private source-produced x64 entry execution

Baseline: bootstrap `1a4740e2b4ad3b2893df3e24a9fa8633f6f867e3`.
This packet source-produces the bounded entry MachineFunction for the real
nine-string `manifest` call, encodes its result-context call and ownership
cleanup, composes it with the source-produced `manifest` body, installs the
callable code while preserving the runner CRT entry, and executes the generated
PE. This is generated program execution, not generated-compiler execution or a
self-hosting claim.

## RED to GREEN

The prior PE connected `AddressOfEntryPoint` directly to the non-entry
`manifest` ABI. It could not execute: no result context or nine string argument
cells existed, and the runner runtime table ended before allocation, release,
and abort slots 8, 9, and 10.

The private source slice now validates a binding call with nine empty string
literals and numeric success output. Its x64 encoder emits the complete native
Windows entry frame, runtime/string cells, aggregate result context, symbolic
call relocation, initialization and cleanup of nine owned string pairs, and
numeric return. The runner table now supplies string data, `malloc`, `free`, and
abort at the native ABI slots. Callable PE materialization restores the original
CRT entry after replacing `.vkfcod`.

An independent native compilation is the byte oracle. The source-produced
entry is 1,983 bytes; entry plus `manifest` is 4,424 bytes and matches the full
native `x64-code.bin` byte-for-byte. The materialized PE exits 0 with empty
stderr and exact stdout `1`. Four wrong-arity, non-empty-string, wrong-result,
and malformed-separator sources fail closed. Hardened focused GREEN: **1/1**,
12672.481 ms total.

## Regression and identity

Configured final serial checkpoint: **28/28**, exit 0, 104240.2672 ms. Complete
bundle was 11179.9011 ms, focused execution was 12543.7014 ms, and locked
source graph was 8777.3701 ms. Separate
bundle repeat: **1/1**, exit 0, 11404.1935 ms total (11322.6043 ms test).
Timings are receipts, not performance claims.

Fresh browser compiler generation retained the established generated hashes
(`2bb78c97...` WASM, `c342e0e1...` manifest); tracked public artifacts were
restored unchanged. No private helper is exported. No public syntax, semantics,
API, schema, diagnostic, optimizer policy, timeout, assertion, or fallback
changed.

Frozen self-copy, source-responsive successor production, generated-compiler
execution, deterministic compiler fixed point, broad parity, fallback removal,
and exact I240 seed remain missing. ADR-0005 acceptance stays conservatively
60% (delta 0).
