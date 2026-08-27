# VKF 0.3.0 documented-program proof

Generated 2026-08-27T16:53:11.719Z. Every example was compiled from 10 fresh paths and executed in 10 fresh operating-system processes.

## Conditions

- OS: `win32 10.0.26200`
- Architecture: `x64`
- CPU: Intel(R) Core(TM) Ultra 7 255U (14 logical CPUs)
- Native compiler: 5490688 bytes, SHA-256 `4fac14d0cc8a7054a74375484469e036f666136f5da42e4aff0fb9dc50d12bc5`
- Compile verification: 10 fresh source paths per example.
- Runtime verification: 10 fresh-process runs per example.
- Working directory: one isolated temporary directory per example, reused across its runs.

## Output stability

| Example | Source bytes | Source SHA-256 | Output |
| --- | ---: | --- | --- |
| `core/01-bindings.vkf` | 73 | `1a692e29ebcfe2cbdb3486cc44bf390ff39e4b0f11732942a86b218aeb265324` | 10/10 identical |
| `core/02-bind-expression.vkf` | 27 | `3053708ebf0df7c8eb9a3304dca3c081224269beba850fb61f5ec0185c9f1000` | 10/10 identical |
| `core/03-blocks.vkf` | 293 | `f729c4f80d516f738b6c81d5a57e5a63620aa50b147ceb88f6ecd9cd5788fe49` | 10/10 identical |
| `core/04-output-assert.vkf` | 216 | `6133307be018524d3d6e9d346644bc6d633197a981c5a29630a445215087022b` | 10/10 identical |
| `core/05-tagged-test.vkf` | 87 | `c89c185feb14f66475689d8a09597d7fb81bcb7fb3bede649574fa8bad72ecf1` | 10/10 identical |
| `core/06-primitives.vkf` | 177 | `9db213eba249a00f60296ac68f37168fe191cda643089a27bbd267f32cd5aedf` | 10/10 identical |
| `core/07-reflection.vkf` | 106 | `77521b190822276fc9da8b34e2cd93d062c8b31d7863957fcc992b07c6912bd8` | 10/10 identical |
| `core/08-strings.vkf` | 235 | `cac592d6dbef73c0ee610d897d940ef9554e32ebac482a7e732598dbaeac6b65` | 10/10 identical |
| `core/09-tuples-records.vkf` | 142 | `0f3e3ed467848ffd14b84adbc15dd88c6d007757c5eedeb1fa648c981ceea7bd` | 10/10 identical |
| `core/11-vectors.vkf` | 128 | `91ba75d0c02154ddf7ec7041b1421c95ee3f83238d0da6d202ef37db6244e7a9` | 10/10 identical |
| `core/11b-multidimensional-indexing.vkf` | 251 | `b33f27a8ca29d12b0eee52a4f24b747407720db2542def34d36636be948f3937` | 10/10 identical |
| `core/12-vector-concat.vkf` | 98 | `6ec65ae4b634d2b85562d3e0b5d9a7f5ca7d781cd1c04ce2c590457eccf1b722` | 10/10 identical |
| `core/12b-container-stress.vkf` | 293 | `bf3c965556890065ef1fe81d6b8166dd5ce685a436546991236b4b1c5d7d7efb` | 10/10 identical |
| `core/13-updates-aliases.vkf` | 285 | `8ccd577e29054c40404ad032afa2ee093381dcd44ef8fb64a1b4c81a3652a596` | 10/10 identical |
| `core/14-multisets.vkf` | 125 | `8dd5f741ac6308aaa8c8970ec3693dd0fa0abae94ad5045e186f16d758178387` | 10/10 identical |
| `core/15-ranges.vkf` | 32 | `d0bade9480353ce3267722d323c8f402b4f78c7193d632087aafb5574f11a6c2` | 10/10 identical |
| `core/16-complex.vkf` | 40 | `69e222aee88f9423ab9f56b71081077f7428da7f70ba87abeb2b013286426fca` | 10/10 identical |
| `core/17-equality.vkf` | 62 | `72aed102ae5056895331aad9a9b3724886654f712c12392f356651a2a152d325` | 10/10 identical |
| `core/18-functions.vkf` | 129 | `167cc9055ffb0c16cebaed677cbc92bebb03317be462ba19ecd9333261946321` | 10/10 identical |
| `core/19-call-arguments.vkf` | 143 | `3cab3ee2dce888d362ea449b6326761a50814f7ce0314782b53a1bf0113ad10a` | 10/10 identical |
| `core/20-recursion-closures.vkf` | 231 | `a87292281f84e72801d7ac887bd350bc4d5cdfef0f5c20f1b3c0176b204c7e7f` | 10/10 identical |
| `core/21-lambdas.vkf` | 197 | `3259192f9d957e21db61bfb66b74a4231454fa5aee601e280dec7e1bff7cd752` | 10/10 identical |
| `core/22-variadics-spreads.vkf` | 290 | `be46ca658c33fa2c75db14201b4575876637b7413fa9f721b3a4889566f4dc2d` | 10/10 identical |
| `core/22b-literal-spreads.vkf` | 52 | `8132a06e57a169e7f1ab019ce632c654bd653d5db4f2d2f6541ef1daa8b91d8f` | 10/10 identical |
| `core/23-shape-parameters.vkf` | 101 | `0f45ab27e53bb269311b6ab5c741577069baa4177349841ab20ca320ac478149` | 10/10 identical |
| `core/24-open-any.vkf` | 139 | `0cb1ba44763160750756dd7b5b9844977af81830b793e69ba568f35b3c80e32e` | 10/10 identical |
| `core/25-structural-compatibility.vkf` | 89 | `fac28a35734ce3674204629f8c04d07c9a6ba0ac792149bf71120f12c9124710` | 10/10 identical |
| `core/26-structural-conversions.vkf` | 74 | `c6b8cbd1b0ecc0a0f8e0d8a6ed9fc07093dd5426264d89669382dfe14f191072` | 10/10 identical |
| `core/27-structural-recursion.vkf` | 140 | `29509002b289765897e97d417f5f257607779edb503b0e2ef3417a25493c57d2` | 10/10 identical |
| `core/28-structural-records.vkf` | 99 | `65edf8c60ec57176a6c5c9e8255e6e2b5695b82aba787c356d078b2b273786a5` | 10/10 identical |
| `core/29-structural-exact-match.vkf` | 90 | `925f350b82a1254d740016f808beea34b2630644508805664d1152e3f3902aca` | 10/10 identical |
| `core/30-math-structural.vkf` | 136 | `ae69a2867ce49f9b7f3bd2d11815a0fc00c911d52f41f02ab0bb02503bded644` | 10/10 identical |
| `core/31-conditionals.vkf` | 91 | `04878c1f51acb3b4e2af4e45503b835e38c82f74237d82e401f7b17bd47266bf` | 10/10 identical |
| `core/32-match.vkf` | 158 | `bd02267c4033d780fa49db68f9ec98acd9d365050d3681adf8ac6f3cde89a5a6` | 10/10 identical |
| `core/33-loops.vkf` | 291 | `7a27f1ac8b63ede227f0690005eec0523ebef10aee6b1c5bdfbe9a55ac8da3ae` | 10/10 identical |
| `core/34-errors.vkf` | 104 | `3373c890f6e39682fd9b54acf5fa4778a41b3b6ae77cc137dc8cbd5e2edc25c3` | 10/10 identical |
| `core/35-pipes.vkf` | 79 | `dfff52f9d9f51c5739f09c4b5ab93ca20971d93b0112bb842c7180be3ca1cc0b` | 10/10 identical |
| `core/36-pipe-blocks.vkf` | 87 | `698e3a016927b20f0a94512a50e2670bceace0c2c71f1b2a0657519b6bec777c` | 10/10 identical |
| `core/36b-pipe-assignment.vkf` | 113 | `2b5b7a746079ef5b6dcca90393711be73a4c5f0a0cb31d406f47cddc19e914d5` | 10/10 identical |
| `core/37-operators.vkf` | 83 | `0d68eaedc20c2c30e6fe95fddebec88c87c9d079bfca6cb19a8dd9e3cccd39bd` | 10/10 identical |
| `core/38-absolute-norm.vkf` | 22 | `e4e29d93d9e886e007965e7fe290ec3196b59023c2c65ab9c7ec3fd25429be66` | 10/10 identical |
| `core/39-overloads.vkf` | 179 | `239a436a9f0ae2b70c7f96335ec0393c136757533b05a095756a96f32ce17153` | 10/10 identical |
| `core/40-fixed-shapes.vkf` | 94 | `5ea529ea1088f52a5eccaf05db3fe50b4411b5d6086aae6a60caaa1403cf2260` | 10/10 identical |
| `core/41-indexing.vkf` | 111 | `4beb9d01a8d0f2434ff6eebd94caa12fe617bee1c02d05f7abc06b81d7964165` | 10/10 identical |
| `core/42-axes.vkf` | 156 | `eb4f7f399e29ee754730eb5125b422690aff47802f6b454fe59f534a22434d85` | 10/10 identical |
| `core/43-modules.vkf` | 50 | `88c88a727af79c8ad4ee03833db0158d700dc330d75fc15e77d67e8eefa01b58` | 10/10 identical |
| `core/44-shadowing.vkf` | 147 | `423f2dd12735fb7ab14c6303620a8c50fd4e2c87f6b40628dd10fdc6143f45e9` | 10/10 identical |
| `core/45-overloads-dispatch.vkf` | 114 | `ddec50d82d6d27dcb4af403648d78949c2ffc41b02310dd59d095e4301bd2231` | 10/10 identical |
| `core/46-member-reflection.vkf` | 155 | `c465d419fbc2eeebab6e651a92a2376b57a881232287cc77fffe85ac3fb34c93` | 10/10 identical |
| `core/47-primitive-spill.vkf` | 18 | `2eaa791cfb4aa0b87d12028158197dbd65112ec268b80a4fbf1a396b37addb1b` | 10/10 identical |
| `core/48-dot-overload.vkf` | 182 | `71956fe08206241b4e1259a2372fd86205eff328de903726ac91e87869e76fab` | 10/10 identical |
| `core/49-nominal-constructors.vkf` | 382 | `833d24804bd21ab74e6da1f1b11714eab2867ecdd26b308ffe9714afd69ea7ae` | 10/10 identical |
| `core/49-semicolon-pipes.vkf` | 135 | `e7a83488ce50b309da8cfc81f435114d9c0eb3d89b183bdc64aa19607fd204aa` | 10/10 identical |
| `core/50-generic-types.vkf` | 259 | `39dbd3c5416f4bcdc3853c35285957c5f51608d3217ea55a58881f6aab8284d0` | 10/10 identical |
| `stdlib/01-math.vkf` | 76 | `648f56448a3be2717fdae38bde63f532fc0fe43307f681513deefb3772e3809f` | 10/10 identical |
| `stdlib/02-stat.vkf` | 239 | `1ecf8a7365dd728a0ef780087e1e6f542969bfc325ad715bae4fa87834c30bec` | 10/10 identical |
| `stdlib/03-random.vkf` | 146 | `c0f6c8514b4afedc7f727ac7a45dbe83c3492a26355866a61c5d3e0a4683f9c9` | 10/10 identical |
| `stdlib/04-time.vkf` | 175 | `51823bfc80b32b779ef5a52be6f4ca6539808ee478fb5829527147e513bec960` | 10/10 identical |
| `stdlib/05-io.vkf` | 133 | `4acc12b3b0ae173316afd56b158a13cdc2e79a606e2282182afbd7de42df1157` | 10/10 identical |
| `stdlib/06-collections.vkf` | 216 | `1882a6ec40607edeaa9fa54db82d6a21aa6d40e572be70e57947d6bceda0742a` | 10/10 identical |
| `stdlib/07-errors.vkf` | 95 | `8fea9dd54b580913802ea5173fe75c6b0f401c3cd104c548a57a07180571b7ab` | 10/10 identical |
| `stdlib/08-system.vkf` | 132 | `d8799b0ba15364abc91002d6a4fe0c2f62100dd0ddf4e3e1bbaf27a6acd76268` | 10/10 identical |
| `stdlib/09-process.vkf` | 108 | `f11a54f8f0759cc03d369311cf188d07bf34b657563a977d03717ace236db5cc` | 10/10 identical |
| `stdlib/10-regex.vkf` | 174 | `e5e8411698b53871f0d7035a2845f9bef69974f60caa2f47b92b8f74d21ab6d5` | 10/10 identical |
| `stdlib/11-linalg.vkf` | 221 | `4fae95a6440fb0cd610437afb6ab13ca974475956ac66ddcb39a43f9a45c1bd3` | 10/10 identical |
| `stdlib/11-physics.vkf` | 112 | `7809067a744ac674ea9aee4f3333d2445dde810b806a8b075823a760a3678072` | 10/10 identical |
| `stdlib/12-symbolic.vkf` | 214 | `eae1278c5c02be549f608383dc6801ee63747a83804d37108c84af4bd5b9af93` | 10/10 identical |

