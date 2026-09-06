# Private compiler string-record Machine IR

Baseline: bootstrap `00e9358adb050d7348e188a7f1bae26ef63b1bc9`.
This packet advances the existing private source/parser/type/Machine-IR path
through one additional real compiler function:

```vkf
artifact_result(manifest_path:str, artifact_path:str, status:str):
    (manifest_path: manifest_path, artifact_path: artifact_path, status: status)
```

It proves structural native MachineFunction parity only. No emitted Machine IR
or native comparison executable is executed. String cloning x64 bytes, module
composition, artifact production, source-responsive compiler rebuilding, and
self-hosting remain later gates.

## RED to GREEN

The native lexer/parser/type/MIR path accepts this unchanged function. The
private record producer initially stopped at token index 4, the first scalar
`str` type, and returned `false`, empty opcodes, empty operands, max stack 0:
**0/1**, 9304.0895 ms total.

The private declaration-shape parser now retains either an existing bracketed
vector type or one scalar identifier type. Typed facts distinguish a borrowed
scalar-string parameter from a vector parameter. Owned-result lowering maps a
borrowed string load to its two native cells, then appends the existing native
`CloneString` opcode. Record assembly counts result cells rather than fields.

The first implementation compile exposed the existing VKF rule that a binding
declared inside this branch was unavailable to its later loop:
`unknown binding prior`. Moving the two scratch declarations to function scope
changed no compiler behavior or diagnostic.

Final native parity for `artifact_result` is exact:

- parameters and locals are `manifest_path.0/.1`, `artifact_path.0/.1`, and
  `status.0/.1` in source order;
- instructions are three repetitions of `load_local`, `load_local`,
  `clone_string`, followed by `return_values result_count:6`;
- all local classes are `f64`, all parameter numeric-scalar flags are false,
  max stack is 6, and owner/error/result metadata is unchanged.

Focused parser/type/MIR gates passed **5/5**, exit 0, 10718.7734 ms. Tests also
cover scalar type spans and native typed-load parity; existing vector cases and
first-error malformed cases remain unchanged.

## Regression and identity

The unchanged serial checkpoint passed **26/26**, exit 0, 85989.3316 ms. Full
bundle was 11888.1648 ms; locked graph fixed point was 8623.3728 ms. Separate
unchanged full-bundle repeat passed **1/1**, exit 0, 12203.0247 ms total
(12072.1747 ms test). Timings are receipts, not performance claims.

Fresh public browser generation is byte-identical to the untouched archived
baseline. No private helper is exported. No public syntax, semantic rule, API,
schema, ABI, diagnostic, timeout, optimizer policy, fallback, or assertion
changed.

| Identity | SHA-256 |
| --- | --- |
| Compiler source, canonical LF | `b73a8fe87c24ada0c64a03fb51e09b533a79faf2877de039656acc7d697451aa` |
| Machine source, canonical LF | `71cf01d18a6c7086d6cb5c630a0aeb0ea533a45eab1a708b3018e2c15b060a84` |
| Parser source, canonical LF | `fd7c9538df30f1dfb9093357a410fc45d35d8bbf952c8231decba2d54c148102` |
| Typed source, canonical LF | `60611ace34f6983e9f630e555fd208eb52645eed29f2a2e1d7ff4a0a5971e940` |
| Bootstrap manifest, canonical LF | `339bcf75e08dbee0a0244f061b42b54669cd146476a5d82d8fbb109d18dec3ff` |
| Ordered bundle | `8256bc09fb3aedaa1093a8bc0cfbe5a385b551af69e8cf27baebf93facc9ba8f` |
| Record-MIR test, canonical LF | `85e503877e0fea6ff0422b495a46f4c75ca639021b84076d5a748af39291dd91` |
| Type test, canonical LF | `9646c3c7678d54c79f3c261b76a20fd8046270f76eb42515553563c271d496a1` |
| Shape test, canonical LF | `b30236e4dd7553549f0b46f9710a9c8f7b8fc60fab602aa8d875981adf225396` |
| Identical regenerated WASM | `2bb78c97eb9ac347922b69edd4e1808c83597ffb7094c1b7ea9c1da9e028e817` |
| Identical regenerated manifest | `c342e0e1b1500b8d55d7b86e63cdb8f4ef8031257c789cb2416edbec25f6cc41` |

Next bounded RED: exact whole-function Windows-x64 bytes for this same real
`artifact_result`, auditing native `CloneString` ownership, signed borrowed
length decoding, slot-8 allocation, slot-10 abort branches, byte copy, and
relative fixups. The frozen compiler still self-copies; source-responsive
successor generation, generated-compiler execution, deterministic compiler
fixed point, and exact I240 seed remain missing. ADR-0005 remains 60%.
