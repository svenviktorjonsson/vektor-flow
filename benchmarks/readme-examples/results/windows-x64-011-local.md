# VKF 0.1.1 README example proof

Generated 2026-08-22T06:51:46.164Z. Every example was compiled from 100 fresh paths and executed in 100 fresh operating-system processes.

## Conditions

- OS: `win32 10.0.26200`
- Architecture: `x64`
- CPU: Intel(R) Core(TM) Ultra 7 255U (14 logical CPUs)
- Node timing host: `v24.11.0`
- Native compiler: 3990016 bytes, SHA-256 `1361ade39a6c9ef19f36e544726845e822ff4b6ffc2dbc32a7951097a217ba73`
- Compile: 1 warmup + 100 measured runs. one persistent native compiler process; fresh source path and emitted artifact for every sample.
- Compile scope: source read, lex, parse, native stdlib resolution, typed IR, machine lowering, executable emission; excludes compiler process startup.
- Runtime: 5 warmups + 100 measured runs. fresh operating-system process for every sample, with executable loading and stdout/stderr capture.
- Working directory: one isolated temporary directory per example, reused across its runs.

## Timing summary

| Example | Source bytes | Compile mean | Compile median | Compile p95 | Run mean | Run median | Run p95 | Output |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `core/01-bindings.vkf` | 72 | 6.916 ms | 6.296 ms | 13.324 ms | 37.669 ms | 33.786 ms | 59.077 ms | 100/100 identical |
| `core/02-bind-expression.vkf` | 27 | 6.341 ms | 5.588 ms | 11.177 ms | 37.699 ms | 34.816 ms | 55.847 ms | 100/100 identical |
| `core/03-blocks.vkf` | 345 | 12.792 ms | 11.235 ms | 20.216 ms | 37.011 ms | 34.316 ms | 49.883 ms | 100/100 identical |
| `core/04-output-assert.vkf` | 109 | 6.067 ms | 5.927 ms | 8.824 ms | 37.907 ms | 34.605 ms | 55.223 ms | 100/100 identical |
| `core/05-tagged-test.vkf` | 100 | 6.323 ms | 5.630 ms | 9.443 ms | 37.372 ms | 34.506 ms | 56.295 ms | 100/100 identical |
| `core/06-primitives.vkf` | 183 | 8.129 ms | 7.496 ms | 11.880 ms | 37.417 ms | 33.930 ms | 57.645 ms | 100/100 identical |
| `core/07-reflection.vkf` | 114 | 7.124 ms | 6.622 ms | 10.429 ms | 36.689 ms | 33.560 ms | 52.128 ms | 100/100 identical |
| `core/08-strings.vkf` | 153 | 7.795 ms | 7.040 ms | 12.881 ms | 37.159 ms | 33.258 ms | 51.794 ms | 100/100 identical |
| `core/09-tuples-records.vkf` | 142 | 8.696 ms | 7.896 ms | 13.632 ms | 38.404 ms | 33.742 ms | 72.016 ms | 100/100 identical |
| `core/11-vectors.vkf` | 128 | 8.391 ms | 7.604 ms | 15.762 ms | 38.051 ms | 33.863 ms | 54.388 ms | 100/100 identical |
| `core/12-vector-concat.vkf` | 98 | 7.821 ms | 7.378 ms | 12.152 ms | 38.617 ms | 33.654 ms | 69.970 ms | 100/100 identical |
| `core/12b-container-stress.vkf` | 306 | 9.255 ms | 8.524 ms | 12.992 ms | 105.330 ms | 97.657 ms | 139.418 ms | 100/100 identical |
| `core/13-updates-aliases.vkf` | 103 | 7.634 ms | 7.000 ms | 11.182 ms | 38.167 ms | 35.312 ms | 59.737 ms | 100/100 identical |
| `core/14-multisets.vkf` | 125 | 9.334 ms | 8.601 ms | 15.666 ms | 34.793 ms | 31.579 ms | 53.689 ms | 100/100 identical |
| `core/15-ranges.vkf` | 32 | 7.355 ms | 6.002 ms | 12.587 ms | 35.662 ms | 32.050 ms | 53.216 ms | 100/100 identical |
| `core/16-complex.vkf` | 40 | 7.246 ms | 6.177 ms | 10.568 ms | 36.438 ms | 33.269 ms | 55.983 ms | 100/100 identical |
| `core/17-equality.vkf` | 62 | 7.242 ms | 6.631 ms | 10.900 ms | 36.517 ms | 32.767 ms | 56.551 ms | 100/100 identical |
| `core/18-functions.vkf` | 135 | 9.889 ms | 9.306 ms | 14.932 ms | 36.629 ms | 32.753 ms | 56.880 ms | 100/100 identical |
| `core/19-call-arguments.vkf` | 149 | 8.012 ms | 7.545 ms | 11.460 ms | 38.906 ms | 34.117 ms | 63.202 ms | 100/100 identical |
| `core/20-recursion-closures.vkf` | 241 | 8.893 ms | 8.098 ms | 12.419 ms | 38.126 ms | 33.485 ms | 77.874 ms | 100/100 identical |
| `core/21-lambdas.vkf` | 210 | 15.962 ms | 15.336 ms | 31.855 ms | 38.003 ms | 32.980 ms | 70.375 ms | 100/100 identical |
| `core/22-variadics-spreads.vkf` | 310 | 8.768 ms | 8.128 ms | 12.375 ms | 39.450 ms | 34.577 ms | 57.416 ms | 100/100 identical |
| `core/22b-literal-spreads.vkf` | 52 | 5.854 ms | 5.498 ms | 10.399 ms | 38.076 ms | 35.150 ms | 58.324 ms | 100/100 identical |
| `core/23-shape-parameters.vkf` | 107 | 6.795 ms | 6.253 ms | 9.644 ms | 38.448 ms | 35.314 ms | 57.484 ms | 100/100 identical |
| `core/24-open-any.vkf` | 152 | 6.466 ms | 5.925 ms | 9.422 ms | 39.878 ms | 33.473 ms | 65.698 ms | 100/100 identical |
| `core/25-structural-compatibility.vkf` | 128 | 6.618 ms | 6.162 ms | 10.038 ms | 38.890 ms | 33.487 ms | 66.683 ms | 100/100 identical |
| `core/26-structural-conversions.vkf` | 179 | 8.806 ms | 8.352 ms | 14.821 ms | 37.530 ms | 34.096 ms | 54.697 ms | 100/100 identical |
| `core/27-structural-recursion.vkf` | 150 | 6.770 ms | 6.247 ms | 10.373 ms | 37.014 ms | 34.325 ms | 52.783 ms | 100/100 identical |
| `core/28-structural-records.vkf` | 251 | 9.239 ms | 7.926 ms | 16.660 ms | 38.026 ms | 34.906 ms | 51.775 ms | 100/100 identical |
| `core/29-structural-exact-match.vkf` | 96 | 6.804 ms | 6.042 ms | 10.608 ms | 39.265 ms | 34.720 ms | 61.750 ms | 100/100 identical |
| `core/30-math-structural.vkf` | 153 | 33.712 ms | 29.928 ms | 53.295 ms | 38.598 ms | 33.907 ms | 65.927 ms | 100/100 identical |
| `core/31-conditionals.vkf` | 91 | 6.408 ms | 5.710 ms | 12.293 ms | 41.278 ms | 33.943 ms | 76.654 ms | 100/100 identical |
| `core/32-match.vkf` | 158 | 7.132 ms | 6.290 ms | 12.232 ms | 36.391 ms | 33.191 ms | 53.945 ms | 100/100 identical |
| `core/33-loops.vkf` | 324 | 8.323 ms | 7.425 ms | 14.754 ms | 36.504 ms | 33.748 ms | 49.652 ms | 100/100 identical |
| `core/34-errors.vkf` | 130 | 8.639 ms | 8.171 ms | 13.966 ms | 37.539 ms | 34.164 ms | 50.912 ms | 100/100 identical |
| `core/35-pipes.vkf` | 79 | 6.662 ms | 5.828 ms | 11.820 ms | 38.531 ms | 33.633 ms | 53.932 ms | 100/100 identical |
| `core/36-pipe-blocks.vkf` | 89 | 8.768 ms | 8.202 ms | 13.619 ms | 37.237 ms | 33.497 ms | 54.702 ms | 100/100 identical |
| `core/37-operators.vkf` | 83 | 7.307 ms | 6.543 ms | 11.592 ms | 37.620 ms | 32.978 ms | 67.717 ms | 100/100 identical |
| `core/38-absolute-norm.vkf` | 22 | 5.873 ms | 5.020 ms | 11.948 ms | 38.358 ms | 33.611 ms | 56.795 ms | 100/100 identical |
| `core/39-overloads.vkf` | 192 | 8.904 ms | 7.799 ms | 14.630 ms | 39.083 ms | 33.221 ms | 66.862 ms | 100/100 identical |
| `core/40-fixed-shapes.vkf` | 102 | 6.993 ms | 6.040 ms | 10.917 ms | 40.341 ms | 33.753 ms | 69.753 ms | 100/100 identical |
| `core/41-indexing.vkf` | 95 | 6.969 ms | 6.511 ms | 11.315 ms | 39.403 ms | 33.857 ms | 62.175 ms | 100/100 identical |
| `core/42-axes.vkf` | 156 | 8.686 ms | 7.972 ms | 13.302 ms | 40.267 ms | 33.764 ms | 67.295 ms | 100/100 identical |
| `core/43-modules.vkf` | 50 | 57.861 ms | 51.735 ms | 102.380 ms | 39.228 ms | 33.687 ms | 78.499 ms | 100/100 identical |
| `core/44-shadowing.vkf` | 153 | 29.428 ms | 26.035 ms | 55.003 ms | 38.712 ms | 34.057 ms | 74.084 ms | 100/100 identical |
| `core/45-overloads-dispatch.vkf` | 127 | 8.308 ms | 7.700 ms | 15.674 ms | 38.762 ms | 33.512 ms | 63.704 ms | 100/100 identical |
| `core/46-member-reflection.vkf` | 155 | 6.119 ms | 5.587 ms | 10.378 ms | 37.997 ms | 34.606 ms | 56.863 ms | 100/100 identical |
| `core/47-primitive-spill.vkf` | 18 | 4.883 ms | 4.103 ms | 9.236 ms | 36.705 ms | 33.487 ms | 53.062 ms | 100/100 identical |
| `core/48-dot-overload.vkf` | 182 | 6.962 ms | 6.042 ms | 14.578 ms | 39.700 ms | 33.469 ms | 56.559 ms | 100/100 identical |
| `stdlib/01-math.vkf` | 76 | 28.340 ms | 25.065 ms | 50.499 ms | 38.649 ms | 33.962 ms | 59.477 ms | 100/100 identical |
| `stdlib/02-stat.vkf` | 126 | 6.443 ms | 5.808 ms | 10.761 ms | 37.393 ms | 33.359 ms | 64.198 ms | 100/100 identical |
| `stdlib/03-random.vkf` | 146 | 11.471 ms | 10.448 ms | 18.442 ms | 37.646 ms | 33.879 ms | 57.732 ms | 100/100 identical |
| `stdlib/04-time.vkf` | 175 | 37.068 ms | 32.901 ms | 71.976 ms | 37.935 ms | 34.064 ms | 53.886 ms | 100/100 identical |
| `stdlib/05-io.vkf` | 133 | 10.030 ms | 9.255 ms | 14.405 ms | 41.263 ms | 37.812 ms | 58.223 ms | 100/100 identical |
| `stdlib/06-collections.vkf` | 216 | 9.075 ms | 8.157 ms | 14.349 ms | 37.858 ms | 34.048 ms | 59.379 ms | 100/100 identical |
| `stdlib/07-errors.vkf` | 94 | 8.197 ms | 7.393 ms | 13.628 ms | 36.581 ms | 33.477 ms | 50.620 ms | 100/100 identical |
| `stdlib/08-system.vkf` | 132 | 9.654 ms | 8.904 ms | 17.450 ms | 37.621 ms | 33.871 ms | 54.175 ms | 100/100 identical |
| `stdlib/09-process.vkf` | 108 | 9.122 ms | 8.550 ms | 15.637 ms | 101.057 ms | 91.318 ms | 158.281 ms | 100/100 identical |
| `stdlib/10-regex.vkf` | 174 | 9.543 ms | 8.439 ms | 15.159 ms | 38.202 ms | 34.319 ms | 57.175 ms | 100/100 identical |

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