## Exact output

### `core/01-bindings.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 6 bytes, SHA-256 `8ef9de27cf321edf99829555463b08b27750fe114d01053a39c7a6ec60c2f73c`

```text
7
6
```

**stderr:** empty (0 bytes)

### `core/02-bind-expression.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 6 bytes, SHA-256 `722b3a2c262caef957158f2efe473dad62c49b3ed1f73593bf789916eb5d799e`

```text
3
4
```

**stderr:** empty (0 bytes)

### `core/03-blocks.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 42 bytes, SHA-256 `c9059569507a4ed7e7c4adbf89e047e9ec2194eb22ed762ff83f47a597ff2c0d`

```text
hello world
make_base(x:3, y:4)
3
red
```

**stderr:** empty (0 bytes)

### `core/04-output-assert.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 4 bytes, SHA-256 `9e4c59bb9e5ca6ca840eb57555c3f45692474ff6c1379d3579eec60e18667cbe`

```text
42
```

**stderr:** empty (0 bytes)

### `core/05-tagged-test.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** empty (0 bytes)

**stderr:** empty (0 bytes)

### `core/06-primitives.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

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

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 45 bytes, SHA-256 `9f87120bf041125766be0402de6b4b7b8fe2581e1030f705ed5cf3e136d8d558`

