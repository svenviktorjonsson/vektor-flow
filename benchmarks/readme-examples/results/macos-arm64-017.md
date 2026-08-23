# VKF 0.1.7 documented-program proof

Generated 2026-08-23T13:29:06.021Z. Every example was compiled from 100 fresh paths and executed in 100 fresh operating-system processes.

## Conditions

- OS: `darwin 24.6.0`
- Architecture: `arm64`
- CPU: Apple M1 (Virtual) (3 logical CPUs)
- Node timing host: `v22.23.1`
- Native compiler: 2261160 bytes, SHA-256 `8adfc1ba36c6496d875cbd6a956f5a607c569f19d57acf7c4a54555c940c35b6`
- Compile: 1 warmup + 100 measured runs. one persistent native compiler process; fresh source path and emitted artifact for every sample.
- Compile scope: source read, lex, parse, native stdlib resolution, typed IR, machine lowering, executable emission; excludes compiler process startup.
- Runtime: 5 warmups + 100 measured runs. fresh operating-system process for every sample, with executable loading and stdout/stderr capture.
- Working directory: one isolated temporary directory per example, reused across its runs.

## Timing summary

| Example | Source bytes | Compile mean | Compile median | Compile p95 | Run mean | Run median | Run p95 | Output |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `core/01-bindings.vkf` | 68 | 0.814 ms | 0.737 ms | 1.028 ms | 1.551 ms | 1.517 ms | 1.784 ms | 100/100 identical |
| `core/02-bind-expression.vkf` | 24 | 1.005 ms | 0.668 ms | 0.849 ms | 1.499 ms | 1.451 ms | 1.705 ms | 100/100 identical |
| `core/03-blocks.vkf` | 288 | 1.103 ms | 1.069 ms | 1.312 ms | 1.516 ms | 1.472 ms | 1.760 ms | 100/100 identical |
| `core/04-output-assert.vkf` | 105 | 0.722 ms | 0.714 ms | 0.868 ms | 1.515 ms | 1.476 ms | 1.740 ms | 100/100 identical |
| `core/05-tagged-test.vkf` | 95 | 0.715 ms | 0.693 ms | 0.864 ms | 1.476 ms | 1.434 ms | 1.706 ms | 100/100 identical |
| `core/06-primitives.vkf` | 169 | 0.933 ms | 0.917 ms | 1.097 ms | 1.483 ms | 1.450 ms | 1.724 ms | 100/100 identical |
| `core/07-reflection.vkf` | 105 | 1.088 ms | 0.811 ms | 1.068 ms | 1.500 ms | 1.467 ms | 1.740 ms | 100/100 identical |
| `core/08-strings.vkf` | 145 | 0.896 ms | 0.877 ms | 1.036 ms | 1.487 ms | 1.456 ms | 1.704 ms | 100/100 identical |
| `core/09-tuples-records.vkf` | 133 | 0.914 ms | 0.888 ms | 1.195 ms | 1.490 ms | 1.452 ms | 1.707 ms | 100/100 identical |
| `core/11-vectors.vkf` | 119 | 1.330 ms | 0.829 ms | 1.053 ms | 1.517 ms | 1.451 ms | 1.779 ms | 100/100 identical |
| `core/12-vector-concat.vkf` | 94 | 0.828 ms | 0.799 ms | 1.053 ms | 1.515 ms | 1.449 ms | 1.781 ms | 100/100 identical |
| `core/12b-container-stress.vkf` | 297 | 1.073 ms | 1.032 ms | 1.271 ms | 62.175 ms | 61.494 ms | 67.163 ms | 100/100 identical |
| `core/13-updates-aliases.vkf` | 278 | 1.192 ms | 1.157 ms | 1.350 ms | 1.642 ms | 1.530 ms | 2.156 ms | 100/100 identical |
| `core/14-multisets.vkf` | 118 | 1.943 ms | 1.650 ms | 1.980 ms | 1.516 ms | 1.479 ms | 1.746 ms | 100/100 identical |
| `core/15-ranges.vkf` | 29 | 0.727 ms | 0.692 ms | 0.882 ms | 1.482 ms | 1.443 ms | 1.733 ms | 100/100 identical |
| `core/16-complex.vkf` | 37 | 0.820 ms | 0.797 ms | 1.067 ms | 1.496 ms | 1.446 ms | 1.776 ms | 100/100 identical |
| `core/17-equality.vkf` | 59 | 0.766 ms | 0.749 ms | 0.911 ms | 1.519 ms | 1.461 ms | 1.801 ms | 100/100 identical |
| `core/18-functions.vkf` | 124 | 0.824 ms | 0.803 ms | 0.964 ms | 1.492 ms | 1.446 ms | 1.736 ms | 100/100 identical |
| `core/19-call-arguments.vkf` | 143 | 0.904 ms | 0.889 ms | 1.025 ms | 1.494 ms | 1.451 ms | 1.763 ms | 100/100 identical |
| `core/20-recursion-closures.vkf` | 227 | 0.986 ms | 0.971 ms | 1.104 ms | 1.485 ms | 1.442 ms | 1.768 ms | 100/100 identical |
| `core/21-lambdas.vkf` | 199 | 0.925 ms | 0.916 ms | 1.065 ms | 1.486 ms | 1.441 ms | 1.736 ms | 100/100 identical |
| `core/22-variadics-spreads.vkf` | 295 | 1.078 ms | 1.049 ms | 1.307 ms | 1.486 ms | 1.439 ms | 1.739 ms | 100/100 identical |
| `core/22b-literal-spreads.vkf` | 49 | 0.716 ms | 0.701 ms | 0.849 ms | 1.494 ms | 1.447 ms | 1.687 ms | 100/100 identical |
| `core/23-shape-parameters.vkf` | 102 | 0.939 ms | 0.914 ms | 1.122 ms | 1.492 ms | 1.447 ms | 1.718 ms | 100/100 identical |
| `core/24-open-any.vkf` | 144 | 0.882 ms | 0.841 ms | 1.074 ms | 1.481 ms | 1.442 ms | 1.718 ms | 100/100 identical |
| `core/25-structural-compatibility.vkf` | 90 | 0.804 ms | 0.779 ms | 0.974 ms | 1.471 ms | 1.438 ms | 1.714 ms | 100/100 identical |
| `core/26-structural-conversions.vkf` | 82 | 0.754 ms | 0.734 ms | 0.936 ms | 1.478 ms | 1.441 ms | 1.759 ms | 100/100 identical |
| `core/27-structural-recursion.vkf` | 141 | 0.867 ms | 0.837 ms | 1.061 ms | 1.482 ms | 1.437 ms | 1.764 ms | 100/100 identical |
| `core/28-structural-records.vkf` | 99 | 0.855 ms | 0.830 ms | 0.986 ms | 1.478 ms | 1.437 ms | 1.734 ms | 100/100 identical |
| `core/29-structural-exact-match.vkf` | 92 | 0.766 ms | 0.747 ms | 0.947 ms | 1.508 ms | 1.441 ms | 1.776 ms | 100/100 identical |
| `core/30-math-structural.vkf` | 129 | 3.900 ms | 3.789 ms | 4.396 ms | 1.504 ms | 1.440 ms | 1.784 ms | 100/100 identical |
| `core/31-conditionals.vkf` | 83 | 0.741 ms | 0.715 ms | 0.919 ms | 1.508 ms | 1.436 ms | 1.761 ms | 100/100 identical |
| `core/32-match.vkf` | 150 | 0.816 ms | 0.792 ms | 0.965 ms | 1.503 ms | 1.436 ms | 1.805 ms | 100/100 identical |
| `core/33-loops.vkf` | 306 | 0.952 ms | 0.939 ms | 1.107 ms | 1.480 ms | 1.437 ms | 1.783 ms | 100/100 identical |
| `core/34-errors.vkf` | 97 | 1.255 ms | 1.239 ms | 1.454 ms | 1.493 ms | 1.447 ms | 1.759 ms | 100/100 identical |
| `core/35-pipes.vkf` | 75 | 0.874 ms | 0.851 ms | 1.072 ms | 1.500 ms | 1.439 ms | 1.822 ms | 100/100 identical |
| `core/36-pipe-blocks.vkf` | 81 | 0.789 ms | 0.763 ms | 0.953 ms | 1.501 ms | 1.447 ms | 1.782 ms | 100/100 identical |
| `core/37-operators.vkf` | 77 | 0.822 ms | 0.791 ms | 0.980 ms | 1.494 ms | 1.445 ms | 1.794 ms | 100/100 identical |
| `core/38-absolute-norm.vkf` | 20 | 0.633 ms | 0.618 ms | 0.743 ms | 1.487 ms | 1.439 ms | 1.761 ms | 100/100 identical |
| `core/39-overloads.vkf` | 182 | 1.008 ms | 0.970 ms | 1.291 ms | 1.495 ms | 1.440 ms | 1.700 ms | 100/100 identical |
| `core/40-fixed-shapes.vkf` | 98 | 0.800 ms | 0.775 ms | 0.928 ms | 1.484 ms | 1.436 ms | 1.791 ms | 100/100 identical |
| `core/41-indexing.vkf` | 89 | 0.796 ms | 0.776 ms | 0.980 ms | 1.491 ms | 1.441 ms | 1.792 ms | 100/100 identical |
| `core/42-axes.vkf` | 149 | 0.987 ms | 0.961 ms | 1.183 ms | 1.496 ms | 1.444 ms | 1.719 ms | 100/100 identical |
| `core/43-modules.vkf` | 45 | 7.714 ms | 6.617 ms | 8.282 ms | 1.491 ms | 1.441 ms | 1.681 ms | 100/100 identical |
| `core/44-shadowing.vkf` | 140 | 4.326 ms | 3.743 ms | 4.518 ms | 1.488 ms | 1.442 ms | 1.781 ms | 100/100 identical |
| `core/45-overloads-dispatch.vkf` | 119 | 1.334 ms | 0.797 ms | 1.135 ms | 1.481 ms | 1.443 ms | 1.725 ms | 100/100 identical |
| `core/46-member-reflection.vkf` | 147 | 0.908 ms | 0.879 ms | 1.144 ms | 1.477 ms | 1.438 ms | 1.715 ms | 100/100 identical |
| `core/47-primitive-spill.vkf` | 16 | 0.851 ms | 0.621 ms | 0.866 ms | 1.508 ms | 1.439 ms | 1.729 ms | 100/100 identical |
| `core/48-dot-overload.vkf` | 172 | 1.046 ms | 0.921 ms | 1.229 ms | 1.490 ms | 1.443 ms | 1.723 ms | 100/100 identical |
| `stdlib/01-math.vkf` | 72 | 3.896 ms | 3.785 ms | 4.497 ms | 1.494 ms | 1.446 ms | 1.746 ms | 100/100 identical |
| `stdlib/02-stat.vkf` | 230 | 1.109 ms | 1.089 ms | 1.296 ms | 1.477 ms | 1.439 ms | 1.722 ms | 100/100 identical |
| `stdlib/03-random.vkf` | 141 | 1.980 ms | 1.776 ms | 2.100 ms | 1.491 ms | 1.439 ms | 1.718 ms | 100/100 identical |
| `stdlib/04-time.vkf` | 169 | 5.860 ms | 5.673 ms | 6.707 ms | 1.917 ms | 1.831 ms | 2.253 ms | 100/100 identical |
| `stdlib/05-io.vkf` | 129 | 1.356 ms | 1.305 ms | 1.748 ms | 2.096 ms | 1.818 ms | 2.370 ms | 100/100 identical |
| `stdlib/06-collections.vkf` | 206 | 1.359 ms | 1.317 ms | 1.673 ms | 1.538 ms | 1.483 ms | 1.888 ms | 100/100 identical |
| `stdlib/07-errors.vkf` | 90 | 1.522 ms | 1.225 ms | 1.461 ms | 1.521 ms | 1.462 ms | 1.837 ms | 100/100 identical |
| `stdlib/08-system.vkf` | 125 | 1.146 ms | 1.123 ms | 1.344 ms | 1.514 ms | 1.463 ms | 1.750 ms | 100/100 identical |
| `stdlib/09-process.vkf` | 103 | 1.029 ms | 1.008 ms | 1.225 ms | 5.999 ms | 5.844 ms | 6.935 ms | 100/100 identical |
| `stdlib/10-regex.vkf` | 168 | 1.078 ms | 1.062 ms | 1.242 ms | 1.655 ms | 1.600 ms | 1.987 ms | 100/100 identical |