**stdout:** 4 bytes, SHA-256 `d91a915db080736443c7b2fa55b70a31d2e4cddb9182844bb91e04897b9d4598`

```text
14
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

**stdout:** 10 bytes, SHA-256 `144ea70cb99f4a85424cda21cf548d39d329898b446ae22edac177c4f15805ae`

```text
20000000
```

**stderr:** empty (0 bytes)

### `core/13-updates-aliases.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 8 bytes, SHA-256 `a6bdcb4daac06ef7e95dcc163db40e728a02c2eddb96f1b7741271b2d27561d7`

```text
[3, 4]
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

**stdout:** 39 bytes, SHA-256 `73e51910aae6f573d0fa62ccb5a51426e7f6f2e0482aec1d16676e6568920ae8`

```text
(name:origin, enabled:true, x:4, y:6)
```

**stderr:** empty (0 bytes)

### `core/26-structural-conversions.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 74 bytes, SHA-256 `bf76c34c008916ada2680b625b338e57df74980708c47069507855cecfb93f45`

```text
(name:sample, whole:4, fraction:1.5)
(name:only metadata, enabled:true)
```

**stderr:** empty (0 bytes)

### `core/27-structural-recursion.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 58 bytes, SHA-256 `2e6a032c4069129ae25e67efc7f0b011a25141d36f957048d10da6f247751cf4`