```text
4
type
[int:2]
TypeScope(reflected:type)
```

**stderr:** empty (0 bytes)

### `core/08-strings.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 74 bytes, SHA-256 `3bd9821382a4c399f33f1307de186a83ce794b5569f7e15a29c96634b0589491`

```text
Hej världen
value=4.23
sum=5 point=(x:2, y:false) cost=$5
😀
true
```

**stderr:** empty (0 bytes)

### `core/09-tuples-records.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 16 bytes, SHA-256 `22a33ca27f7112254d238df755e89c6286972b627a8991601c4635797f436f6b`

```text
12
origin
12
```

**stderr:** empty (0 bytes)

### `core/11-vectors.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 43 bytes, SHA-256 `5ecd52c0a916e2176f0cb2bc2c9d7b616b8633440c565563d2ca5182b24096ef`

```text
[1, 2, 3]
[4, 20, 6]
[7, 7, 7, 7, 9, 9]
```

**stderr:** empty (0 bytes)

### `core/11b-multidimensional-indexing.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 42 bytes, SHA-256 `8694a8d58ee4bc4562f062dd6d9b70723f1c2b32d707040aeb1369d9f1de87c0`

```text
11
11
[1, 13, 21]
[[2, 12], [22, 32]]
```

**stderr:** empty (0 bytes)

