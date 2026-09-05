# Numeric variadic calls — 2026-09-05

Base: dirty `main`, `67343be7e279c3e6ad65331df2490d7aa7605d2e`.
Only numeric positional rest packing, dynamic numeric-list spreads and their
composition with existing defaults are covered by this packet. Fixed spreads,
named rest records, heterogeneous rest values and full `calls.vkf` acceptance
remain open. No deployment or performance claim follows.

## RED → GREEN

1. The unchanged `_sum_rest` declaration and
   `variadic_numeric_arguments_pack_list` assertion from `tests/vkf/calls.vkf`
   print `true\n` natively. WASM initially rejected variadic parameters.
   Shared positional placement and existing array packing made this pass.
2. The unchanged numeric/integer dynamic-spread assertions print
   `true\ntrue\n` natively. WASM initially rejected spread arguments. Native
   shared layout validation plus the existing array-concatenation instruction
   made both pass, without accepting fixed vectors as dynamic-list spreads.
3. A defaulted head with empty, supplied and spread rest values prints
   `2\n4\n8\n` natively, even with a caller `head:100`. WASM initially treated
   the private default wrapper's already packed list as a scalar argument.
   The private wrapper now receives that list as one ordinary parameter and
   forwards it through existing spread IR once.

Native and WASM consume the same extracted positional placement. Native fixed
parameter order, rest order, spread order and existing default behavior are
unchanged; the separate language-authority argument-order question is not
decided by this packet. No new public syntax, API, schema or ABI was introduced.

## Regression commands

In Docker with this repository mounted at `/src`, working directory `/src`:

```sh
# Native rebuild: emscripten/emsdk:4.0.14, temporary container-installed Ninja.
cmake --build build/native-compiler-docker --target vkf-strict -j2
build/native-compiler-docker/bin/vkf-strict -t tests/vkf

# Shared build and regression: emscripten/emsdk:4.0.14.
bash scripts/build-shared-compiler.sh
node --test tests/bootstrap/shared-variadic-call-execution.test.mjs \
  tests/bootstrap/shared-console-parity.test.mjs \
  tests/bootstrap/shared-stdout-formatter.test.mjs \
  tests/bootstrap/shared-list-construction.test.mjs \
  tests/bootstrap/shared-scalar-logic.test.mjs \
  tests/bootstrap/shared-call-execution.test.mjs \
  tests/bootstrap/shared-scope-execution.test.mjs \
  tests/bootstrap/shared-default-call-thunk.test.mjs
```

Native: **451 passed, 0 failed**, exit 0. Final integrated regression:
**53 passed, 0 failed, 0 skipped**, exit 0, 8.175 seconds. This includes all
14 unchanged block assertions and all 17 unchanged scalar-operation assertions.
The added nested-record console probe matches a fresh, uniquely built native
program exactly, confirming the integration-owned formatter is in this artifact.

One intermediate run used `node:22-bookworm` for the formatter's Emscripten
subtest and failed because `em++` was absent. The cause was identified; the
complete formatter suite passed in the required Emscripten image. No test was
skipped, retried unexplained, or weakened. Scoped `git diff --check` passed.

SHA256:

| Artifact | Hash |
| --- | --- |
| Shared compiler WASM | `2fd1da2417eefee7b2001e4e16501e9efc7bf1cf452ed5b2f3cfddd35c42d5ab` |
| Fresh native compiler | `6b5a8e4d60626f6181505432e51463c8a7402fda6aec881daef1998dfb62d5ab` |

## Preserved separate native failure

An exploratory effectful-rest probe exited 139 in native before WASM was
tested. It is not a successful differential oracle and remains a separate
follow-up; canonical numeric calls are not evidence that this case is fixed.
Original source remains at `build/shared-variadic-call-QmEXW0/program.vkf` and
is reproduced here so the evidence survives eventual build-output cleanup:

```vkf
_sum_rest(head: num, ...rest:num) -> num:
    head + stat.sum(rest)
variadic_numeric_arguments_pack_list() -> bit:
    (_sum_rest(1, 2, 3, 4) = 10 /\ _sum_rest(5) = 5)?!
:: variadic_numeric_arguments_pack_list()
emit(value:num) -> num:
    :: value
    value
:: _sum_rest(emit(1), emit(2), emit(3))
```

No commit, push or deployment was made by this packet implementer. Integration
owns the dirty shared checkout and release acceptance.