## Exact output

### `core/01-bindings.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 4 bytes, SHA-256 `be8d3637e64147183a99406d53a5dda75a3176c815aaecb299a16fa6faf06307`

```text
7
6
```

**stderr:** empty (0 bytes)

### `core/02-bind-expression.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 4 bytes, SHA-256 `1ddb914da9135a2d6dfcc0ff179d68d23e7fd1e5364c088c183234d04a41bece`

```text
3
4
```

**stderr:** empty (0 bytes)

### `core/03-blocks.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 38 bytes, SHA-256 `4e24a6e3b4af447912730c9f9edb30801d9c961094dd5d1b1165a15990302091`

```text
hello world
make_base(x:3, y:4)
3
red
```

**stderr:** empty (0 bytes)

### `core/04-output-assert.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 3 bytes, SHA-256 `084c799cd551dd1d8d5c5f9a5d593b2e931f5e36122ee5c793c1d08a19839cc0`

```text
42
```

**stderr:** empty (0 bytes)

### `core/05-tagged-test.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** empty (0 bytes)

**stderr:** empty (0 bytes)

### `core/06-primitives.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 18 bytes, SHA-256 `342b18013fbf3bfa2067ca42d1753cbdf663ec6faced38915791038bec08963c`

```text
true
A
1.5
7
null
```