### `core/12-vector-concat.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 22 bytes, SHA-256 `8811ce8c596404089b299583392f8c4664d1effb71fa0bd9ee0e73e80778f4d8`

```text
[1, 2, 3]
[1, 2, 3]
```

**stderr:** empty (0 bytes)

### `core/12b-container-stress.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 10 bytes, SHA-256 `0bd8ccdc7e1dae22f79eb67dab29b4e0373b06a2add164697b04abf307edcac3`

```text
10000000
```

**stderr:** empty (0 bytes)

### `core/13-updates-aliases.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 35 bytes, SHA-256 `bc8fe972612f0fbd38b39e6a8174f6dd5f235a6bb3a306ed383115e01784c9ef`

```text
[3, 4]
(x:5, y:6, name:my point)
```

**stderr:** empty (0 bytes)

### `core/14-multisets.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 43 bytes, SHA-256 `ee4c737983c7e65e4b0975bf781147266b0bc9df4fc1e48f8633a4d1bb0165d1`

```text
{a:7, b:1, c:2}
{a:1, b:1}
{a:2}
{a:1}
```

**stderr:** empty (0 bytes)

### `core/15-ranges.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 42 bytes, SHA-256 `5e2847062d2a365ad8f24784cf2056dd91d4720fcf59ee4cfe2074b0367d94c5`

```text
[0, 1, 2, 3]
[3, 2, 1, 0]
(1, 2, 3, 4)
```

**stderr:** empty (0 bytes)

### `core/16-complex.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 17 bytes, SHA-256 `680ea1fe10308a91ef24312a5b52ec44074e698274919dbe27738aa13bfc32df`

