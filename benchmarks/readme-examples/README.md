# Documented-program release proof

This is the latest-release output-stability gate. It discovers every generated VKF
program under `examples/generated/readme`, then records for each program:

- 10 native compiles from fresh source paths;
- 10 complete executable launches;
- exact stdout and stderr as UTF-8, Base64, byte count, and SHA-256;
- exit code and byte-for-byte output stability across all verification rounds;
- source/compiler hashes and exact host conditions.

Elapsed samples remain in the machine-readable report for diagnostics, but
0.2.1 makes no per-example timing claim from them.

```bash
node benchmarks/readme-examples/run.mjs \
  --compiler=build/native-compiler/bin/vkf-strict \
  --compile-runs=10 \
  --compile-warmups=0 \
  --runs=10 \
  --warmups=0 \
  --output=local
```

On Windows, use
`--compiler=build/native-compiler-clang/bin/vkf-strict.exe`.

The JSON report remains the machine-verifiable source for all individual
samples. `embed-readme-evidence.mjs` refuses mismatched versions or source
hashes before placing exact output in the landing README or complete language
guide. Per-example timing tables stay out of those documents.
