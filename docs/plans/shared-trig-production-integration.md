# Shared trig production integration

Accepted Math A: use the audited, versioned compiler-owned sin/cos source on
every binary64 VKF evaluation path. Candidate evidence is committed at
`905394a8`; production selection is still RED. No accuracy threshold, diagnostic,
runtime slot, public schema or acceptance identity is changed by this plan.

## Production migration matrix

| Consumer | Current divergent selection | Required proof |
| --- | --- | --- |
| Direct ELF x64 (`vkf_elf_writer.hpp`) | libm `sin`/`cos` imports | Emitted executable uses packaged code, no trig imports, exact candidate results |
| Direct PE x64 (`vkf_pe_writer.hpp`) | MSVCRT `sin`/`cos` imports | Same source packaged with Windows x64 ABI; executable parity and import inspection |
| Direct Mach-O ARM64 (`vkf_macho_writer.hpp`) | libSystem `_sin`/`_cos` binds | Same source packaged with ARM64 ABI; executable parity and bind inspection |
| Runner template (`vkf_x64_runner_template.cpp`) | CRT / `std::sin` / `std::cos` | Runtime slots 4/5 retain ABI and select compiler-owned functions |
| Tuning/JIT (`vkf_x64_artifact.cpp`) | host `std::sin` / `std::cos` addresses | Candidate exact results through installed runtime table |
| Emitted WASM (`vkf_wasm_vm_emitter.hpp`) | old handwritten Taylor emitter | Import-free emitted program uses the packaged candidate, exact results |
| Compiler numeric evaluator (`vkf_compiler_artifact_smoke.cpp`) | host math | Same candidate on actual VKF expression evaluation |
| Retained numeric evaluator (`vkf_retained_scene_packet.hpp`) | host math | Same candidate on actual VKF expression evaluation |
| WASM artifact numeric evaluator (`vkf_wasm_artifact_smoke.cpp`) | host math | Same candidate on actual VKF expression evaluation |
| WebGPU artifact numeric evaluator (`vkf_webgpu_artifact_smoke.cpp`) | host math | Same candidate on actual VKF expression evaluation |

The ELF and Mach-O bindings are additional findings beyond the first math audit.
Updating only the runner and JIT would not even fix direct Linux executables.
Source-level opcode dispatch remains unchanged in the machine/ARM64 encoders.
Presentation float rotations and generated GPU shader trig remain outside this
binary64 language-policy change; do not quietly change their hashes.

## First production tracer: RED

`node --test tests/bootstrap/shared-trig-production.test.mjs` executes exact
candidate comparisons inside VKF, including the candidate's different last bit
at `sin(2.5)` and the near-root cosine/sine results. The browser result remains
only `kind`, `stdout`, `stderr`. Initial result: **0/2**; native assertion exits
134, emitted WASM assertion traps `unreachable`. A malformed initial fixture was
corrected before capturing this numerical RED; that parser rejection is not
counted as evidence of a math defect.

## Packaging sequence

1. Build dependency-free native code/data bundles from the same eight licensed C
   sources, with source-hash identity and strict evaluation flags. Resolve
   internal calls and constants at build time; preserve each platform ABI.
2. Package the same sources' WASM functions, constants and private stack. Bind
   those dependencies inside the emitted program, never through JavaScript or
   host imports. Reject unexpected external dependencies or relocation forms.
3. Install the package at the production sites above, with exact behavior tests
   for each site. A Linux-only or WASM-only result is not an integration GREEN.
4. Re-run candidate domain/edge accuracy and native/WASM bit parity; then native
   451/451, unchanged focused/non-math gates, exact sine stdout and the full WASM
   suite. Preserve unrelated REDs and explicitly review downstream identity
   changes. No performance claim follows from these correctness gates.

No production consumer has been switched at this checkpoint.