```text
1 + 2i
-3 + 4i
```

**stderr:** empty (0 bytes)

### `core/17-equality.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 14 bytes, SHA-256 `725ac9c60c70b7263ccead3bac3923d919af6fe5964230a1a332d7b64ddec9c0`

```text
1
1
[1, 1]
```

**stderr:** empty (0 bytes)

### `core/18-functions.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 12 bytes, SHA-256 `88f8d52ecf0bdea31a88d56cc23e9f66167f7369317467f2bf597816645d66ca`

```text
7
3
null
```

**stderr:** empty (0 bytes)

### `core/19-call-arguments.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 15 bytes, SHA-256 `7a202ae470e1074ad2ebdb4498025f914a0e4af3473b9b616cae06eba0136055`

```text
234
345
345
```

**stderr:** empty (0 bytes)

### `core/20-recursion-closures.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 8 bytes, SHA-256 `8a599d1ccf14566a5ce9bc8930099d0daddfa36030fa719a6d6f3d232f5f0a5f`

```text
720
7
```

**stderr:** empty (0 bytes)

### `core/21-lambdas.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 11 bytes, SHA-256 `0238bcde0dbdaf471e3a4165547f00d30f982bf62faea7842cf4080d6ad99caa`

```text
10
25
9
```

**stderr:** empty (0 bytes)

### `core/22-variadics-spreads.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 31 bytes, SHA-256 `445dbb647500e08ce6575d31fdf35eeb212a914f314edf9349cd78ea43b1fe24`

```text
10
7
(flag:true, mode:fast)
```

**stderr:** empty (0 bytes)

### `core/22b-literal-spreads.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 17 bytes, SHA-256 `53c5b5f1a9aa878f83be1316c8e19b9718937ca0237d9a8200362f2ddb28f9f6`

```text
[1, 2, 3, 4]
4
```

**stderr:** empty (0 bytes)

### `core/23-shape-parameters.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 17 bytes, SHA-256 `93183e3a20daa4bf1fc9c0bb69613ee80fc36bc825014fef709b545f0684f986`

```text
[1, 2, 3, 4, 5]
```

**stderr:** empty (0 bytes)

### `core/24-open-any.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 6 bytes, SHA-256 `420f41b538531803a38b2eeb5698105ade7841ef55d453d3159fb26dbb1d64e8`

```text
2
7
```

**stderr:** empty (0 bytes)

### `core/25-structural-compatibility.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 29 bytes, SHA-256 `bd97c1fd7577bdcdda85bf174745041573cb3163a39071b0bb92696022dc7583`

```text
[2, 4, 6]
[[2, 4], [6, 8]]
```

**stderr:** empty (0 bytes)

### `core/26-structural-conversions.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 14 bytes, SHA-256 `7ed67bfcf59158c158a8870a131071074c4aa25479c7b7647602da403a534004`

```text
[4, 1.5, -2]
```

**stderr:** empty (0 bytes)

### `core/27-structural-recursion.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 30 bytes, SHA-256 `dc8976f59f6b2a0cae761cdbab66d6f4e6a662f6de162b75684a24b9a41d75e1`

```text
[(x:11, y:-8), (x:13, y:-6)]
```

**stderr:** empty (0 bytes)

### `core/28-structural-records.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 12 bytes, SHA-256 `d80aa4acb2bbc74db92036c90caec185be4f57a94e780877de8589e141d0797e`

```text
[3, 7, 11]
```

**stderr:** empty (0 bytes)

### `core/29-structural-exact-match.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 11 bytes, SHA-256 `98ae8ee5435ebd22c076505f24016d49f8741b42750dbcc7d29d46ac7ca2b156`

```text
[2, 3, 1]
```

**stderr:** empty (0 bytes)

### `core/30-math-structural.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 37 bytes, SHA-256 `dd6b5907e1a9644cf01b4ca3b799c849e1842328aa2a419f560ef4fe0b71fa37`

```text
[[1, 4], [9, 16]]
[[1, 2], [3, 4]]
```

**stderr:** empty (0 bytes)

### `core/31-conditionals.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 12 bytes, SHA-256 `54682ccb66344d62d4585486e73ceced88beda0e1087147a70489328e2f992ac`

```text
1
1.#QNAN
```

**stderr:** empty (0 bytes)