```text
[(name:a, point:(x:2, y:3)), (name:b, point:(x:4, y:5))]
```

**stderr:** empty (0 bytes)

### `core/28-structural-records.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 42 bytes, SHA-256 `0aedd1f9d3d240ea89c2e2e9e0337e060927924a56b7aded1f5782169e665833`

```text
[(x:11, y:-8), (x:13, y:-6)]
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

**stdout:** 143 bytes, SHA-256 `20a11ae1cdccdbd2e2ea6ac96da7a409b2c76dc8fa52a4e9939fdd18c58665df`

```text
(name:measurements, values:[1, 4, 9], nested:(x:16, label:kept))
(name:measurements, values:[-1.#IND, 2, 3], nested:(x:-1.#IND, label:kept))
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

**stdout:** 18 bytes, SHA-256 `33d0f71a7d3e77d5060efb56c96dd5ea9625a3ad1dc0db6bc4dc91d6d9d153b8`

```text
expected failure
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

**stdout:** 12 bytes, SHA-256 `b73956c4666601bd0e46e4a449442ba870a0806b3363ed2206e2d940203f706d`

```text
5
4
2
7
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

**stdout:** 118 bytes, SHA-256 `3c56bb66ee9888eeeb783ec04437f8f78d8b32068e4029ac1125c4496c06582b`

```text
windows
x86_64
14
C:\Users\VIKTOR~1.JON\AppData\Local\Temp\vkf-readme-proof-ggFP3D\runtime\stdlib\08-system
true
```

**stderr:** empty (0 bytes)

### `stdlib/09-process.vkf`

Exit code: `0`. Output stability: 100/100 byte-identical measured runs.

**stdout:** 37 bytes, SHA-256 `e6e1d3a64bfe1992acdad546ba67161fbe7f3cb4ce0cd19b82d8de5e5cc26efd`

```text
0
git version 2.51.2.windows.1


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