**stderr:** empty (0 bytes)

### `core/07-reflection.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 64 bytes, SHA-256 `4b200d24082c99d12fefbdad717fdf5813f794c9d4b2aeccaf0ecdf2e1d97a8c`

```text
4
(any) -> int
[int:2]
(NumberType:num, reflected:(any) -> int)
```

**stderr:** empty (0 bytes)

### `core/08-strings.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 64 bytes, SHA-256 `88ba2f34096bb10760c3a2330944c7d6e97bd0efe94289d5ebcb15dd2cbb123a`

```text
Hej världen
value=4.23
sum=5 point=(x:2, y:false) cost=$5
😀
```

**stderr:** empty (0 bytes)

### `core/09-tuples-records.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 13 bytes, SHA-256 `22df7fb4569c49f5a54ea956e15d783f36161e30e7151dbcdbcf2b9936b83c7f`

```text
12
origin
12
```

**stderr:** empty (0 bytes)

### `core/11-vectors.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 40 bytes, SHA-256 `431aee49009cdcec396de1b489a748450d45fa11353ce72b0f2467602a0d8715`

```text
[1, 2, 3]
[4, 20, 6]
[7, 7, 7, 7, 9, 9]
```

**stderr:** empty (0 bytes)

### `core/12-vector-concat.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 20 bytes, SHA-256 `0fcc2904dc9d884b458eaad6f08657d3320a09f22ce30c5361d11de93357e550`