### `core/32-match.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 30 bytes, SHA-256 `e2a4842cc8b38b2f855dc94cce8ddd3694b27c482e473373a5618e65476fed79`

```text
exact three
another integer
```

**stderr:** empty (0 bytes)

### `core/33-loops.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 7 bytes, SHA-256 `57c4833ba4ec5c982a7f0a78e208a914961004c02634d99166644a56ae36dfdc`

```text
10
2
```

**stderr:** empty (0 bytes)

### `core/34-errors.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 16 bytes, SHA-256 `31df944cde860415597b2bf00862d5d78e48dc2c1dba6d02dce9c68390629edb`

```text
specific value
```

**stderr:** empty (0 bytes)

### `core/35-pipes.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 37 bytes, SHA-256 `8ae767b7255cfb15d616cb44d1a5ad1d6f43df34422e8021960892d834a31fba`

```text
[2, 4, 6]
(11, 12, 13)
16
ååAA
```

**stderr:** empty (0 bytes)

### `core/36-pipe-blocks.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 15 bytes, SHA-256 `359b322fcf9e7f0a1832df387664a4c9f6478eeedb6928ec2f8dc0ee5dcd575a`

```text
[1, 20, 3, 4]
```

**stderr:** empty (0 bytes)

### `core/36b-pipe-assignment.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 32 bytes, SHA-256 `83f1e83cc03a0ce741030baab85352f4137365a499d4fe55d215f447c7d8f2b7`

```text
[4, 3, 2, 1]
(40, 30, 20, 10)
```

**stderr:** empty (0 bytes)

### `core/37-operators.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

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

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 6 bytes, SHA-256 `e53ee59797fb8eaa96e37638df95094f56f0b7ce7beb19e8cbc6a3e0f0ed84d2`

```text
5
5
```

**stderr:** empty (0 bytes)

### `core/39-overloads.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 26 bytes, SHA-256 `47e44c38aa327b833a612a5be4ad129d0fbf498fa65324668ccbad8643753006`

```text
(x:4, y:6)
(x:-3, y:-4)
```

**stderr:** empty (0 bytes)

### `core/40-fixed-shapes.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 3 bytes, SHA-256 `7fb2aaeaf3eef66b52db104118c30f62899f5f0df520350a94a8fcb843c0dfdf`

```text
5
```

**stderr:** empty (0 bytes)

### `core/41-indexing.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 32 bytes, SHA-256 `236f81dcc83ad0ac193211217925c3b9f3e3aeb3fe3993f6cc35007c301ba34b`

```text
20
[10, 30]
[10, 21, 30, 41]
```

**stderr:** empty (0 bytes)

### `core/42-axes.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 94 bytes, SHA-256 `bf151195989fea722be6c3afce050c8400c22b89f65e3208616637f9139e7d30`

```text
[[1, 2, 3], [2, 4, 6], [3, 6, 9]]
[4, 10, 18]
[[[15, 18], [20, 24]], [[30, 36], [40, 48]]]
```

**stderr:** empty (0 bytes)

### `core/43-modules.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 6 bytes, SHA-256 `fc32717c04f9e2f742a0fd75e4a30c2999db1360c8395fef7fa2260fcc0258d1`

```text
3
1
```

**stderr:** empty (0 bytes)

### `core/44-shadowing.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 6 bytes, SHA-256 `c8aace42342a3de458a51ed77e337205f57b20a220398f05054f2a2d2f9bdb83`

```text
0
4
```

**stderr:** empty (0 bytes)

### `core/45-overloads-dispatch.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 15 bytes, SHA-256 `96fba1069b68a627afcdac3fcca52aa8249dee0247718c131ffec617966fb77b`

```text
integer
text
```

**stderr:** empty (0 bytes)

### `core/46-member-reflection.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 37 bytes, SHA-256 `422b64ecc856de4b1ffe63a4f97c8cc4134a837e728a1a71c8392f5d3c6fdd14`

```text
(x:int, y:int)
[int:2]
{x:1, y:1}
```

**stderr:** empty (0 bytes)

### `core/47-primitive-spill.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 4 bytes, SHA-256 `a0ec0460fc75a1eea654e7a06b4b6addb3a2f8a4dfc8cd3ea9f2356d644ab44f`

```text
64
```

**stderr:** empty (0 bytes)

### `core/48-dot-overload.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 6 bytes, SHA-256 `722b3a2c262caef957158f2efe473dad62c49b3ed1f73593bf789916eb5d799e`

