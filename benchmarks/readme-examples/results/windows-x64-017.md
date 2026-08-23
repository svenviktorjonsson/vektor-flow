# VKF 0.1.7 documented-program proof

Generated 2026-08-23T13:35:33.177Z. Every example was compiled from 100 fresh paths and executed in 100 fresh operating-system processes.

## Conditions

- OS: `win32 10.0.26100`
- Architecture: `x64`
- CPU: AMD EPYC 7763 64-Core Processor (4 logical CPUs)
- Node timing host: `v22.23.2`
- Native compiler: 4003840 bytes, SHA-256 `1b7db43f6615fd79265591807ee0ad05f76a41053b8962015de296f2eb995098`
- Compile: 1 warmup + 100 measured runs. one persistent native compiler process; fresh source path and emitted artifact for every sample.
- Compile scope: source read, lex, parse, native stdlib resolution, typed IR, machine lowering, executable emission; excludes compiler process startup.
- Runtime: 5 warmups + 100 measured runs. fresh operating-system process for every sample, with executable loading and stdout/stderr capture.
- Working directory: one isolated temporary directory per example, reused across its runs.

## Timing summary

| Example | Source bytes | Compile mean | Compile median | Compile p95 | Run mean | Run median | Run p95 | Output |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `core/01-bindings.vkf` | 73 | 2.998 ms | 2.782 ms | 4.287 ms | 19.928 ms | 19.684 ms | 23.609 ms | 100/100 identical |
| `core/02-bind-expression.vkf` | 27 | 2.680 ms | 2.296 ms | 3.680 ms | 20.223 ms | 20.095 ms | 23.193 ms | 100/100 identical |
| `core/03-blocks.vkf` | 307 | 15.596 ms | 11.904 ms | 46.257 ms | 19.830 ms | 19.550 ms | 23.050 ms | 100/100 identical |
| `core/04-output-assert.vkf` | 109 | 2.604 ms | 2.522 ms | 3.087 ms | 19.753 ms | 19.587 ms | 23.060 ms | 100/100 identical |
| `core/05-tagged-test.vkf` | 100 | 2.220 ms | 2.075 ms | 3.281 ms | 19.670 ms | 19.588 ms | 23.127 ms | 100/100 identical |
| `core/06-primitives.vkf` | 183 | 5.641 ms | 5.281 ms | 7.461 ms | 19.724 ms | 19.514 ms | 23.154 ms | 100/100 identical |
| `core/07-reflection.vkf` | 114 | 6.845 ms | 6.484 ms | 8.611 ms | 19.969 ms | 19.738 ms | 24.445 ms | 100/100 identical |
| `core/08-strings.vkf` | 153 | 6.608 ms | 6.095 ms | 8.733 ms | 19.811 ms | 19.385 ms | 23.807 ms | 100/100 identical |
| `core/09-tuples-records.vkf` | 142 | 4.879 ms | 3.982 ms | 6.112 ms | 19.856 ms | 19.752 ms | 23.009 ms | 100/100 identical |
| `core/11-vectors.vkf` | 128 | 6.424 ms | 5.987 ms | 8.212 ms | 19.826 ms | 19.646 ms | 22.974 ms | 100/100 identical |
| `core/12-vector-concat.vkf` | 98 | 5.525 ms | 5.154 ms | 7.603 ms | 19.868 ms | 19.813 ms | 23.084 ms | 100/100 identical |
| `core/12b-container-stress.vkf` | 310 | 4.253 ms | 3.896 ms | 6.067 ms | 36.455 ms | 36.026 ms | 42.280 ms | 100/100 identical |
| `core/13-updates-aliases.vkf` | 294 | 10.338 ms | 9.762 ms | 12.902 ms | 20.149 ms | 20.003 ms | 23.791 ms | 100/100 identical |
| `core/14-multisets.vkf` | 125 | 137.655 ms | 132.950 ms | 159.580 ms | 19.853 ms | 19.780 ms | 23.289 ms | 100/100 identical |
| `core/15-ranges.vkf` | 32 | 2.924 ms | 2.755 ms | 3.956 ms | 19.763 ms | 19.537 ms | 23.736 ms | 100/100 identical |
| `core/16-complex.vkf` | 40 | 11.821 ms | 11.313 ms | 14.777 ms | 19.832 ms | 19.600 ms | 23.564 ms | 100/100 identical |
| `core/17-equality.vkf` | 62 | 4.404 ms | 4.164 ms | 5.952 ms | 19.745 ms | 19.524 ms | 23.498 ms | 100/100 identical |
| `core/18-functions.vkf` | 135 | 14.309 ms | 8.573 ms | 23.271 ms | 19.734 ms | 19.705 ms | 22.883 ms | 100/100 identical |
| `core/19-call-arguments.vkf` | 149 | 4.672 ms | 4.528 ms | 5.350 ms | 20.020 ms | 19.733 ms | 23.039 ms | 100/100 identical |
| `core/20-recursion-closures.vkf` | 241 | 4.969 ms | 4.553 ms | 6.618 ms | 20.138 ms | 19.804 ms | 24.074 ms | 100/100 identical |
| `core/21-lambdas.vkf` | 210 | 4.411 ms | 4.192 ms | 5.987 ms | 19.919 ms | 19.475 ms | 23.127 ms | 100/100 identical |
| `core/22-variadics-spreads.vkf` | 310 | 5.822 ms | 5.442 ms | 7.594 ms | 20.187 ms | 19.780 ms | 23.642 ms | 100/100 identical |
| `core/22b-literal-spreads.vkf` | 52 | 2.894 ms | 2.658 ms | 4.051 ms | 20.066 ms | 19.556 ms | 24.336 ms | 100/100 identical |
| `core/23-shape-parameters.vkf` | 107 | 4.876 ms | 4.580 ms | 6.471 ms | 19.923 ms | 20.017 ms | 22.900 ms | 100/100 identical |
| `core/24-open-any.vkf` | 152 | 3.099 ms | 2.915 ms | 4.165 ms | 19.822 ms | 19.594 ms | 22.979 ms | 100/100 identical |
| `core/25-structural-compatibility.vkf` | 95 | 3.806 ms | 3.517 ms | 5.337 ms | 20.044 ms | 19.871 ms | 24.252 ms | 100/100 identical |
| `core/26-structural-conversions.vkf` | 87 | 10.570 ms | 7.846 ms | 15.377 ms | 20.055 ms | 19.663 ms | 24.249 ms | 100/100 identical |
| `core/27-structural-recursion.vkf` | 146 | 4.157 ms | 3.970 ms | 5.431 ms | 19.940 ms | 19.949 ms | 23.526 ms | 100/100 identical |
| `core/28-structural-records.vkf` | 105 | 4.819 ms | 4.525 ms | 6.526 ms | 19.906 ms | 19.873 ms | 22.912 ms | 100/100 identical |
| `core/29-structural-exact-match.vkf` | 96 | 2.784 ms | 2.677 ms | 3.329 ms | 20.104 ms | 19.961 ms | 23.199 ms | 100/100 identical |
| `core/30-math-structural.vkf` | 136 | 24.755 ms | 23.565 ms | 30.020 ms | 20.026 ms | 19.673 ms | 22.756 ms | 100/100 identical |
| `core/31-conditionals.vkf` | 91 | 3.515 ms | 3.279 ms | 4.913 ms | 20.317 ms | 19.689 ms | 24.387 ms | 100/100 identical |
| `core/32-match.vkf` | 158 | 3.827 ms | 3.531 ms | 5.413 ms | 20.280 ms | 19.685 ms | 23.936 ms | 100/100 identical |
| `core/33-loops.vkf` | 328 | 3.815 ms | 3.595 ms | 5.008 ms | 19.713 ms | 19.432 ms | 22.742 ms | 100/100 identical |
| `core/34-errors.vkf` | 104 | 25.403 ms | 23.895 ms | 31.326 ms | 20.381 ms | 19.571 ms | 22.763 ms | 100/100 identical |
| `core/35-pipes.vkf` | 79 | 8.149 ms | 7.696 ms | 10.671 ms | 20.165 ms | 19.896 ms | 22.877 ms | 100/100 identical |
| `core/36-pipe-blocks.vkf` | 89 | 16.041 ms | 13.917 ms | 33.320 ms | 19.935 ms | 19.509 ms | 23.997 ms | 100/100 identical |
| `core/37-operators.vkf` | 83 | 4.334 ms | 4.209 ms | 5.378 ms | 19.782 ms | 19.813 ms | 23.260 ms | 100/100 identical |
| `core/38-absolute-norm.vkf` | 22 | 2.097 ms | 1.948 ms | 3.053 ms | 20.024 ms | 19.772 ms | 23.315 ms | 100/100 identical |
| `core/39-overloads.vkf` | 192 | 4.483 ms | 4.219 ms | 6.278 ms | 20.130 ms | 19.924 ms | 23.384 ms | 100/100 identical |
| `core/40-fixed-shapes.vkf` | 102 | 2.953 ms | 2.705 ms | 4.524 ms | 19.909 ms | 19.596 ms | 22.834 ms | 100/100 identical |
| `core/41-indexing.vkf` | 95 | 4.116 ms | 3.772 ms | 5.887 ms | 19.832 ms | 19.573 ms | 23.031 ms | 100/100 identical |
| `core/42-axes.vkf` | 156 | 9.228 ms | 8.617 ms | 11.937 ms | 19.740 ms | 19.508 ms | 22.729 ms | 100/100 identical |
| `core/43-modules.vkf` | 50 | 43.191 ms | 41.508 ms | 53.669 ms | 19.674 ms | 19.422 ms | 23.401 ms | 100/100 identical |
| `core/44-shadowing.vkf` | 153 | 22.057 ms | 21.368 ms | 27.602 ms | 19.762 ms | 19.618 ms | 22.991 ms | 100/100 identical |
| `core/45-overloads-dispatch.vkf` | 127 | 17.191 ms | 14.678 ms | 25.295 ms | 19.709 ms | 19.477 ms | 23.395 ms | 100/100 identical |
| `core/46-member-reflection.vkf` | 155 | 15.244 ms | 13.905 ms | 19.253 ms | 19.695 ms | 19.552 ms | 22.863 ms | 100/100 identical |
| `core/47-primitive-spill.vkf` | 18 | 2.107 ms | 2.002 ms | 2.656 ms | 19.867 ms | 19.769 ms | 23.094 ms | 100/100 identical |
| `core/48-dot-overload.vkf` | 182 | 4.426 ms | 4.221 ms | 5.674 ms | 19.745 ms | 19.644 ms | 23.212 ms | 100/100 identical |
| `stdlib/01-math.vkf` | 76 | 23.079 ms | 22.293 ms | 29.500 ms | 19.711 ms | 19.549 ms | 22.884 ms | 100/100 identical |
| `stdlib/02-stat.vkf` | 239 | 9.334 ms | 8.782 ms | 12.068 ms | 19.674 ms | 19.538 ms | 22.814 ms | 100/100 identical |
| `stdlib/03-random.vkf` | 146 | 9.977 ms | 9.423 ms | 12.397 ms | 19.631 ms | 19.580 ms | 23.303 ms | 100/100 identical |
| `stdlib/04-time.vkf` | 175 | 81.895 ms | 78.713 ms | 98.204 ms | 20.306 ms | 19.888 ms | 24.157 ms | 100/100 identical |
| `stdlib/05-io.vkf` | 133 | 42.555 ms | 34.713 ms | 83.691 ms | 20.372 ms | 20.231 ms | 24.179 ms | 100/100 identical |
| `stdlib/06-collections.vkf` | 216 | 19.124 ms | 18.431 ms | 22.738 ms | 19.518 ms | 19.442 ms | 22.688 ms | 100/100 identical |
| `stdlib/07-errors.vkf` | 95 | 24.910 ms | 23.798 ms | 29.960 ms | 19.585 ms | 19.540 ms | 22.661 ms | 100/100 identical |
| `stdlib/08-system.vkf` | 132 | 5.715 ms | 5.288 ms | 7.492 ms | 19.772 ms | 19.353 ms | 24.471 ms | 100/100 identical |
| `stdlib/09-process.vkf` | 108 | 5.622 ms | 5.262 ms | 8.097 ms | 51.871 ms | 51.314 ms | 60.613 ms | 100/100 identical |
| `stdlib/10-regex.vkf` | 174 | 10.716 ms | 10.023 ms | 14.223 ms | 19.926 ms | 19.848 ms | 22.935 ms | 100/100 identical |