```text
[1, 2, 3]
[1, 2, 3]
```

**stderr:** empty (0 bytes)

### `core/12b-container-stress.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 9 bytes, SHA-256 `de6aeb89b0d91519a443ac503ea9e652f130752e5ecc78cbcffc3e0f04e4bbf0`

```text
10000000
```

**stderr:** empty (0 bytes)

### `core/13-updates-aliases.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 33 bytes, SHA-256 `140910e03ebf0902b10beebc7aafcb24adbd0fcf8af446be37c31cd09c07385d`

```text
[3, 4]
(x:5, y:6, name:my point)
```

**stderr:** empty (0 bytes)

### `core/14-multisets.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 39 bytes, SHA-256 `34fb1d7325fa8e102bbfe2113d88f976c63e954784b94c986ed1df0fc44c051e`

```text
{a:7, b:1, c:2}
{a:1, b:1}
{a:2}
{a:1}
```

**stderr:** empty (0 bytes)

### `core/15-ranges.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 39 bytes, SHA-256 `82f3ee88f20b642514135e8ffc3f43a3d8cc97d923b41a86171d34242912d1d4`

```text
[0, 1, 2, 3]
[3, 2, 1, 0]
(1, 2, 3, 4)
```

**stderr:** empty (0 bytes)

### `core/16-complex.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 15 bytes, SHA-256 `a218701574bbd953987115e78a008d90fb1503a81d4486846acb1c009aaef887`