```text
3
4
```

**stderr:** empty (0 bytes)

### `core/49-nominal-constructors.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 102 bytes, SHA-256 `8c590f41b9b5e120c3e01570f1c630cc5255501327e0c1732909342eca9a90f7`

```text
Point
(x:num, y:num)
(x:num, y:num)
type
[num:2]
true
[int:3]
(x:num, y:num)
integer
number
```

**stderr:** empty (0 bytes)

### `core/49-semicolon-pipes.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 16 bytes, SHA-256 `487fbf4754ec22ace9d0ccb2111549e67fad338c8612874cd8b345dc29659a8f`

```text
5
[9, 25, 49]
```

**stderr:** empty (0 bytes)

### `core/50-generic-types.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 20 bytes, SHA-256 `61d2e86156dc9a3cf05662c619f83a8ab546cb71fccc7f7ca272996c91272214`

```text
vkf
4
[int:3]
6
```

**stderr:** empty (0 bytes)

### `stdlib/01-math.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 9 bytes, SHA-256 `6f168134c3ba27223b9adc0335b1704d6309c080e57d72f4bebe9e9f2eac0fa1`

```text
9
1
3
```

**stderr:** empty (0 bytes)

### `stdlib/02-stat.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

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

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 41 bytes, SHA-256 `196311bbcfcef99b3220aac51f4aec73c781c34e51acbcbb696cf673901b2a6d`

```text
0.009626434189093501
1.791479416094478
```

**stderr:** empty (0 bytes)

### `stdlib/04-time.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 21 bytes, SHA-256 `07373f641c45a9731938b679109aa5db02b037aab83348ddbc8665d8f575b769`

```text
1970-01-01 00:00:00
```

**stderr:** empty (0 bytes)

### `stdlib/05-io.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 13 bytes, SHA-256 `572a95fee9c0f320030789e4883707affe12482fbb1ea04b3ea8267c87a890fb`

```text
hello world
```

**stderr:** empty (0 bytes)

### `stdlib/06-collections.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 29 bytes, SHA-256 `a6e2a78c61b9414d9c6889f46aa230909888b0013cc2a723d9c2c0c27a655006`

```text
[1, 2, 3]
origin
10
true
```

**stderr:** empty (0 bytes)

### `stdlib/07-errors.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 6 bytes, SHA-256 `49628009a4b6e1f4b66b9f3b6842423d60085f9ec94467f3ccbbf28862d78f7a`

```text
true
```

**stderr:** empty (0 bytes)

### `stdlib/08-system.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 118 bytes, SHA-256 `216ba1e48b0a14023a4101aaa28ec67e2c3511dd90f2f9523fc6a29ecce8a7d7`

```text
windows
x86_64
14
C:\Users\VIKTOR~1.JON\AppData\Local\Temp\vkf-readme-proof-Oic4jG\runtime\stdlib\08-system
true
```

**stderr:** empty (0 bytes)

### `stdlib/09-process.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 37 bytes, SHA-256 `e6e1d3a64bfe1992acdad546ba67161fbe7f3cb4ce0cd19b82d8de5e5cc26efd`

```text
0
git version 2.51.2.windows.1


```

**stderr:** empty (0 bytes)

### `stdlib/10-regex.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 18 bytes, SHA-256 `62a4f45d656e1c1aa840717ec641e43b7cc572a79bf9a1328f13b54ee50c5d1b`

```text
vektor
vkf
101
```

**stderr:** empty (0 bytes)

### `stdlib/11-linalg.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 49 bytes, SHA-256 `169d1880ec442ac02397ee2a082e4e265c8cd418c8301542570a5e5bf95ac98b`

```text
32
[0, 0, 1]
[[19, 22], [43, 50]]
-2
[2, 1]
```

**stderr:** empty (0 bytes)

### `stdlib/11-physics.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 14 bytes, SHA-256 `0a4dcc5d53cf69a0443f1404888726e67cb92cf68f64e3074d7faa3599e0b9c9`

```text
6
[0, 0, 1]
```

**stderr:** empty (0 bytes)

### `stdlib/12-symbolic.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 21 bytes, SHA-256 `2f5144602efb8cc3ec2236adb2550a5859c6acaffb2c54694f77a9f6cbf44091`

```text
4
27
27
0.125
2
```

**stderr:** empty (0 bytes)
