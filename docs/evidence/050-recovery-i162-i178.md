# 050 recovery: I162-I178 dependency closure

## Scope

- Integration base: `9c4518ad3108a5073923b177c2ccaf7e572bfa73`
- Last independently green packet: `563bd6fe810417496e31c796e3077bb2d0ad3c01`
- Failed consumer packet: `203609e4d858529db1e077fa80e53659533f5d27`
- Original implementer worktree:
  `.worktrees/0.5/050-i142-machine-function-list-layout`

The I179 commit recorded an explicit dependency on an uncommitted I178 GREEN
contract. Its Git parent was I161, so five canonical self-hosted sources, the
native observation adapter, and the I162-I178 tests and evidence were absent
from the packet history. The I179 source-graph test therefore rejected the
checkout before compilation.

This recovery packet copies only the preserved I162-I178 files from the
original implementer worktree. The 17 individual commit boundaries cannot be
reconstructed from that cumulative working tree, so the dependency is closed
as one explicit recovery commit. No public syntax, API, diagnostic, schema, or
ABI changes.

## Provenance and contract hashes

The existing I179 manifest was not weakened. Canonical LF-normalized source
bytes were matched against its recorded SHA-256 values before testing:

- `lexer.vkf`:
  `e66f475ddfbdf81c7351d4a91a962ecc56b3e61d5364cabde1ab742b17219804`
- `parser.vkf`:
  `4fbf976beb3eed74313b84f91fba6f21706ea3cf3cd8a823db472c8e502446a0`
- `typed_ir.vkf`:
  `023cb953aa3e5868f8a0e2858a5d88a6b6770d2cd401b240da9804a69ddab19d`
- `machine_ir.vkf`:
  `0e9bc6a39b34b7cb8be2afdfe1d38498905422cdd740b5933a1f2790fc124fa3`
- `machine_ir_validation.vkf`:
  `c906dd1822ec990e426c7eb9204d56b6f2aea01ff262af780bb78ed9cd174cc`
- manifest canonical bytes:
  `3b9db65d60ea6f7aee43830c0c7b0a4315a9297cbb13c7ba0a003fd47c4807d4`
- recovered native adapter canonical bytes:
  `ae646173e28f836b93ce5c5a0d2df63da44eebfe48ce7f85fe9dbbd41d51efe3`
- fresh MSVC Release `vkf-strict.exe`:
  `97AFD27A91B576633465DBB152DC63C04A4750355BFDBCA93C660C9D6264418C`

## Independent verification

All processes were hidden. The repository was accessed through a short drive
alias to avoid the already-documented Windows path-length limitation. The
compiler was rebuilt with MSVC Release, `/bigobj`, and a 64 MiB stack.

The 17 recovered I162-I178 tests plus the previously failing I179 fixed-point
test ran with bounded concurrency two:

```powershell
node --test --test-concurrency=2 <I162-I179 test files>
```

Result: 18 passed, 0 failed in 174.60 seconds. The I179 test now confirms that
Stage 2 owns the output and Stage 2/Stage 3 artifacts are byte-identical.
`git diff --check` passed with only the repository's existing line-ending
warnings.

## Recovery boundary

Generated build output remains untracked and is excluded from the commit.
Integration resumes from I180 only after this recovery commit is recorded.