## Exact output

### `core/01-bindings.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 6 bytes, SHA-256 `8ef9de27cf321edf99829555463b08b27750fe114d01053a39c7a6ec60c2f73c`

```text
7
6
```

**stderr:** empty (0 bytes)

### `core/02-bind-expression.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 6 bytes, SHA-256 `722b3a2c262caef957158f2efe473dad62c49b3ed1f73593bf789916eb5d799e`

```text
3
4
```

**stderr:** empty (0 bytes)

### `core/03-blocks.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 42 bytes, SHA-256 `c9059569507a4ed7e7c4adbf89e047e9ec2194eb22ed762ff83f47a597ff2c0d`

```text
hello world
make_base(x:3, y:4)
3
red
```

**stderr:** empty (0 bytes)

### `core/04-output-assert.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 4 bytes, SHA-256 `9e4c59bb9e5ca6ca840eb57555c3f45692474ff6c1379d3579eec60e18667cbe`

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

**stdout:** 23 bytes, SHA-256 `721c48a68c502c33a24953e8c89828a0ecbdc51ce4def46da34120ba3d121513`

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

**stdout:** 68 bytes, SHA-256 `357e12479afaf454b57cfe2bff455a4015404d7681447d97a0663227f10413de`

```text
4
(any) -> int
[int:2]
(NumberType:num, reflected:(any) -> int)
```

