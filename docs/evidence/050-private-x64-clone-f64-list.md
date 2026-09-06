# Private x64 borrowed-list clone bytes

Baseline: bootstrap `d212bda18f82d29c67e46217485ecaac7c904e2c`.
The private source-to-MIR x64 encoder now owns the existing native
`CloneF64List` sequence needed by the locked graph producer's vector-valued
record result. Whole-function Windows-x64 bytes match the native emitter.
Neither emitted arrays nor native comparison executables are executed. This is
not a runtime, executable-container, compiler-successor, or self-hosting gate.

## Native ownership and runtime boundary

The audited native sequence in `vkf_x64_artifact.cpp` is stack-neutral and
turns one borrowed dynamic-list pointer into one fresh owned pointer. It:

- rejects a null borrowed source through target-neutral runtime slot 10
  (`abort`);
- calculates the allocation as `length * 8 + 16`, passes it using the platform
  pointer-argument register, and calls runtime slot 8 (`malloc`);
- rejects a null allocation through slot 10;
- copies the two-word list header and every eight-byte element; and
- replaces the stack cell with the fresh allocation before `ReturnValues`
  transfers ownership to the caller.

The private encoder records borrowed-list and owned-list cells separately.
Only an owned list may escape in a multi-value result. Missing stack values,
nonzero metadata operands, scalar clones, repeated clones, list arithmetic,
and uncloned borrowed returns reject atomically with `valid:false, bytes:[]`.
No runtime slot, public ABI, public schema, diagnostic, or fallback is added.

The new private rel32 helper patches the two forward success branches and the
empty-list branch after their targets are known, plus the backward copy-loop
branch. This mirrors native `patch_rel32`; offsets are derived from emitted byte
positions rather than frozen constants.

## RED to GREEN

The RED used the existing locked producer body:

```vkf
_compile_locked_valid_source_graph(sources:[str]):
    (sources:sources, source_count:sources.length())
```

Native strict compilation reported `artifact_fallback:false` and `ran:false`.
Private parsing and MIR construction succeeded, while the x64 encoder rejected
opcode 6 with `true`, `false`, `[]`: **0/1**, 10736.2389 ms total.

After exact clone/runtime/fixup encoding, the focused gate passed **1/1** in
14784.7463 ms. Binding the case directly to the repository's current producer
and adding six malformed ownership shapes passed **1/1** in 15121.6697 ms.
Focused plus canonical source graph passed **3/3** in 14683.0581 ms.

## Regression and identity

The unchanged serial checkpoint passed **26/26**, exit 0, 99800.3704 ms.
Its full bundle was 15092.7785 ms and locked source-graph fixed point was
9030.6964 ms. A separate unchanged full-bundle run passed **1/1**, exit 0,
12078.2491 ms total (11998.1113 ms test). Timings are receipts, not performance
claims. No timeout, tolerance, assertion, optimizer tier, or gate was relaxed.

An earlier serial invocation without the established binary-root environment
completed **20/26**; all six failures were `ENOENT` for prerequisite tools under
absent default `build/050-b00` or `build/050-i95` directories. The full command
then ran once with the existing `build/native-windows/bin` tool root and passed.

Canonical I94 lock refresh changes only machine-source and ordered-bundle
hashes. Machine source from `# Private scalar expression fragment` onward is
byte-identical to the baseline. Fresh public browser generation matches the
untouched archived baseline byte-for-byte; no private helper is exported.

| Identity | SHA-256 |
| --- | --- |
| Machine source, canonical LF | `be3d2db402dd25505d4e130135750c4a5871d4da5e9917afeb79038cdbb8ec97` |
| Bootstrap manifest, canonical LF | `1337f9cb255452e00c12790db4844492809a576f152aa4a906959374ab604938` |
| Ordered bundle | `9a7c5fbc8ecc9d658194faf0b4e509416b64240e22cb852a73fbe10be4ab5fe9` |
| Focused test, canonical LF | `bb4e2dd7f264299251c6c2ef42de42ca4ced7c1bd07180342495cdb45b513268` |
| Identical regenerated WASM | `2bb78c97eb9ac347922b69edd4e1808c83597ffb7094c1b7ea9c1da9e028e817` |
| Identical regenerated manifest | `c342e0e1b1500b8d55d7b86e63cdb8f4ef8031257c789cb2416edbec25f6cc41` |

Next: audit the next original locked-graph/compiler function boundary before
adding any further private opcode or runtime ownership composition. Eight-cell
AVX2 returns remain separate. The frozen bundle still self-copies, its
source-responsive successor gate remains RED, and the exact I240 seed remains
missing. ADR-0005 remains conservatively 60%; no percentage is promoted.
