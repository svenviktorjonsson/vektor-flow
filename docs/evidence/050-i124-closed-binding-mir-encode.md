# 050-I124 closed binding Machine-IR encoding evidence

## Scope

- Base: `b3241d4c`
- RED: `ac2461cc`
- GREEN: `ee59ba23`
- Branch: `codex/0.5/050-i124-closed-mir-encode`

I124 takes the existing VKF source `value: 31` followed by `value + 1`
through the unbounded lexer, parser, typed-IR, and Machine-IR handoffs. The
known binding replaces the expression load, producing the closed stack program
`push_f64 31`, `push_f64 1`, `add_f64`, `return_f64`. Self-hosted validation
accepts maximum stack depth two before the program is assembled into the
existing version-4 `MachineModule` field layout with a zero-parameter entry.

A private Stage component consumes the exact validated observation and passes
the reconstructed module to the existing x64 Machine-IR encoder. The emitted
executable prints `32`. Numeric leaves remain general finite values; only the
existing opcodes and closed module shape are fixed by this tracer.

This changes no public VKF syntax, API, diagnostic, opcode, Machine-IR schema,
or ABI.

## TDD evidence

The RED probe first failed before a closed lowering existed, then reached the
intended boundary and was rejected as an unknown private Stage component. The
GREEN probe compiled and executed the full source-owned path and observed:

```text
vektorflow.machine_ir
4
f64
1
$entry
2
push_f64
31
push_f64
1
add_f64
return_f64
```

Final verification used the isolated I124 compiler and hidden child processes:

- source graph, closed encoder, and all established Machine-IR pipeline
  dispatch tests: 12/12 passed in 24.86 s;
- full dependent tagged lexer/parser/typed-IR/Machine-IR chain: 19/19 passed
  in 16.36 s;
- encoded closed artifact: exit 0, stdout `32`;
- no performance workload or shared benchmark root was used.

During minimization, empty fixed-vector fields exposed a pre-existing direct
backend layout limitation. I124 avoids weakening that backend: the public v4
empty fields remain in the assembled module, while the private encoder bridge
observes only the executable structural leaves it needs.

## Deliberate boundary

The tracer closes one binding and one later addition. Multiple bindings,
longer expression chains, general operator selection, broad grammar/type
lowering, the compiler fixed point, stdlib ownership, and toolchain-free
rebuild remain open.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106 -> I107 -> I108 -> I109 -> I110
-> I111 -> I112 -> I113 -> I114 -> I115 -> I116 -> I117 -> I118 -> I119
-> I120 -> I121 -> I122 -> I123 -> I124. I124 commits are `ac2461cc`,
`ee59ba23`, then this evidence commit. Do not merge or reset the original dirty
I84 worktree.

## Contract hashes

Source hashes use canonical LF bytes where stated.

- canonical `machine_ir.vkf`:
  `302A744D30FDB0E92E272D1261A929C40438182E4CA21C33ED83C6ED160EA003`
- bootstrap bundle identity:
  `02A43360F5C79BD1DF3E26D8EE9FF5864CC92B5010D327CD962F62EF9C0B869A`
- bootstrap manifest file:
  `9C62B7EF5300112F2D7BE76673DE02706A20FE95EFCE2967B52AE6C5FC94DF78`
- private Stage bridge source:
  `1CB4B76052A835400AA7E46C8C5862F305A8C6CE2D8A578946927241DF9DAE00`
- closed-binding acceptance test:
  `0A812099016EF9B35BA699DD7620461EEC151CD33D0899F80D23723F56E36810`
- isolated I124 `vkf-strict.exe`:
  `97E1B3B5E4118D63D191DDD40DD4856EBF845E444EFDA058EE1C8F2A326F7169`

## Acceptance-gate impact

The count-independent Stage-1 tracer now reaches executable encoding for a
closed source binding and later expression, rather than stopping at typed IR or
a parameterized MachineModule envelope. Against release acceptance gates, 0.5
is estimated at **56.5% total**, **+1.2 percentage points** from the last 55.3%
estimate. This reflects an executable vertical slice, not raw test count.