```text
1 + 2i
-3 + 4i
```

**stderr:** empty (0 bytes)

### `core/17-equality.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 11 bytes, SHA-256 `c38a31bd481ac409fd307b56ff366108d0f6b9995b07750cf5e2a0ba9f7bf33f`

```text
1
1
[1, 1]
```

**stderr:** empty (0 bytes)

### `core/18-functions.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 9 bytes, SHA-256 `d8ec94706884766f0c6e112f4b260a23f702cd135f8fe8ce0ccfdd3960f83a52`

```text
7
3
null
```

**stderr:** empty (0 bytes)

### `core/19-call-arguments.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 12 bytes, SHA-256 `33844f23f9a54367e3bac979ca95b24aa1cae39272755a9e746e07274d1049c5`

```text
234
345
345
```

**stderr:** empty (0 bytes)

### `core/20-recursion-closures.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 6 bytes, SHA-256 `de57293fb3c8cc0cea24dad81634e9fde34063f3875def931c1742c07715c57f`

```text
720
7
```

**stderr:** empty (0 bytes)

### `core/21-lambdas.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 8 bytes, SHA-256 `505e2046fa4404a5a7d5be40a1750ff63bd5c204ec6f371e29858d1c6330551b`

```text
10
25
9
```

**stderr:** empty (0 bytes)

### `core/22-variadics-spreads.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 28 bytes, SHA-256 `3e5ae314292b12196ac3af9b504c0a8ebc963f543e5afdadb861c30db81e08f2`

```text
10
7
(flag:true, mode:fast)
```

**stderr:** empty (0 bytes)

### `core/22b-literal-spreads.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 15 bytes, SHA-256 `f741b607d95626dc3f96de54fd7ad7cf0a55125fdf1f141155a211e458e29986`

```text
(1, 2, 3, 4)
4
```

**stderr:** empty (0 bytes)

### `core/23-shape-parameters.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 16 bytes, SHA-256 `9f2d2625704e6182bdec03466c5f0a20cdf9e39a40378f2029be48c15d3fe442`

```text
[1, 2, 3, 4, 5]
```

**stderr:** empty (0 bytes)

### `core/24-open-any.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 4 bytes, SHA-256 `b3afef0e7bc7a4e8a30048b5388d63af1c62c2932c7bd15c9db71695e6b9ebc3`

```text
2
7
```

**stderr:** empty (0 bytes)

### `core/25-structural-compatibility.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 27 bytes, SHA-256 `dadd6c6a53d5883844331530b543e641abaaad165311384cc884c24126b6d860`

```text
[2, 4, 6]
[[2, 4], [6, 8]]
```

**stderr:** empty (0 bytes)

### `core/26-structural-conversions.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 13 bytes, SHA-256 `749f71e7de25034687c16e4a72d71fe5dcb80b140a5de551d49ab3de5681e413`

```text
[4, 1.5, -2]
```

**stderr:** empty (0 bytes)

### `core/27-structural-recursion.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 29 bytes, SHA-256 `6943de31c6ffa84ca24290f999a74b6004b8737eca7ae1b0339fe02d2ac360de`

```text
[(x:11, y:-8), (x:13, y:-6)]
```

**stderr:** empty (0 bytes)

### `core/28-structural-records.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 11 bytes, SHA-256 `08e3a5e8430e95f9e6547c835f5298bdbfce19220c5db83ea1f5f2bcf7070769`

