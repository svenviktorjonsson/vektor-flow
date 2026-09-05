# Shared trigonometry: A accepted, implementation pending

2026-09-05. Viktor explicitly chose **math A**: one versioned deterministic
compiler-owned sin/cos policy for native and WASM. First establish a more accurate
portable candidate against high-precision and edge references; do not adopt the
weaker current Taylor emitter. Cover runner/JIT/PE/ARM64 and constant evaluators
without ABI or diagnostic changes; never replace acceptance hashes silently.
Implementation is pending and the exact sine-output test remains RED. This is
a separate approval from the earlier output-only browser boundary decision.

## Evidence

The existing kernel gate passes 13/13 unchanged. A separate audit tested 12,793
input occurrences: README 101, decimal grid 201, quadrant neighbors 193, edges
16, and all 2,047 finite exponent bands with three mantissas and both signs
(12,282). These groups overlap; this is sampling, not an exhaustive proof.

The native oracle is Linux glibc 2.36 `std::sin`/`std::cos`, not Windows CRT or
macOS libm. The WASM oracle is the current actual emitted bundled kernel.
mpmath 1.3.0 evaluated exact binary64 inputs at 400 and 600 decimal digits;
both evaluations round to identical binary64 references for every finite input.
This agreement is a strong numerical reference, not a formal rounding proof.

| Finite sample gate | Native sine | WASM sine | Native cosine | WASM cosine |
| --- | ---: | ---: | ---: | ---: |
| README correctly rounded /101 | 101 | 71 | 101 | 68 |
| All correctly rounded /12,790 | 12,780 | 10,502 | 12,782 | 10,551 |
| Maximum absolute error | 5.562e-17 | 1.669e-16 | 5.551e-17 | 1.627e-16 |
| Exponent-band maximum binary64 step distance | 1 | 4,083 | 1 | 3,405 |

Native/WASM binary results differ at 30 README sine samples, although only three
differences survive the current vector stdout formatting. All original 1e-12
assertions pass. Near zeros, absolute tolerance masks significant relative loss:
at binary64 `-pi/2`, native/reference cosine is `6.123233995736766e-17`, but WASM
returns `-0`. Native/reference sine at binary64 `-2*pi` is
`2.4492935982947064e-16`; WASM returns `1.743934249004316e-16`.
Signed sine zero is retained; the tested NaN/infinity inputs return NaNs on both.
Binary64 step distance is an ordered-bit metric, not a uniform absolute unit;
near-zero distances are very large and are preserved in the JSON receipt.

Do **not** make today's emitted kernel the native standard merely to get equal
output: it measurably loses accuracy relative to the tested native baseline.

## Affected consumers and boundaries

- `vkf_x64_runner_template.cpp:77` runtime sine/cosine wrappers: Windows CRT
  or host `std` library. `vkf_x64_artifact.cpp:13751` tuning/JIT runtime table
  separately selects host math and must not remain a divergent path.
- `vkf_pe_writer.hpp:183` imports `sin`/`cos` directly from MSVCRT and installs
  their runtime entries. Changing only the C++ runner does not fix standalone PE.
- `vkf_x64_artifact.cpp:11853` and `vkf_arm64_encoder.hpp:2440` dispatch machine
  math opcodes through runtime slots. Their calling convention must stay stable.
- `vkf_machine_ir_lowering.hpp` selects these opcodes for builtins, imported
  math, vector lifting and complex exp/sin/cos components. No syntax change is
  needed; downstream values nevertheless change when the numeric kernel changes.
- `vkf_wasm_bytecode_lowering.hpp` and `vkf_wasm_vm_emitter.hpp` dispatch to
  `vkf_wasm_math_kernels.hpp` (integer range reduction and Taylor/Horner emitter).
  The current header emits WASM bytes; it is not a callable native kernel.
- Native constant/retained numeric evaluators also call system math:
  `vkf_compiler_artifact_smoke.cpp:1630`, `vkf_retained_scene_packet.hpp:257`,
  `vkf_wasm_artifact_smoke.cpp:889`, `vkf_webgpu_artifact_smoke.cpp:951`.
  They must share the chosen VKF numeric policy when evaluating VKF expressions.
- Transitive stdlib clients include math tan/sec/cot/csc and gamma, linalg,
  physics rotations, random normal sampling, symbolic numerical evaluation and
  transforms. Random/geometry hashes may change; no acceptance hash may be
  silently replaced. Symbolic AST constructors are not numerical consumers.
- Host presentation rotation/orbit calculations (`vkf_native_scene_artifact_stager.cpp`,
  `vkf_webgpu_artifact_smoke.cpp`, `vkf_wasm_artifact_smoke.cpp`) and generated
  GPU shader trigonometry are separate float/GPU domains. Do not silently route
  them through a binary64 language-kernel change or claim GPU bit parity.
  The pre-gen lane's float forest identity discrepancy is separately unresolved.
- Audit covers `sin`/`cos`, not proof for exp/log/pow/atan2 or every platform.

## Accepted direction (implementation gates unchanged)

Approve a **versioned deterministic binary64 sin/cos policy**, implemented from
one portable compiler-owned kernel source for native and WASM, with explicit
acknowledgment that last-bit native results and derived outputs can change.
Recommended route: first establish a better-accuracy candidate with high-precision
and edge-case evidence; do not bless the existing Taylor emitter unchanged.
Pin source/license hash, kernel version and strict evaluation flags in build
evidence. Version is a build/runtime identity, not a new public manifest field
unless separately approved. No host fallback or mixed platform selection.

The approved RED packets must prove: same binary results native/WASM for the
chosen source and evaluation rules; current exact stdout test GREEN without
normalization; signed-zero/nonfinite behavior; existing accuracy gates unchanged;
native 451/451 and full unchanged WASM suite; direct PE and ARM64/runtime coverage;
unchanged ABI/diagnostics; reviewed downstream deterministic identities. A new
accuracy requirement must be explicitly approved, not invented by this audit.

Rejected alternative: retain native system math and keep exact cross-platform math parity
blocked. Bundling one platform libm algorithm into WASM alone cannot guarantee
matching every other native OS. No runtime switch or tolerance relaxation has
been made yet; candidate evidence precedes the production switch.

## Reproduce

Repository mounted at `/src`, Node 22/g++ container:

```sh
node --test tests/bootstrap/wasm-math-kernels.test.mjs
node tools/audit-shared-trigonometry.mjs
```

Disposable Python container with `mpmath==1.3.0`:

```sh
python3 tools/audit-shared-trigonometry.py
```

The scripts are audit-only, never imported by the runner. Raw observations and
summary go under `build`; durable receipt:
`docs/evidence/shared-trigonometry-audit-2026-09-05.json`. It records harness,
kernel/artifact hashes, libc identity, inputs, reference precision and extrema.
No production compiler source/artifact changed; no commit, push or deployment.
