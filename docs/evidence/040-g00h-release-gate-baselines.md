# 0.4.0 G00H JS release-gate baselines

- Recorded: 2026-08-31T10:46:50+02:00
- Base: `594be672912e223ee6c0a3fc452f81f46886feb1`
- Branch: `codex/0.4/040-g00h-release-gate-baselines`
- Implementation commits:
  - `cbb03b1dbce7a00a76e9dc60225a3af5528b41a1` — tolerate checkout line endings in generated-catalog parity
  - `c4a78873be990a94147b58f7bfedd4a74c4e2734` — retain established symbolic equality definitions
  - `1c7e93052d66fd9c51ca955cd55ea01859d1fd17` — generator-produced symbolic kernel artifacts
- Implementation tree: `1bb39899282b7c7cf26d10653f590edee80a6c02`

## Independent RED reproductions and classification

1. `node tests/js/vf-html-component-catalog-generated.test.cjs`
   failed generated parity on a Windows CRLF checkout. Running the catalog
   generator produced no Git content change, and both generated output blobs
   already matched `HEAD`. Classification: generator check portability defect,
   not a stale catalog. The check now normalizes checkout line endings before
   comparison; generated files were not hand-edited.
2. `node --test tests/js/vf-symbolic-document.test.mjs`
   reported `-8` instead of `8` for a named symbolic definition.
3. `node --test tests/js/vf-symbolic-literal-geometry.test.mjs`
   reported `[-5,-624]` instead of `[-5,625]` for named geometry.

The symbolic artifact was initially stale, but regenerating it alone left both
behavioral failures RED. Kernel probing showed `f(x)=x^2` and `p=4` being
classified as implicit relations instead of established definitions. The
source repair makes the approved definition branch return explicitly; it adds
no public syntax, semantic, API, schema, ABI, or compatibility contract.

## GREEN evidence

- HTML generated parity: pass.
- Symbolic document: 18/18 pass.
- Symbolic literal geometry: 22/22 pass.
- `npm run check:symbolic-kernel`: pass.
- Two consecutive `npm run build:symbolic-kernel` runs produced identical
  artifact hashes.
- Full `npm test`: 387/387 pass, 0 fail (about 19.94 seconds).
- `git diff --check`: pass.

## Reproducible hashes

| File | Git blob | SHA-256 |
| --- | --- | --- |
| `tools/generate-html-component-catalog.mjs` | `980e626efef46f4d6709a18f8cb3d64ff9301d5f` | `31918cce80d9e3bf5272f8c107c7c0729b3aaaf077a5cc3f6a16800a61a07d91` |
| `compiler/self_hosted/symbolic_expression.vkf` | `afc927e812702c0b2755b3dad899d7e9ec4ad6a1` | `880fbbcd5658eb63c021032a71c2b255f009c32ebf67bdfdf4db8e3b8bb8e1f8` |
| `web/vf-ui/artifacts/vkf-symbolic-kernel.json` | `2bec3984e3c88cc11469cfb32be6a591521bf051` | `159cde98e88c43f9073823bbb0cd14c388470d814fb5f6fba1b4ca228f3e70fb` |
| `web/vf-ui/artifacts/vkf-symbolic-kernel.wasm` | `f0107493e70aad32dfe0ae46e25150d3c2d1187f` | `f9d35377d75beb10675c69cd5958ed5322fbaed2ce03d6a9c398e682426ceac6` |

## Scope

Only the three persistent JS release-gate failures were repaired. No renderer
wiring, public VKF contract, or unrelated generated output changed.
