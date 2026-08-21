# Standard-Library Direct-Machine Classification

Date: 2026-08-21

This is the migration contract required by ADR 0005. A standard-library
operation belongs to exactly one implementation class. `VKF source` means its
algorithm remains ordinary inspectable VKF. `Intrinsic` means the compiler owns
layout-sensitive primitive lowering. `Runtime ABI` means an OS/host capability
that cannot be expressed as a pure calculation. None may route through Python
or a generated C++ translation unit.

| Module | VKF source | Compiler intrinsic | Stable runtime ABI | Direct status |
| --- | --- | --- | --- | --- |
| `math` | constants; trigonometric, hyperbolic, inverse, logarithmic, gamma, and erf compositions | scalar/complex `abs`; complex elementary formulas; core structural-call lifting with scalar broadcast for multi-argument functions | real-scalar `sqrt`, `sin`, `cos`, `exp`, and `ln` | complete real-number namespace and compatibility-filtered structural lifting direct; complex `abs`, `sqrt`, `sin`, `cos`, `exp`, and `ln` direct |
| `stat` | min/max, percentile, median, mode, IQR, z-score, normalize, covariance, correlation, clamp, sign | fixed/dynamic numeric `sum`, `mean`, `range`, population/sample `variance` and `std`, count; result-shape preservation | none | complete deterministic fixed-vector and dynamic-list namespace direct |
| `random` | explicit-state Park-Miller generator; uniform scaling; Box-Muller normal distribution | none | wall/monotonic clock only for optional non-reproducible seed construction | direct and seed-threaded; no hidden mutable state and no claim of cryptographic entropy |
| `collections` | constructor policy and persistent transformations | list/map/queue layout, indexing, update, ownership | none | numeric list construction/index/update/concat direct; statically named heterogeneous maps direct through typed-record layout; numeric FIFO queues direct; runtime-key maps and heterogeneous queues remain Stage 0 |
| `io` | UTF-8 text and string-backed byte-buffer policy | string ownership at the capability boundary | stdin, stdout, stderr, and files | print, line input, append, plus text/byte read/write direct on all three release targets; file failures propagate as typed errors; `read_numbers` and alternate encodings remain Stage 0 |
| `errors` | domain error constructors | all public type masks, propagation, catch ranking, unwind | process abort for uncaught errors | every public error type value, explicit construction, propagation, catch selection, owned-message lifetime, and file-error translation direct |
| `system` | stable host-fact records and optional environment lookup | result shaping | OS name, architecture, CPU count, current directory, environment | direct on all three release targets |
| `process` | exact argument-vector and explicit-shell policy | owned result shaping | spawn/exec, wait, captured stdout/stderr | synchronous `run` and explicit `shell` direct on all three release targets; options remain under implementation |
| `physics` | collision, contact, material, rigid-body mass, inertia, and momentum algorithms | numeric vector/matrix primitives only | none | rigid smoke slices execute directly on Windows/Linux x64 and emit macOS ARM64; `rigid_body` is a compatibility import only |
| `regex` | result shaping and compile-time pattern validation | search and capture extraction | none | direct native engine; advanced syntax remains under implementation |
| `events` | event decoding, specificity, state transitions | event match primitive | host event queue | Stage 0 |
| `time` | validation, portable formatting, and pure Gregorian UTC conversion | local calendar-parts record construction | wall/monotonic clock, sleep, and local-time conversion | direct on Windows x64, Linux x64, and macOS ARM64 emission |
| `screen` / `ui` | scene, widget, geometry, styling, packet construction | typed arena/buffer layout where required | window/input/GPU host seam | Stage 0 except existing WASM/WebGPU packet slices |

Rules:

1. Pure algorithms default to VKF source. Performance alone does not justify an
   intrinsic until a measured VKF implementation cannot meet its accepted gate.
2. Intrinsics operate on canonical typed layouts, never source-pattern matches.
3. Runtime ABI calls are versioned, target-mapped, and tested without Python.
4. Each promoted row needs pure VKF assertions, direct x64 execution, ARM64
   emission, Linux execution, ownership tests where applicable, and a 100-run
   no-regression result for unaffected benchmark code.
5. Stage 0 remains oracle only. It is not a hidden runtime dependency.

## Current promotion

Machine IR v12 includes `stat.variance` and `stat.std` with any non-negative
constant `ddof` smaller than the input count for numeric fixed vectors and
owned/borrowed dynamic numeric lists.
Backends use two passes: mean, then squared deviations, matching the established
stdlib oracle. Empty dynamic inputs fail instead of producing a silent NaN.
It also includes `stat.range` for fixed vectors and owned/borrowed
dynamic numeric lists. Backends compute maximum minus minimum in one pass;
empty dynamic inputs fail.

