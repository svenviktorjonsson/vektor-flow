# Ready for human: uncaught assertion text

Status: decision pending; no compiler/runtime change implemented.

## One decision

When an assertion stops a program, should its diagnostic show just the authored
message, or also identify the source location?

```vkf
false?! "input is empty"
```

- **A — Exact message (recommended for this packet).** Write `input is empty`
  followed by a newline to stderr. No new prefix or rewritten wording. Preserve
  the existing failure status and error ordering.
- **B — Message with source location.** Preserve `input is empty`, with the
  originating file/line/column. A follow-up must approve one exact rendering
  example before implementation; no format is assumed here.

Counterexample: `false?!` has the existing message `assertion failed`. Neither
choice invents a different default or prints later errors after execution stops.

Reply **choose A** or **choose B**. Caught errors keep their existing behavior.

## Why this is a decision, not a formatter reuse

The guide defines an assertion's optional expression as its error message and
defines `$.message` for caught errors. Native lowering preserves the literal
message, or `assertion failed` when omitted. It does not define an uncaught
stderr rendering format, and no existing formatter was found in the native
artifact path. The failure below therefore cannot be repaired by restoring a
known formatter without choosing new observable output.

`tools/audit-runtime-assertion-transport.mjs` records a runtime-input RED:
uncaught execution exits `3` with empty stdout and stderr for either input.
Catching the same function exposes `first assertion` for `bad` and
`second assertion` for `ok`, proving authored text and this source order survive
until the uncaught boundary. The audit detects missing message transport; it
does not freeze a formatting contract or count as bootstrap completion.

## Existing transport evidence

- `vkf_machine_ir_lowering.hpp` lowers assertions to `AssertTruthy` or
  `AssertTruthyString`, retaining message bytes/length and an error mask.
- `vkf_x64_artifact.cpp` propagates a callee error using `r8` for its message
  pointer, `xmm2` for length, and `r9` for its type mask. Existing handlers save
  those values and select the typed catch arm.
- An error reaching the entry instead calls `emit_abort()`, which invokes
  runtime slot `10`; no message is written. The PE writer binds that slot to
  CRT `abort`, and the ELF writer binds it to libc `abort`.
- `Instruction` has message/type fields but no runtime file/line/column field.
  Choice B therefore requires source-span transport, not a made-up driver span.
- The native driver's `<driver-smoke>:1:1:` exception wrapper describes its
  own failures. It is not the assertion's source location and must not be
  reused as though it were one.

No stdout print instruction, host shim, fallback evaluator, or altered exception
type has been added. The pending EQ-token decision is unrelated and untouched.