**stderr:** empty (0 bytes)

### `core/08-strings.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 68 bytes, SHA-256 `3bd04d34af770ded27964be768109210c61994a41ab2cd16fa24f908d8860a6b`

```text
Hej världen
value=4.23
sum=5 point=(x:2, y:false) cost=$5
😀
```

**stderr:** empty (0 bytes)

### `core/09-tuples-records.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 16 bytes, SHA-256 `22a33ca27f7112254d238df755e89c6286972b627a8991601c4635797f436f6b`

```text
12
origin
12
```

**stderr:** empty (0 bytes)

### `core/11-vectors.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 43 bytes, SHA-256 `5ecd52c0a916e2176f0cb2bc2c9d7b616b8633440c565563d2ca5182b24096ef`

```text
[1, 2, 3]
[4, 20, 6]
[7, 7, 7, 7, 9, 9]
```

**stderr:** empty (0 bytes)

### `core/12-vector-concat.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 22 bytes, SHA-256 `8811ce8c596404089b299583392f8c4664d1effb71fa0bd9ee0e73e80778f4d8`

```text
[1, 2, 3]
[1, 2, 3]
```

**stderr:** empty (0 bytes)

### `core/12b-container-stress.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 10 bytes, SHA-256 `0bd8ccdc7e1dae22f79eb67dab29b4e0373b06a2add164697b04abf307edcac3`

