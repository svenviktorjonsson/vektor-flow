# VKF 0.1.6 documented-program proof

Generated 2026-08-23T11:01:50.273Z. Every example was compiled from 100 fresh paths and executed in 100 fresh operating-system processes.

## Conditions

- OS: `win32 10.0.26100`
- Architecture: `x64`
- CPU: AMD EPYC 7763 64-Core Processor (4 logical CPUs)
- Node timing host: `v22.23.2`
- Native compiler: 4003328 bytes, SHA-256 `87c3baf994b7890033471e318333260d88ca5805142ca0576fa55d2291ce02cb`
- Compile: 1 warmup + 100 measured runs. one persistent native compiler process; fresh source path and emitted artifact for every sample.
- Compile scope: source read, lex, parse, native stdlib resolution, typed IR, machine lowering, executable emission; excludes compiler process startup.
- Runtime: 5 warmups + 100 measured runs. fresh operating-system process for every sample, with executable loading and stdout/stderr capture.
- Working directory: one isolated temporary directory per example, reused across its runs.

## Timing summary

| Example | Source bytes | Compile mean | Compile median | Compile p95 | Run mean | Run median | Run p95 | Output |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `core/01-bindings.vkf` | 73 | 3.067 ms | 2.721 ms | 3.955 ms | 18.861 ms | 18.625 ms | 21.697 ms | 100/100 identical |
| `core/02-bind-expression.vkf` | 27 | 2.424 ms | 2.259 ms | 3.319 ms | 18.908 ms | 18.545 ms | 21.098 ms | 100/100 identical |
| `core/03-blocks.vkf` | 307 | 22.174 ms | 7.942 ms | 99.699 ms | 18.811 ms | 18.416 ms | 21.844 ms | 100/100 identical |
| `core/04-output-assert.vkf` | 109 | 2.577 ms | 2.457 ms | 3.472 ms | 19.042 ms | 18.781 ms | 20.804 ms | 100/100 identical |
| `core/05-tagged-test.vkf` | 100 | 2.187 ms | 2.062 ms | 2.929 ms | 19.238 ms | 18.434 ms | 21.064 ms | 100/100 identical |
| `core/06-primitives.vkf` | 183 | 5.480 ms | 5.168 ms | 7.341 ms | 19.168 ms | 19.140 ms | 20.976 ms | 100/100 identical |
| `core/07-reflection.vkf` | 114 | 6.689 ms | 6.369 ms | 8.573 ms | 18.772 ms | 18.369 ms | 21.391 ms | 100/100 identical |
| `core/08-strings.vkf` | 153 | 6.375 ms | 6.009 ms | 8.730 ms | 18.783 ms | 18.347 ms | 21.223 ms | 100/100 identical |
| `core/09-tuples-records.vkf` | 142 | 4.149 ms | 3.883 ms | 5.641 ms | 18.967 ms | 18.569 ms | 21.262 ms | 100/100 identical |
| `core/11-vectors.vkf` | 128 | 6.219 ms | 5.869 ms | 8.591 ms | 18.872 ms | 18.668 ms | 21.050 ms | 100/100 identical |
| `core/12-vector-concat.vkf` | 98 | 5.532 ms | 5.070 ms | 7.496 ms | 18.917 ms | 18.563 ms | 21.364 ms | 100/100 identical |
| `core/12b-container-stress.vkf` | 310 | 4.100 ms | 3.780 ms | 5.749 ms | 36.533 ms | 35.873 ms | 40.758 ms | 100/100 identical |
| `core/13-updates-aliases.vkf` | 294 | 10.220 ms | 9.570 ms | 13.101 ms | 19.258 ms | 19.126 ms | 21.521 ms | 100/100 identical |
| `core/14-multisets.vkf` | 125 | 136.751 ms | 133.499 ms | 154.438 ms | 18.845 ms | 18.648 ms | 20.596 ms | 100/100 identical |
| `core/15-ranges.vkf` | 32 | 2.915 ms | 2.755 ms | 3.802 ms | 18.864 ms | 18.557 ms | 21.237 ms | 100/100 identical |
| `core/16-complex.vkf` | 40 | 11.709 ms | 11.204 ms | 15.220 ms | 18.842 ms | 18.661 ms | 20.485 ms | 100/100 identical |
| `core/17-equality.vkf` | 62 | 4.377 ms | 4.127 ms | 5.940 ms | 18.938 ms | 18.790 ms | 21.174 ms | 100/100 identical |
| `core/18-functions.vkf` | 135 | 14.230 ms | 4.928 ms | 55.844 ms | 18.983 ms | 18.734 ms | 20.993 ms | 100/100 identical |
| `core/19-call-arguments.vkf` | 149 | 4.485 ms | 4.302 ms | 5.095 ms | 18.975 ms | 18.766 ms | 20.834 ms | 100/100 identical |
| `core/20-recursion-closures.vkf` | 241 | 4.797 ms | 4.432 ms | 6.649 ms | 19.217 ms | 18.877 ms | 22.115 ms | 100/100 identical |
| `core/21-lambdas.vkf` | 210 | 4.401 ms | 4.146 ms | 6.112 ms | 18.883 ms | 18.495 ms | 20.902 ms | 100/100 identical |
| `core/22-variadics-spreads.vkf` | 310 | 5.737 ms | 5.347 ms | 7.804 ms | 18.844 ms | 18.536 ms | 20.861 ms | 100/100 identical |
| `core/22b-literal-spreads.vkf` | 52 | 2.810 ms | 2.645 ms | 3.856 ms | 19.252 ms | 18.942 ms | 22.216 ms | 100/100 identical |
| `core/23-shape-parameters.vkf` | 107 | 4.897 ms | 4.554 ms | 6.723 ms | 19.062 ms | 18.846 ms | 21.236 ms | 100/100 identical |
| `core/24-open-any.vkf` | 152 | 3.104 ms | 2.887 ms | 4.356 ms | 18.981 ms | 18.484 ms | 21.501 ms | 100/100 identical |
| `core/25-structural-compatibility.vkf` | 95 | 3.781 ms | 3.530 ms | 5.101 ms | 19.320 ms | 19.013 ms | 21.208 ms | 100/100 identical |
| `core/26-structural-conversions.vkf` | 87 | 10.689 ms | 5.192 ms | 43.582 ms | 19.147 ms | 18.660 ms | 21.220 ms | 100/100 identical |
| `core/27-structural-recursion.vkf` | 146 | 4.051 ms | 3.812 ms | 5.797 ms | 19.031 ms | 18.705 ms | 20.971 ms | 100/100 identical |
| `core/28-structural-records.vkf` | 105 | 4.754 ms | 4.476 ms | 6.492 ms | 19.054 ms | 18.646 ms | 21.824 ms | 100/100 identical |
| `core/29-structural-exact-match.vkf` | 96 | 2.837 ms | 2.662 ms | 3.948 ms | 19.175 ms | 18.807 ms | 21.479 ms | 100/100 identical |
| `core/30-math-structural.vkf` | 136 | 23.340 ms | 22.309 ms | 30.293 ms | 18.895 ms | 18.555 ms | 21.462 ms | 100/100 identical |
| `core/31-conditionals.vkf` | 91 | 3.407 ms | 3.213 ms | 4.539 ms | 19.040 ms | 18.595 ms | 22.118 ms | 100/100 identical |
| `core/32-match.vkf` | 158 | 3.709 ms | 3.506 ms | 4.995 ms | 18.963 ms | 18.566 ms | 21.177 ms | 100/100 identical |
| `core/33-loops.vkf` | 328 | 3.728 ms | 3.508 ms | 5.267 ms | 18.993 ms | 18.659 ms | 21.045 ms | 100/100 identical |
| `core/34-errors.vkf` | 104 | 24.758 ms | 23.641 ms | 29.563 ms | 18.949 ms | 18.481 ms | 21.311 ms | 100/100 identical |
| `core/35-pipes.vkf` | 79 | 7.968 ms | 7.522 ms | 10.936 ms | 19.045 ms | 18.627 ms | 21.471 ms | 100/100 identical |
| `core/36-pipe-blocks.vkf` | 89 | 17.703 ms | 9.877 ms | 48.250 ms | 19.042 ms | 18.810 ms | 21.468 ms | 100/100 identical |
| `core/37-operators.vkf` | 83 | 4.452 ms | 4.080 ms | 6.112 ms | 18.973 ms | 18.468 ms | 21.216 ms | 100/100 identical |
| `core/38-absolute-norm.vkf` | 22 | 2.067 ms | 1.938 ms | 2.850 ms | 18.953 ms | 18.632 ms | 21.186 ms | 100/100 identical |
| `core/39-overloads.vkf` | 192 | 4.335 ms | 4.124 ms | 5.689 ms | 19.031 ms | 18.945 ms | 21.253 ms | 100/100 identical |
| `core/40-fixed-shapes.vkf` | 102 | 2.821 ms | 2.686 ms | 3.781 ms | 18.950 ms | 18.811 ms | 20.910 ms | 100/100 identical |
| `core/41-indexing.vkf` | 95 | 3.942 ms | 3.717 ms | 5.407 ms | 19.050 ms | 18.664 ms | 21.330 ms | 100/100 identical |
| `core/42-axes.vkf` | 156 | 9.042 ms | 8.483 ms | 12.350 ms | 19.030 ms | 18.801 ms | 20.864 ms | 100/100 identical |
| `core/43-modules.vkf` | 50 | 40.475 ms | 38.377 ms | 52.219 ms | 18.741 ms | 18.386 ms | 21.348 ms | 100/100 identical |
| `core/44-shadowing.vkf` | 153 | 20.792 ms | 19.582 ms | 26.913 ms | 18.880 ms | 18.366 ms | 21.090 ms | 100/100 identical |
| `core/45-overloads-dispatch.vkf` | 127 | 18.547 ms | 6.087 ms | 41.767 ms | 18.935 ms | 18.613 ms | 20.543 ms | 100/100 identical |
| `core/46-member-reflection.vkf` | 155 | 13.970 ms | 13.424 ms | 16.376 ms | 19.354 ms | 19.128 ms | 21.606 ms | 100/100 identical |
| `core/47-primitive-spill.vkf` | 18 | 2.081 ms | 1.957 ms | 2.766 ms | 19.267 ms | 18.793 ms | 21.595 ms | 100/100 identical |
| `core/48-dot-overload.vkf` | 182 | 4.358 ms | 4.110 ms | 6.019 ms | 18.879 ms | 18.421 ms | 20.975 ms | 100/100 identical |
| `stdlib/01-math.vkf` | 76 | 22.345 ms | 21.294 ms | 29.168 ms | 19.040 ms | 18.895 ms | 21.425 ms | 100/100 identical |
| `stdlib/02-stat.vkf` | 239 | 9.155 ms | 8.648 ms | 12.563 ms | 18.904 ms | 18.723 ms | 21.197 ms | 100/100 identical |
| `stdlib/03-random.vkf` | 146 | 9.916 ms | 9.290 ms | 13.978 ms | 18.844 ms | 18.412 ms | 21.213 ms | 100/100 identical |
| `stdlib/04-time.vkf` | 175 | 81.633 ms | 78.890 ms | 94.312 ms | 19.777 ms | 19.377 ms | 22.286 ms | 100/100 identical |
| `stdlib/05-io.vkf` | 133 | 50.055 ms | 31.350 ms | 120.553 ms | 19.741 ms | 19.480 ms | 22.016 ms | 100/100 identical |
| `stdlib/06-collections.vkf` | 216 | 18.516 ms | 17.853 ms | 21.652 ms | 19.275 ms | 19.111 ms | 21.325 ms | 100/100 identical |
| `stdlib/07-errors.vkf` | 95 | 24.418 ms | 23.284 ms | 28.476 ms | 19.104 ms | 18.742 ms | 21.856 ms | 100/100 identical |
| `stdlib/08-system.vkf` | 132 | 5.476 ms | 5.050 ms | 7.471 ms | 18.999 ms | 18.646 ms | 21.619 ms | 100/100 identical |
| `stdlib/09-process.vkf` | 108 | 5.586 ms | 5.141 ms | 7.507 ms | 49.331 ms | 48.517 ms | 54.515 ms | 100/100 identical |
| `stdlib/10-regex.vkf` | 174 | 10.527 ms | 9.912 ms | 13.516 ms | 19.354 ms | 19.003 ms | 21.890 ms | 100/100 identical |

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

**stdout:** 113 bytes, SHA-256 `4a724ef320d0d289476ab3cb76370f9786f545ebf565961522f7852c6fa44ef4`

```text
windows
x86_64
4
C:\Users\RUNNER~1\AppData\Local\Temp\vkf-readme-proof-6DaUbC\runtime\stdlib\08-system
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
