# Trig WASM package prerequisite

Production is **not switched**. The native/WASM production tracer remains 0/2
RED at `7b2083dc`; the ten-site migration checklist remains mandatory.

## Verified

- Seven functions and their immutable tables come from the same eight committed
  candidate C sources, built with pinned Emscripten 4.0.14 and strict flags.
- Intermediate side-object dependencies are only memory, memory base and stack
  pointer. The compiler-owned appender relocates internal calls and globals;
  complete test modules bind all storage internally and have **zero imports**.
  No JavaScript math implementation, renderer or value transport was added.
- The generator rejects external function imports, unexpected globals, start
  functions, tables, data layouts, unsupported instructions and nonempty
  initialization. Its source/flag identity normalizes checkout line endings.
- All **12,793** frozen candidate inputs retain their exact sine/cosine results
  at both ordinary and shifted layouts (function prefix 130, global prefix 131,
  different data addresses). Signed zero uses exact comparison; nonfinite
  results preserve NaN behavior. The private stack is restored after each call.
- Private stack reserve is 65,536 bytes, matching the pinned Emscripten setting
  used by the standalone candidate. It is separate from the VKF value arena;
  this packet does not change the pending 1 MiB/64 MiB arena policy.

## Commands and results

With the repository mounted at `/src` in `emscripten/emsdk:4.0.14`:

```sh
node tools/build-trig-runtime-package.mjs
node tools/build-trig-runtime-package.mjs --check
```

Both succeed; `--check` reproduces the checked-in header exactly. The package
test uses the previously generated frozen candidate observations described in
`shared-trig-candidate-2026-09-05.md`, not newly rounded host expectations.

With Node 22 and g++:

```sh
node --test tests/bootstrap/shared-trig-package.test.mjs tests/bootstrap/shared-trig-candidate.test.mjs tests/bootstrap/wasm-math-kernels.test.mjs
```

**15/15, zero skips**: relocation prerequisite 1, candidate near-root gate 1,
unchanged existing production numeric kernel regressions 13. The latter still
test the old production selection; their GREEN is not production Math A parity.

## Identities and remaining work

- Canonical source/flags identity:
  `d217b9df46536437b850d41a4a9a71d8839984e797c1283bd20a9fa6a741e31d`.
- Intermediate package SHA-256:
  `bf72711fccb2c75dd4887359ba9b2028172775de4f2bd4693b6ac10e1da0ebe5`.
- Production shared compiler is unchanged at
  `ef5a91b822ebb5ccfbbf751331bec00beb73f45de874c880303447b84a5d2548`.

Next: native position-independent packages for ELF/PE/ARM64, coordinated
runtime/evaluator selection, then fresh native 451/451, exact sine stdout,
unchanged non-math and full WASM gates. No new native/full-suite or performance
claim is made by this isolated package proof.