The remaining deterministic stat algorithms are linked from
`compiler/self_hosted/stdlib/stat.vkf`; they are ordinary VKF and do not add
runtime imports. They accept fixed numeric vectors and owned/borrowed dynamic
numeric lists. `normalize` and `zscore` preserve the input container shape.

Random generation is deliberately a separate module rather than hidden inside
deterministic statistics. `compiler/self_hosted/stdlib/random.vkf` threads the
generator seed explicitly through `next`, `uniform`, and `normal`, making runs
reproducible and concurrency-safe. `clock_seed` is only a convenience boundary
over the existing clocks; it is not an operating-system entropy or
cryptographic-randomness API.

The errors namespace is compiler-owned because its stable masks participate in
catch specificity and unwinding. All public error type values resolve without
Python. Named `collections.map` construction lowers to the ordinary typed-record
layout, including mixed metadata and persistent field extension; it does not
allocate a dynamic hash table when all keys are statically known.

Machine IR v18 provides byte-exact file reads and writes over the existing owned
string layout. `read_text`/`write_text` define UTF-8 policy while
`read_bytes`/`write_bytes` expose the same storage as an uninterpreted byte
buffer; Vektor Flow intentionally has no separate `bytes` primitive. Windows
x64 maps the capability to `_open`, `_read`, `_write`, `_lseek`, and `_close`;
Linux x64 uses direct kernel syscalls; macOS ARM64 maps to the corresponding
libSystem calls. File contents never pass through Python, generated C++, an
assembler, a compiler, or a linker. Missing files propagate as
`FileNotFoundError`; other file-operation failures propagate as `RuntimeError`
through the ordinary native error path.

Fixed aggregate calls specialize list, tuple, and record literals to the
callee's compatible projected shape. Unused metadata fields remain untouched,
sparse nested projections retain their source indices, and inferred result
shapes propagate through direct return-call chains. This keeps vectors and
3x3 matrices in the flattened aggregate ABI instead of accidentally mixing
heap-list and fixed-value representations.

## Math and time promotion

The real-number math namespace is source-owned. `tan`, reciprocal trig,
hyperbolic/inverse functions, logarithm variants, `gamma`, and `erf` live in
`compiler/self_hosted/stdlib/math.vkf`. Only five elementary scalar operations
cross the stable runtime boundary (`sqrt`, `sin`, `cos`, `exp`, and `ln`);
`abs` lowers directly to machine instructions. This removes the Python math
namespace and generated-C++ path from direct artifacts. Every public math
function recursively maps over fixed vectors, tuples, structs, and nested
combinations while preserving the exact structure. It uses the core structural
compatibility rule, so numeric fields are transformed and incompatible metadata
such as strings and bits is retained unchanged. Functions with multiple
arguments accept either matching structures or scalar values broadcast to
every compatible leaf.

The same intrinsic boundary implements the elementary complex-plane operations
`abs`, `sqrt`, `sin`, `cos`, `exp`, and `ln` directly in machine IR. The
composed inverse and special functions keep their documented real-domain
contracts; they are not silently reinterpreted as complex continuations.

The time namespace lives in `compiler/self_hosted/stdlib/time.vkf`. Formatting
and argument validation are VKF source. Machine IR v12 supplies four explicit
capabilities: monotonic seconds, epoch seconds, sleep, and local calendar
parts. Target writers map them directly to platform APIs:

- Windows x64: `QueryPerformanceCounter`, `QueryPerformanceFrequency`,
  `GetSystemTimePreciseAsFileTime`, `Sleep`, and `_localtime64_s`.
- Linux x64: `clock_gettime`, `nanosleep`, and `localtime_r`.
- macOS ARM64: `_clock_gettime`, `_nanosleep`, and `_localtime_r`.

No direct time artifact embeds or launches Python, generated C++, an assembler,
a compiler, or a linker. OS/C runtime calls are the versioned capability ABI,
not a language implementation dependency. Direct `current_time` currently
accepts the portable set `%Y`, `%m`, `%d`, `%H`, `%M`, `%S`, `%Y-%m-%d`,
`%Y/%m/%d`, `%H:%M`, `%H:%M:%S`, `%Y-%m-%d %H:%M:%S`, and RFC 3339 UTC
`%Y-%m-%dT%H:%M:%SZ`. Both `format_time` and `current_time` accept an explicit
`utc` flag. Arbitrary `strftime` programs remain an explicit unsupported
surface because portable output may not delegate formatting to a host library.