```text
[3, 7, 11]
```

**stderr:** empty (0 bytes)

### `core/29-structural-exact-match.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 10 bytes, SHA-256 `3f5caa800a4394143041f3bcb643ee54514adcee3bab1358cfe17d4415d8c120`

```text
[2, 3, 1]
```

**stderr:** empty (0 bytes)

### `core/30-math-structural.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 35 bytes, SHA-256 `8ce2943e922276e1b1c90ce795e13985e6a9fae05310234216d356e8d36f6db2`

```text
[[1, 4], [9, 16]]
[[1, 2], [3, 4]]
```

**stderr:** empty (0 bytes)

### `core/31-conditionals.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 6 bytes, SHA-256 `c4615f9cb6ce29b14379b0661cb7dd7d4d288563bb6eeb7199c52856fffdfcbe`

```text
1
nan
```

**stderr:** empty (0 bytes)

### `core/32-match.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 28 bytes, SHA-256 `3967bff2d510a247a3deeefc323563a4b45b990364a247066352f536eef174e5`

```text
exact three
another integer
```

**stderr:** empty (0 bytes)

### `core/33-loops.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 5 bytes, SHA-256 `eba7437651bd2dabe00aba8388b552da5557f5f7b0fbe2ea2248902e7ffc9cfd`

```text
10
2
```

**stderr:** empty (0 bytes)

### `core/34-errors.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 15 bytes, SHA-256 `09b3f54ee9735fddc87655801eae6e07d76851b8e942b198884072751a2c67bf`

```text
specific value
```

**stderr:** empty (0 bytes)

### `core/35-pipes.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 33 bytes, SHA-256 `3727de73e1b4c11ce046156d73c1659ebbcbef3dc80e3675559845d6088ef3a0`

```text
[2, 4, 6]
(11, 12, 13)
16
ååAA
```

**stderr:** empty (0 bytes)

### `core/36-pipe-blocks.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 14 bytes, SHA-256 `e293556b16abdec668ba2a64a09435af60e074d72d395df1833c56c07d66a72f`

```text
[1, 20, 3, 4]
```

**stderr:** empty (0 bytes)

### `core/37-operators.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 21 bytes, SHA-256 `0860c10fe896dc1349fae38653d0e6498c6e9662579530a857522beeb52c4897`

```text
14
3
2
256
true
true
```

**stderr:** empty (0 bytes)

### `core/38-absolute-norm.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 4 bytes, SHA-256 `133f46e9df9c594a4bd844a0ad79a12dfa578d0d86f881d0b0d4c016068a4b90`

```text
5
5
```

**stderr:** empty (0 bytes)

### `core/39-overloads.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 24 bytes, SHA-256 `e1198d89f3035c2863d736ba0b73a4c4f0bb348b96819a2aff710902ddbc535c`

```text
(x:4, y:6)
(x:-3, y:-4)
```

**stderr:** empty (0 bytes)

### `core/40-fixed-shapes.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 2 bytes, SHA-256 `f0b5c2c2211c8d67ed15e75e656c7862d086e9245420892a7de62cd9ec582a06`

```text
5
```

**stderr:** empty (0 bytes)

### `core/41-indexing.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 29 bytes, SHA-256 `e2591385af547aff82e706b0cb9e82ad909b6155381fccf54b5b931f2279e22c`

```text
20
[10, 30]
[10, 21, 30, 41]
```

**stderr:** empty (0 bytes)

### `core/42-axes.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 91 bytes, SHA-256 `3cd7f8426adf3ebeb3f9b26a9f84e3f10e77a8efbc1d724190802fa492b4291e`

```text
[[1, 2, 3], [2, 4, 6], [3, 6, 9]]
[4, 10, 18]
[[[15, 18], [20, 24]], [[30, 36], [40, 48]]]
```

**stderr:** empty (0 bytes)

### `core/43-modules.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 4 bytes, SHA-256 `a4e80b45e6335963b93bfb520655322a4ad9980e3165c3cbe80234d784c2cef1`

