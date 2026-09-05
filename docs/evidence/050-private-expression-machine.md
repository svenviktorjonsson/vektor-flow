# Private scalar Machine IR fragments

Base: bootstrap `26ac03a5cf36e631de3efee461d0302c6098cc47`.
New private helpers lower validated expression/type facts to scalar instruction
fragments: numeric literals, borrowed vector parameter loads for `length()`,
grouping, and runtime numeric addition. They retain native instruction order,
parameter slots, element stride, ownership flags, and maximum stack depth.
Private opcode columns are not new public Machine IR opcodes or a schema.

This is structural lowering, not execution, encoding/linking, a whole function
or module compiler, or a source-responsive successor. The input must come from
the private parser/type stages; it is not an arbitrary source/tape validator.
Only the inspected scalar vector elements `num`, `int`, `bit`, and `str` have
stride mappings; other element types return a private unsupported result.

## Native baseline first

The actual record-return shape was compiled with `vkf-strict`, `--diagnostics`,
and `--optimizer-policy mask-0`; diagnostics confirmed `ran:false` and
`artifact_fallback:false`. Its artifact was not executed:

```vkf
probe(items:[str]):
    (original:items, count:items.length()+1)
result: probe(["a", "b"])
:: result.count
```

Native function instructions:

```text
load_local 0
clone_f64_list
load_local 0
count_f64_list owns_input:false
push_f64 2
divide_f64
push_f64 1
add_f64
return_values result_count:2
```

The returned vector's clone is distinct from the borrowed length receiver.
Native length counts scalar storage cells; `[str]` divides by two because
each element occupies two cells. The inspected C++ path is
`vkf_machine_ir_lowering.hpp::lower_expression`, the `length` call branch:
it emits `CountF64List`, preserves `owns_input`, and divides by
`source_layout.dynamic_element->width` when greater than one. No guessed
pointer/count representation or alternative renderer/runtime was introduced.

## RED to GREEN

The runtime-input harness invokes the real VKF parser, type-fact stage, and
private lowering function. Native scalar-return wrappers isolate the same
expression for exact instruction and `max_stack` comparison. Native oracle
artifacts are compiled but never executed; the harness executes only the
compiler stages that construct/print the fragment. JavaScript serializes the
fragment to canonical instruction objects; it does not evaluate VKF or MIR.

- Missing lowering entrypoint: 0/1, 2645.2271 ms; native compilation reported
  `direct x64 backend unsupported: machine IR supports direct calls only`.
- Literal lowering: GREEN 1/1, 3240.8932 ms. The oracle wrapper makes its
  function reachable; an unused native function had correctly been pruned.
- Addition: private lowering first rejected PLUS token 14 (3063.5276 ms).
- A constant-only attempt then exposed the independent folding boundary
  below (3155.9918 ms); exact instruction comparison was retained.
- Runtime vector-length/addition instead rejected receiver token 13
  (3562.3405 ms); the general borrowed-length path made it GREEN.

Final tests cover literals, chained and grouped runtime addition, repeated
length receivers, `[num]`/`[bit]` one-cell elements, `[str]` two-cell elements,
whitespace in vector types, alternate parameter slots, and grouped member
calls. Every supported fragment plus native `return_f64` equals the native
function's entire instruction list; stack depth also matches exactly.

## Explicit unsupported boundaries

Native `mask-0` lowers `2.5+1+4` to `push_f64 7.5; return_f64`. An unfused
private push/add stream therefore failed the exact baseline comparison.
With root approval, constant-only addition remains unsupported in this
structural packet. The enabled test locks the native folded instruction list
and requires private rejection; it does not count folding as implemented.
Future work must implement the established general folding rule, not recognize
this expression or weaken native comparison.

Returning a vector has a separate ownership requirement: native emits
`load_local 0; clone_f64_list; return_f64`. The scalar-only fragment entry
rejects that result type. The enabled negative test locks both the native
clone and the private rejection. Whole-record return assembly remains a next
producer boundary; borrowed receiver loads cannot substitute for owned returns.

## Regression and public byte proof

Full unchanged-adjacent checkpoint plus the new MIR test: **22/22**, exit 0,
50704.2733 ms. Full executable bundle: 11298.0379 ms; locked source-graph
materialization: 7682.8904 ms. These are receipts, not performance claims.
No assertion, deadline, acceptance gate, or tolerance changed.
A second unchanged full-bundle run passed **1/1**, 10617.5762 ms total
(10537.7222 ms in the test).

Run the full command/environment in `050-private-expression-types.md` with
`tests/bootstrap/stage1-private-expression-machine.test.mjs` added. All
outputs stay under this checkout's ignored `build` directory.

Every pre-existing Machine IR helper body is unchanged. The source lock changes
only the canonical Machine IR source hash and ordered bundle hash (I94 recipe).
No public syntax, ABI, diagnostic, native header, or shipped artifact changes.

```powershell
node tools/build-browser-compiler.mjs --output build/private-parser-visibility/machine-output
```

Using the identical native tools and untouched archive recorded in
`050-private-record-function-shape.md`, both regenerated files compare exactly
with `build/private-parser-visibility/baseline-output`. The manifest contains
no private helper names. This is regenerated baseline/current identity, not
a comparison to older shipped files; nothing was deployed from this branch.

| Identity | SHA-256 |
| --- | --- |
| Machine IR source, canonical LF | `2b0778adad38cea4064aa894b68293500d88cf4e796112b5879b328e9a30691a` |
| Bootstrap manifest, canonical LF | `81520d06d5852b46309b833b1a752de2e7a07104f9a85db19d76be54902a303f` |
| Focused test, canonical LF | `f05d4c0bd502de0547f569d9582b5866c196aad514569dba749a96905320f479` |
| Ordered bundle | `59194b8c634dbb9be431b6192e7ca71c76d5f626fcaf397b2deda185569362f2` |
| Identical regenerated WASM | `2bb78c97eb9ac347922b69edd4e1808c83597ffb7094c1b7ea9c1da9e028e817` |
| Identical regenerated manifest | `c342e0e1b1500b8d55d7b86e63cdb8f4ef8031257c789cb2416edbec25f6cc41` |

The source-response audit remains RED: existing stage production self-copies.
The exact I240 seed remains missing; no substitution or percentage promotion
is made. Exponent/helper/diagnostic decisions and `[str]` runtime value/display
transport remain separate open boundaries; structural MIR is not their proof.