```text
10000000
```

**stderr:** empty (0 bytes)

### `core/13-updates-aliases.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 35 bytes, SHA-256 `bc8fe972612f0fbd38b39e6a8174f6dd5f235a6bb3a306ed383115e01784c9ef`

```text
[3, 4]
(x:5, y:6, name:my point)
```

**stderr:** empty (0 bytes)

### `core/14-multisets.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 43 bytes, SHA-256 `ee4c737983c7e65e4b0975bf781147266b0bc9df4fc1e48f8633a4d1bb0165d1`

```text
{a:7, b:1, c:2}
{a:1, b:1}
{a:2}
{a:1}
```

**stderr:** empty (0 bytes)

### `core/15-ranges.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 42 bytes, SHA-256 `5e2847062d2a365ad8f24784cf2056dd91d4720fcf59ee4cfe2074b0367d94c5`

```text
[0, 1, 2, 3]
[3, 2, 1, 0]
(1, 2, 3, 4)
```

**stderr:** empty (0 bytes)

### `core/16-complex.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 17 bytes, SHA-256 `680ea1fe10308a91ef24312a5b52ec44074e698274919dbe27738aa13bfc32df`

```text
1 + 2i
-3 + 4i
```

**stderr:** empty (0 bytes)

### `core/17-equality.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 14 bytes, SHA-256 `725ac9c60c70b7263ccead3bac3923d919af6fe5964230a1a332d7b64ddec9c0`