```text
3
1
```

**stderr:** empty (0 bytes)

### `core/44-shadowing.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 4 bytes, SHA-256 `452e39c241ac7c3d1fe29b5529a5e2ea849dff1f35727ab388946535f4f2f0f8`

```text
0
4
```

**stderr:** empty (0 bytes)

### `core/45-overloads-dispatch.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 13 bytes, SHA-256 `4ebb68e57868eb17d264f904194253b9d2ba77fa9eefc158c708598c688e6324`

```text
integer
text
```

**stderr:** empty (0 bytes)

### `core/46-member-reflection.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 37 bytes, SHA-256 `7cc61870e09e854f5453599daed147a7654e3cd5cbd21774526d1670929163e4`

```text
(x:int, y:int)
[int, int]
{x:1, y:1}
```

**stderr:** empty (0 bytes)

### `core/47-primitive-spill.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 3 bytes, SHA-256 `913f5d1da2feaf4deeccc9e55cbb350a20f12b3f507e87be85dbb77fdd3cb9bc`

```text
64
```

**stderr:** empty (0 bytes)

### `core/48-dot-overload.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 4 bytes, SHA-256 `1ddb914da9135a2d6dfcc0ff179d68d23e7fd1e5364c088c183234d04a41bece`

```text
3
4
```

**stderr:** empty (0 bytes)

### `stdlib/01-math.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 6 bytes, SHA-256 `6c8aade637e337c00bb7fb50e0085e52d398eb65839748c2af93fd0f1d6a5b96`

```text
9
1
3
```

**stderr:** empty (0 bytes)

### `stdlib/02-stat.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 29 bytes, SHA-256 `0d30b62acc1ce092e60dfdc7dc348ddcc3cf339f2dcb050435703b1dcfb9f609`

```text
5
4
2
7
21
[5, 7, 9]
[6, 15]
```

**stderr:** empty (0 bytes)

### `stdlib/03-random.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 39 bytes, SHA-256 `42355a336197258cbb3cf70a1ff3e18cd7f765fbca2b2749a461e67d5fc3f32e`

```text
0.009626434189093501
1.791479416094478
```

**stderr:** empty (0 bytes)

### `stdlib/04-time.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 20 bytes, SHA-256 `506ccb700357d37bb8c599603055b3a449c9c27e853112ff1b80080a264d8fa1`

```text
1970-01-01 00:00:00
```

**stderr:** empty (0 bytes)

### `stdlib/05-io.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 12 bytes, SHA-256 `a948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447`

```text
hello world
```

**stderr:** empty (0 bytes)

### `stdlib/06-collections.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 25 bytes, SHA-256 `082dfaf3fdba63d854cb8d1a24ecc0fbd45a39ab10ae378fa99c01a1f74e3520`

```text
[1, 2, 3]
origin
10
true
```

**stderr:** empty (0 bytes)

### `stdlib/07-errors.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 5 bytes, SHA-256 `a17fcf0a2f50e2d495e4f90ce263410edc183add6c62699a2facbccf60410f74`

```text
true
```

**stderr:** empty (0 bytes)

### `stdlib/08-system.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 125 bytes, SHA-256 `5ae3d5bef04af22ab331ffd4b77a194695f7cd522c1e67fa09988db5f2b6e631`

```text
macos
arm64
3
/private/var/folders/_5/zjnzxgh147qcg3bb5cg2wvqw0000gn/T/vkf-readme-proof-FkDrgl/runtime/stdlib/08-system
true
```

**stderr:** empty (0 bytes)

### `stdlib/09-process.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 23 bytes, SHA-256 `434751e394c24f0e8906749bc1ea54382f15b04f1e2d5f32cae265e8835d00e2`

```text
0
git version 2.55.0


```

**stderr:** empty (0 bytes)

### `stdlib/10-regex.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 15 bytes, SHA-256 `b35cd66fc9c8c1e3c8a685b872f413e55f53226466d5a9c0f827bf63696bd38a`

```text
vektor
vkf
101
```

**stderr:** empty (0 bytes)
