# 050-I122 validated MachineModule assembly evidence

## Scope

- Base: `03b0dc8`
- RED: `a6f541a`
- GREEN: `638f992`
- Branch: `codex/0.5/050-i122-validated-machine-module`

I122 assembles one demanded and already validated dynamic statement into the
existing private `MachineFunction` and public version-4 `MachineModule` field
layout. The selected identifier becomes the function name and one numeric
parameter supplies local 0. The validated maximum stack is retained verbatim.

The module uses the existing schema, version, output fields, entry function,
and functions collection. It changes no public VKF syntax, API, diagnostic,
opcode, Machine-IR schema, or ABI.

## TDD evidence

The RED probe failed because validated tagged statements had no assembly
operation. The GREEN probe selected statement 32 only after self-hosted stack
validation and produced:

```text
vektorflow.machine_ir
4
none
value31
1
num
2
load_local
32
add_f64
return_f64
0
```

Final evidence using the fresh I115 ownership-correct compiler:

- source graph, ownership, dynamic lowering/validation, and assembly: 7/7
  passed in 22.11 s;
- established typed-module producer and stack-validation suites: 12/12 passed
  in 54.64 s;
- direct strict compile of `machine_ir.vkf`: exit 0 in 4597 ms;
- direct execution of the emitted Machine-IR artifact: exit 0.

All child processes remained hidden and no performance workload ran.

## Deliberate boundary

The assembled module is a parameterized private envelope with `output_kind`
`none`; it is intentionally not sent to the executable encoder. Encoding needs
a resolved source binding or call-site value for its identifier first. This
avoids inventing a zero/default value and preserves source semantics.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106 -> I107 -> I108 -> I109 -> I110
-> I111 -> I112 -> I113 -> I114 -> I115 -> I116 -> I117 -> I118 -> I119
-> I120 -> I121 -> I122. I122 commits are `a6f541a`, `638f992`, then this
evidence commit. Do not merge or reset the original dirty I84 worktree.

## Contract hashes

Source hashes use canonical LF bytes where stated.

- canonical `machine_ir.vkf`:
  `EBECCA1F4984ABF00931ACF274D865866E203A574B433E7B14020EF0FFF18F74`
- bootstrap bundle identity:
  `30A7630E30A371CE802FC34B7B39B780E6792EB218A131FDDF3274BF5A67E493`
- bootstrap manifest file:
  `79778286A007894BDF09E5CDF0930701145A6DF02B81935311526A9152C64D5B`
- validated-module acceptance test:
  `4D1D90CC8A8F579FA8F30CE88DAF9A632DD49C8832D33D5FB7CC59FBA19EE942`
- fresh I115 `vkf-strict.exe`:
  `19A8697696D4E377082634AE86681D610199C188825A9043028EB3073CBB7A3D`
- directly emitted I122 Machine-IR artifact:
  `A24620E2F7D4257BA922B6C7FFBBE9D9C32B0502671964EE1D25F2AE86E40B14`

## Acceptance-gate impact

The arbitrary Stage-1 tracer now reaches a validated, schema-compatible
MachineModule envelope without fixed statement aliases. Identifier binding,
executable encoding, broader grammar/type lowering, the compiler fixed point,
stdlib ownership, and toolchain-free rebuild remain open.