```text
1
1
[1, 1]
```

**stderr:** empty (0 bytes)

### `core/18-functions.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 12 bytes, SHA-256 `88f8d52ecf0bdea31a88d56cc23e9f66167f7369317467f2bf597816645d66ca`

```text
7
3
null
```

**stderr:** empty (0 bytes)

### `core/19-call-arguments.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 15 bytes, SHA-256 `7a202ae470e1074ad2ebdb4498025f914a0e4af3473b9b616cae06eba0136055`

```text
234
345
345
```

**stderr:** empty (0 bytes)

### `core/20-recursion-closures.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 8 bytes, SHA-256 `8a599d1ccf14566a5ce9bc8930099d0daddfa36030fa719a6d6f3d232f5f0a5f`

```text
720
7
```

**stderr:** empty (0 bytes)

### `core/21-lambdas.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 11 bytes, SHA-256 `0238bcde0dbdaf471e3a4165547f00d30f982bf62faea7842cf4080d6ad99caa`

```text
10
25
9
```

**stderr:** empty (0 bytes)

### `core/22-variadics-spreads.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 31 bytes, SHA-256 `445dbb647500e08ce6575d31fdf35eeb212a914f314edf9349cd78ea43b1fe24`

```text
10
7
(flag:true, mode:fast)
```

**stderr:** empty (0 bytes)

### `core/22b-literal-spreads.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 17 bytes, SHA-256 `9d21f93fc3acbaff8a12d4c6620d8d4c0a0076b4314091ca2860afd8a08e66d0`

```text
(1, 2, 3, 4)
4
```

**stderr:** empty (0 bytes)

### `core/23-shape-parameters.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 17 bytes, SHA-256 `93183e3a20daa4bf1fc9c0bb69613ee80fc36bc825014fef709b545f0684f986`

```text
[1, 2, 3, 4, 5]
```

**stderr:** empty (0 bytes)

### `core/24-open-any.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 6 bytes, SHA-256 `420f41b538531803a38b2eeb5698105ade7841ef55d453d3159fb26dbb1d64e8`

```text
2
7
```

**stderr:** empty (0 bytes)

### `core/25-structural-compatibility.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 29 bytes, SHA-256 `bd97c1fd7577bdcdda85bf174745041573cb3163a39071b0bb92696022dc7583`

```text
[2, 4, 6]
[[2, 4], [6, 8]]
```

**stderr:** empty (0 bytes)

### `core/26-structural-conversions.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 14 bytes, SHA-256 `7ed67bfcf59158c158a8870a131071074c4aa25479c7b7647602da403a534004`

```text
[4, 1.5, -2]
```

**stderr:** empty (0 bytes)

### `core/27-structural-recursion.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 30 bytes, SHA-256 `dc8976f59f6b2a0cae761cdbab66d6f4e6a662f6de162b75684a24b9a41d75e1`

```text
[(x:11, y:-8), (x:13, y:-6)]
```

**stderr:** empty (0 bytes)

### `core/28-structural-records.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 12 bytes, SHA-256 `d80aa4acb2bbc74db92036c90caec185be4f57a94e780877de8589e141d0797e`

