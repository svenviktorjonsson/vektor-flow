# README example release proof

This is the 0.1.1 release-performance gate. It discovers every generated VKF
program under `examples/generated/readme`, then records for each program:

- 100 native compiles from fresh source paths after one warmup;
- 100 complete executable launches after five warmups;
- every timing sample plus mean, median, minimum, maximum, p95, and deviation;
- exact stdout and stderr as UTF-8, Base64, byte count, and SHA-256;
- exit code and byte-for-byte output stability across all measured runs;
- source/compiler hashes and exact host conditions.

Runtime includes OS process startup and output capture. Compile time includes
the complete native frontend and executable emission but excludes startup of
the one persistent compiler process.

```bash
node benchmarks/readme-examples/run.mjs \
  --compiler=build/native-compiler/vkf-strict \
  --compile-runs=100 \
  --compile-warmups=1 \
  --runs=100 \
  --warmups=5 \
  --output=local
```

On Windows, use
`--compiler=build/native-compiler-clang/bin/vkf-strict.exe`.

The Markdown report is human-readable. The JSON report is the authoritative
byte-exact record and contains all individual samples.