```text
[3, 7, 11]
```

**stderr:** empty (0 bytes)

### `core/29-structural-exact-match.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 11 bytes, SHA-256 `98ae8ee5435ebd22c076505f24016d49f8741b42750dbcc7d29d46ac7ca2b156`

```text
[2, 3, 1]
```

**stderr:** empty (0 bytes)

### `core/30-math-structural.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 37 bytes, SHA-256 `dd6b5907e1a9644cf01b4ca3b799c849e1842328aa2a419f560ef4fe0b71fa37`

```text
[[1, 4], [9, 16]]
[[1, 2], [3, 4]]
```

**stderr:** empty (0 bytes)

### `core/31-conditionals.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 12 bytes, SHA-256 `54682ccb66344d62d4585486e73ceced88beda0e1087147a70489328e2f992ac`

```text
1
1.#QNAN
```

**stderr:** empty (0 bytes)

### `core/32-match.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 30 bytes, SHA-256 `e2a4842cc8b38b2f855dc94cce8ddd3694b27c482e473373a5618e65476fed79`

```text
exact three
another integer
```

**stderr:** empty (0 bytes)

### `core/33-loops.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 7 bytes, SHA-256 `57c4833ba4ec5c982a7f0a78e208a914961004c02634d99166644a56ae36dfdc`

```text
10
2
```

**stderr:** empty (0 bytes)

### `core/34-errors.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 16 bytes, SHA-256 `31df944cde860415597b2bf00862d5d78e48dc2c1dba6d02dce9c68390629edb`

```text
specific value
```

**stderr:** empty (0 bytes)

### `core/35-pipes.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 37 bytes, SHA-256 `8ae767b7255cfb15d616cb44d1a5ad1d6f43df34422e8021960892d834a31fba`

```text
[2, 4, 6]
(11, 12, 13)
16
ååAA
```

**stderr:** empty (0 bytes)

### `core/36-pipe-blocks.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 15 bytes, SHA-256 `359b322fcf9e7f0a1832df387664a4c9f6478eeedb6928ec2f8dc0ee5dcd575a`

```text
[1, 20, 3, 4]
```

**stderr:** empty (0 bytes)

### `core/37-operators.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 27 bytes, SHA-256 `fe2ea8a3f21b54843e40b9f51159bc9127c40d2ea2a5c22bbe5a7ee2905246ac`

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

**stdout:** 6 bytes, SHA-256 `e53ee59797fb8eaa96e37638df95094f56f0b7ce7beb19e8cbc6a3e0f0ed84d2`

```text
5
5
```

**stderr:** empty (0 bytes)

### `core/39-overloads.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 26 bytes, SHA-256 `47e44c38aa327b833a612a5be4ad129d0fbf498fa65324668ccbad8643753006`

```text
(x:4, y:6)
(x:-3, y:-4)
```

**stderr:** empty (0 bytes)

### `core/40-fixed-shapes.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 3 bytes, SHA-256 `7fb2aaeaf3eef66b52db104118c30f62899f5f0df520350a94a8fcb843c0dfdf`

```text
5
```

**stderr:** empty (0 bytes)

### `core/41-indexing.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 32 bytes, SHA-256 `236f81dcc83ad0ac193211217925c3b9f3e3aeb3fe3993f6cc35007c301ba34b`

```text
20
[10, 30]
[10, 21, 30, 41]
```

**stderr:** empty (0 bytes)

### `core/42-axes.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 94 bytes, SHA-256 `bf151195989fea722be6c3afce050c8400c22b89f65e3208616637f9139e7d30`

```text
[[1, 2, 3], [2, 4, 6], [3, 6, 9]]
[4, 10, 18]
[[[15, 18], [20, 24]], [[30, 36], [40, 48]]]
```

**stderr:** empty (0 bytes)

### `core/43-modules.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 6 bytes, SHA-256 `fc32717c04f9e2f742a0fd75e4a30c2999db1360c8395fef7fa2260fcc0258d1`

```text
3
1
```

**stderr:** empty (0 bytes)

### `core/44-shadowing.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 6 bytes, SHA-256 `c8aace42342a3de458a51ed77e337205f57b20a220398f05054f2a2d2f9bdb83`

```text
0
4
```

**stderr:** empty (0 bytes)

### `core/45-overloads-dispatch.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 15 bytes, SHA-256 `96fba1069b68a627afcdac3fcca52aa8249dee0247718c131ffec617966fb77b`

```text
integer
text
```

**stderr:** empty (0 bytes)

### `core/46-member-reflection.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 40 bytes, SHA-256 `94318d0b7d91ff3f8834b2cb695dfb113e0b8604bea5cb5ada1dafdddc20b562`

```text
(x:int, y:int)
[int, int]
{x:1, y:1}
```

**stderr:** empty (0 bytes)

### `core/47-primitive-spill.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 4 bytes, SHA-256 `a0ec0460fc75a1eea654e7a06b4b6addb3a2f8a4dfc8cd3ea9f2356d644ab44f`

```text
64
```

**stderr:** empty (0 bytes)

### `core/48-dot-overload.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 6 bytes, SHA-256 `722b3a2c262caef957158f2efe473dad62c49b3ed1f73593bf789916eb5d799e`

```text
3
4
```

**stderr:** empty (0 bytes)

### `stdlib/01-math.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 9 bytes, SHA-256 `6f168134c3ba27223b9adc0335b1704d6309c080e57d72f4bebe9e9f2eac0fa1`

```text
9
1
3
```

**stderr:** empty (0 bytes)

### `stdlib/02-stat.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 36 bytes, SHA-256 `51883c07ad506a1f9d7af2bbdd98f1640327e3ae3416b26bfa812821b8647496`

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

**stdout:** 41 bytes, SHA-256 `196311bbcfcef99b3220aac51f4aec73c781c34e51acbcbb696cf673901b2a6d`

```text
0.009626434189093501
1.791479416094478
```

**stderr:** empty (0 bytes)

### `stdlib/04-time.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 21 bytes, SHA-256 `07373f641c45a9731938b679109aa5db02b037aab83348ddbc8665d8f575b769`

```text
1970-01-01 00:00:00
```

**stderr:** empty (0 bytes)

### `stdlib/05-io.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 13 bytes, SHA-256 `572a95fee9c0f320030789e4883707affe12482fbb1ea04b3ea8267c87a890fb`

```text
hello world
```

**stderr:** empty (0 bytes)

### `stdlib/06-collections.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 29 bytes, SHA-256 `a6e2a78c61b9414d9c6889f46aa230909888b0013cc2a723d9c2c0c27a655006`

```text
[1, 2, 3]
origin
10
true
```

**stderr:** empty (0 bytes)

### `stdlib/07-errors.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 6 bytes, SHA-256 `49628009a4b6e1f4b66b9f3b6842423d60085f9ec94467f3ccbbf28862d78f7a`

```text
true
```

**stderr:** empty (0 bytes)

### `stdlib/08-system.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 113 bytes, SHA-256 `a3234a992e347454068567d66474f4543ce7cb37b3dafca7517e8e83c8790a00`

```text
windows
x86_64
4
C:\Users\RUNNER~1\AppData\Local\Temp\vkf-readme-proof-lRsunP\runtime\stdlib\08-system
true
```

**stderr:** empty (0 bytes)

### `stdlib/09-process.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 37 bytes, SHA-256 `0de7b9c3c8f187d8c042222ff7445e44cfd77c90640a858d28141d2a8abbf6e9`

```text
0
git version 2.55.0.windows.4


```

**stderr:** empty (0 bytes)

### `stdlib/10-regex.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 18 bytes, SHA-256 `62a4f45d656e1c1aa840717ec641e43b7cc572a79bf9a1328f13b54ee50c5d1b`

```text
vektor
vkf
101
```

**stderr:** empty (0 bytes)
