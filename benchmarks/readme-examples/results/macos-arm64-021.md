# VKF 0.2.1 documented-program proof

Generated 2026-08-24T12:54:48.630Z. Every example was compiled from 10 fresh paths and executed in 10 fresh operating-system processes.

## Conditions

- OS: `darwin 24.6.0`
- Architecture: `arm64`
- CPU: Apple M1 (Virtual) (3 logical CPUs)
- Native compiler: 2423080 bytes, SHA-256 `3368be26fe7ee8d19d633761a2d618c00b91f1df934c36e1fe39b3f453be8f17`
- Compile verification: 10 fresh source paths per example.
- Runtime verification: 10 fresh-process runs per example.
- Working directory: one isolated temporary directory per example, reused across its runs.

## Output stability

| Example | Source bytes | Source SHA-256 | Output |
| --- | ---: | --- | --- |
| `core/01-bindings.vkf` | 68 | `1a692e29ebcfe2cbdb3486cc44bf390ff39e4b0f11732942a86b218aeb265324` | 10/10 identical |
| `core/02-bind-expression.vkf` | 24 | `3053708ebf0df7c8eb9a3304dca3c081224269beba850fb61f5ec0185c9f1000` | 10/10 identical |
| `core/03-blocks.vkf` | 288 | `35ca3989bcf6fb024c70c15c22234b326790707d6beb470b3cbec02c33414bb7` | 10/10 identical |
| `core/04-output-assert.vkf` | 105 | `3ca9140686c5ff496850a13aeded6598ac2f806c0c4fe5498402766c66cdae26` | 10/10 identical |
| `core/05-tagged-test.vkf` | 95 | `02ade7b319df3b88480069ebe5038f6a84953a01c4320e5f48d7fd4c97bc3945` | 10/10 identical |
| `core/06-primitives.vkf` | 169 | `f5c39b28f2f69284ef57ed3b3c81211b139ae87d05bcd03bd8ae6bcc059bae63` | 10/10 identical |
| `core/07-reflection.vkf` | 105 | `7ff42e32a64ec62f1efc172c8e8a0677aa6d1e0cb8d632f79f1daba7d20ff646` | 10/10 identical |
| `core/08-strings.vkf` | 145 | `3076cced06bb533f776793943b650a73de392068721b1c0f9d7f8be125eb065f` | 10/10 identical |
| `core/09-tuples-records.vkf` | 133 | `0f3e3ed467848ffd14b84adbc15dd88c6d007757c5eedeb1fa648c981ceea7bd` | 10/10 identical |
| `core/11-vectors.vkf` | 119 | `91ba75d0c02154ddf7ec7041b1421c95ee3f83238d0da6d202ef37db6244e7a9` | 10/10 identical |
| `core/12-vector-concat.vkf` | 94 | `6ec65ae4b634d2b85562d3e0b5d9a7f5ca7d781cd1c04ce2c590457eccf1b722` | 10/10 identical |
| `core/12b-container-stress.vkf` | 297 | `593076ad5cce0f0e6cf8529ab8fd9b093a32eb2923c60f22196114fd3f2f999f` | 10/10 identical |
| `core/13-updates-aliases.vkf` | 278 | `44950fe8ffc2330c9fc04d4adc9ef5ae09c441f5cefbf5cff6b1540de3273a17` | 10/10 identical |
| `core/14-multisets.vkf` | 118 | `8dd5f741ac6308aaa8c8970ec3693dd0fa0abae94ad5045e186f16d758178387` | 10/10 identical |
| `core/15-ranges.vkf` | 29 | `d0bade9480353ce3267722d323c8f402b4f78c7193d632087aafb5574f11a6c2` | 10/10 identical |
| `core/16-complex.vkf` | 37 | `69e222aee88f9423ab9f56b71081077f7428da7f70ba87abeb2b013286426fca` | 10/10 identical |
| `core/17-equality.vkf` | 59 | `72aed102ae5056895331aad9a9b3724886654f712c12392f356651a2a152d325` | 10/10 identical |
| `core/18-functions.vkf` | 124 | `00f0f116fc8a5965be631bfe78355fffad4ea350d7c368daedc9e973b1e96b06` | 10/10 identical |
| `core/19-call-arguments.vkf` | 143 | `2afc98ea9dc939c4b523fd8bda94b35efff0eba67ab3e72ecee78466694839a4` | 10/10 identical |
| `core/20-recursion-closures.vkf` | 227 | `e3098cb2dd44f1e4f6a1ba872cdedbf92b825308cbfcdd39823fc4a7ea9a8892` | 10/10 identical |
| `core/21-lambdas.vkf` | 199 | `aaf8f3691e673b0e7fd1d1f50cefeccb6c4793147b626175982b49cd57a580ae` | 10/10 identical |
| `core/22-variadics-spreads.vkf` | 295 | `4f272eb51d6b7a3c84d941a0abd1d1b4171ff41736378882104763b41514b607` | 10/10 identical |
| `core/22b-literal-spreads.vkf` | 49 | `8132a06e57a169e7f1ab019ce632c654bd653d5db4f2d2f6541ef1daa8b91d8f` | 10/10 identical |
| `core/23-shape-parameters.vkf` | 102 | `4ccc81964cc5c0e49140ee64b9bfaf67f4df04656345b1ad0016fc7e14f2851b` | 10/10 identical |
| `core/24-open-any.vkf` | 144 | `e79d095e4a615954f89c885c706449e6e48299a784a4e7196a20676b1edecc1f` | 10/10 identical |
| `core/25-structural-compatibility.vkf` | 90 | `161468b90b4a5ba565a1bc3258d3af3b2dc02464522ca02dd92bac4cf8698a7d` | 10/10 identical |
| `core/26-structural-conversions.vkf` | 82 | `c51dacc2e0b944b8522bd573dddc1e311ac9f5c632ebd248e2e7dd20e405be82` | 10/10 identical |
| `core/27-structural-recursion.vkf` | 141 | `5df7bd4ee37637a89ab41f0e549b5e1e8b8d7cdf6f35f694a4c73745d811d8cb` | 10/10 identical |
| `core/28-structural-records.vkf` | 99 | `4b252f18504bc75ecc85d99d22fe6808d65178101fecdfe3d37dfa1ae070300a` | 10/10 identical |
| `core/29-structural-exact-match.vkf` | 92 | `9dc8c78ceb7076b90daba5e44d786dfbaafc033813bc360862746b47c6802fa0` | 10/10 identical |
| `core/30-math-structural.vkf` | 129 | `ae69a2867ce49f9b7f3bd2d11815a0fc00c911d52f41f02ab0bb02503bded644` | 10/10 identical |
| `core/31-conditionals.vkf` | 83 | `04878c1f51acb3b4e2af4e45503b835e38c82f74237d82e401f7b17bd47266bf` | 10/10 identical |
| `core/32-match.vkf` | 150 | `bd02267c4033d780fa49db68f9ec98acd9d365050d3681adf8ac6f3cde89a5a6` | 10/10 identical |
| `core/33-loops.vkf` | 271 | `7a27f1ac8b63ede227f0690005eec0523ebef10aee6b1c5bdfbe9a55ac8da3ae` | 10/10 identical |
| `core/34-errors.vkf` | 97 | `3373c890f6e39682fd9b54acf5fa4778a41b3b6ae77cc137dc8cbd5e2edc25c3` | 10/10 identical |
| `core/35-pipes.vkf` | 75 | `dfff52f9d9f51c5739f09c4b5ab93ca20971d93b0112bb842c7180be3ca1cc0b` | 10/10 identical |
| `core/36-pipe-blocks.vkf` | 79 | `698e3a016927b20f0a94512a50e2670bceace0c2c71f1b2a0657519b6bec777c` | 10/10 identical |
| `core/36b-pipe-assignment.vkf` | 107 | `2b5b7a746079ef5b6dcca90393711be73a4c5f0a0cb31d406f47cddc19e914d5` | 10/10 identical |
| `core/37-operators.vkf` | 77 | `0d68eaedc20c2c30e6fe95fddebec88c87c9d079bfca6cb19a8dd9e3cccd39bd` | 10/10 identical |
| `core/38-absolute-norm.vkf` | 20 | `e4e29d93d9e886e007965e7fe290ec3196b59023c2c65ab9c7ec3fd25429be66` | 10/10 identical |
| `core/39-overloads.vkf` | 182 | `0637e195b28374e693e5cc0eab786bb29b136137aef8497d997295ae11621b05` | 10/10 identical |
| `core/40-fixed-shapes.vkf` | 98 | `93322c6686c1075782047ab9dd8e83cedacb556d2835c53c5e7b1dc876b94084` | 10/10 identical |
| `core/41-indexing.vkf` | 104 | `4beb9d01a8d0f2434ff6eebd94caa12fe617bee1c02d05f7abc06b81d7964165` | 10/10 identical |
| `core/42-axes.vkf` | 149 | `eb4f7f399e29ee754730eb5125b422690aff47802f6b454fe59f534a22434d85` | 10/10 identical |
| `core/43-modules.vkf` | 45 | `88c88a727af79c8ad4ee03833db0158d700dc330d75fc15e77d67e8eefa01b58` | 10/10 identical |
| `core/44-shadowing.vkf` | 140 | `a8472899c43dcde95d763f4e91ce9c0ac43f98c75578c7cb26e4120de1573633` | 10/10 identical |
| `core/45-overloads-dispatch.vkf` | 119 | `11514e0090a7b4d8db2e893eb118400837979d6f83c62d7ed4c3bdf0850e0e16` | 10/10 identical |
| `core/46-member-reflection.vkf` | 147 | `c465d419fbc2eeebab6e651a92a2376b57a881232287cc77fffe85ac3fb34c93` | 10/10 identical |
| `core/47-primitive-spill.vkf` | 16 | `2eaa791cfb4aa0b87d12028158197dbd65112ec268b80a4fbf1a396b37addb1b` | 10/10 identical |
| `core/48-dot-overload.vkf` | 172 | `71956fe08206241b4e1259a2372fd86205eff328de903726ac91e87869e76fab` | 10/10 identical |
| `core/49-semicolon-pipes.vkf` | 135 | `e7a83488ce50b309da8cfc81f435114d9c0eb3d89b183bdc64aa19607fd204aa` | 10/10 identical |
| `stdlib/01-math.vkf` | 72 | `648f56448a3be2717fdae38bde63f532fc0fe43307f681513deefb3772e3809f` | 10/10 identical |
| `stdlib/02-stat.vkf` | 230 | `1ecf8a7365dd728a0ef780087e1e6f542969bfc325ad715bae4fa87834c30bec` | 10/10 identical |
| `stdlib/03-random.vkf` | 141 | `c0f6c8514b4afedc7f727ac7a45dbe83c3492a26355866a61c5d3e0a4683f9c9` | 10/10 identical |
| `stdlib/04-time.vkf` | 169 | `51823bfc80b32b779ef5a52be6f4ca6539808ee478fb5829527147e513bec960` | 10/10 identical |
| `stdlib/05-io.vkf` | 129 | `4acc12b3b0ae173316afd56b158a13cdc2e79a606e2282182afbd7de42df1157` | 10/10 identical |
| `stdlib/06-collections.vkf` | 206 | `1882a6ec40607edeaa9fa54db82d6a21aa6d40e572be70e57947d6bceda0742a` | 10/10 identical |
| `stdlib/07-errors.vkf` | 90 | `8fea9dd54b580913802ea5173fe75c6b0f401c3cd104c548a57a07180571b7ab` | 10/10 identical |
| `stdlib/08-system.vkf` | 125 | `d8799b0ba15364abc91002d6a4fe0c2f62100dd0ddf4e3e1bbaf27a6acd76268` | 10/10 identical |
| `stdlib/09-process.vkf` | 103 | `f11a54f8f0759cc03d369311cf188d07bf34b657563a977d03717ace236db5cc` | 10/10 identical |
| `stdlib/10-regex.vkf` | 168 | `e5e8411698b53871f0d7035a2845f9bef69974f60caa2f47b92b8f74d21ab6d5` | 10/10 identical |

## Exact output

### `core/01-bindings.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 4 bytes, SHA-256 `be8d3637e64147183a99406d53a5dda75a3176c815aaecb299a16fa6faf06307`

```text
7
6
```

**stderr:** empty (0 bytes)

### `core/02-bind-expression.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 4 bytes, SHA-256 `1ddb914da9135a2d6dfcc0ff179d68d23e7fd1e5364c088c183234d04a41bece`

```text
3
4
```

**stderr:** empty (0 bytes)

### `core/03-blocks.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 38 bytes, SHA-256 `4e24a6e3b4af447912730c9f9edb30801d9c961094dd5d1b1165a15990302091`

```text
hello world
make_base(x:3, y:4)
3
red
```

**stderr:** empty (0 bytes)

### `core/04-output-assert.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 3 bytes, SHA-256 `084c799cd551dd1d8d5c5f9a5d593b2e931f5e36122ee5c793c1d08a19839cc0`

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

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 64 bytes, SHA-256 `4b200d24082c99d12fefbdad717fdf5813f794c9d4b2aeccaf0ecdf2e1d97a8c`

```text
4
(any) -> int
[int:2]
(NumberType:num, reflected:(any) -> int)
```

**stderr:** empty (0 bytes)

### `core/08-strings.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 64 bytes, SHA-256 `88ba2f34096bb10760c3a2330944c7d6e97bd0efe94289d5ebcb15dd2cbb123a`

```text
Hej världen
value=4.23
sum=5 point=(x:2, y:false) cost=$5
😀
```

**stderr:** empty (0 bytes)

### `core/09-tuples-records.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 13 bytes, SHA-256 `22df7fb4569c49f5a54ea956e15d783f36161e30e7151dbcdbcf2b9936b83c7f`

```text
12
origin
12
```

**stderr:** empty (0 bytes)

### `core/11-vectors.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 40 bytes, SHA-256 `431aee49009cdcec396de1b489a748450d45fa11353ce72b0f2467602a0d8715`

```text
[1, 2, 3]
[4, 20, 6]
[7, 7, 7, 7, 9, 9]
```

**stderr:** empty (0 bytes)

### `core/12-vector-concat.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 20 bytes, SHA-256 `0fcc2904dc9d884b458eaad6f08657d3320a09f22ce30c5361d11de93357e550`

```text
[1, 2, 3]
[1, 2, 3]
```

**stderr:** empty (0 bytes)

### `core/12b-container-stress.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 9 bytes, SHA-256 `de6aeb89b0d91519a443ac503ea9e652f130752e5ecc78cbcffc3e0f04e4bbf0`

```text
10000000
```

**stderr:** empty (0 bytes)

### `core/13-updates-aliases.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 33 bytes, SHA-256 `140910e03ebf0902b10beebc7aafcb24adbd0fcf8af446be37c31cd09c07385d`

```text
[3, 4]
(x:5, y:6, name:my point)
```

**stderr:** empty (0 bytes)

### `core/14-multisets.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 39 bytes, SHA-256 `34fb1d7325fa8e102bbfe2113d88f976c63e954784b94c986ed1df0fc44c051e`

```text
{a:7, b:1, c:2}
{a:1, b:1}
{a:2}
{a:1}
```

**stderr:** empty (0 bytes)

### `core/15-ranges.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 39 bytes, SHA-256 `82f3ee88f20b642514135e8ffc3f43a3d8cc97d923b41a86171d34242912d1d4`

```text
[0, 1, 2, 3]
[3, 2, 1, 0]
(1, 2, 3, 4)
```

**stderr:** empty (0 bytes)

### `core/16-complex.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 15 bytes, SHA-256 `a218701574bbd953987115e78a008d90fb1503a81d4486846acb1c009aaef887`

```text
1 + 2i
-3 + 4i
```

**stderr:** empty (0 bytes)

### `core/17-equality.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 11 bytes, SHA-256 `c38a31bd481ac409fd307b56ff366108d0f6b9995b07750cf5e2a0ba9f7bf33f`

```text
1
1
[1, 1]
```

**stderr:** empty (0 bytes)

### `core/18-functions.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 9 bytes, SHA-256 `d8ec94706884766f0c6e112f4b260a23f702cd135f8fe8ce0ccfdd3960f83a52`

```text
7
3
null
```

**stderr:** empty (0 bytes)

### `core/19-call-arguments.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 12 bytes, SHA-256 `33844f23f9a54367e3bac979ca95b24aa1cae39272755a9e746e07274d1049c5`

```text
234
345
345
```

**stderr:** empty (0 bytes)

### `core/20-recursion-closures.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 6 bytes, SHA-256 `de57293fb3c8cc0cea24dad81634e9fde34063f3875def931c1742c07715c57f`

```text
720
7
```

**stderr:** empty (0 bytes)

### `core/21-lambdas.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 8 bytes, SHA-256 `505e2046fa4404a5a7d5be40a1750ff63bd5c204ec6f371e29858d1c6330551b`

```text
10
25
9
```

**stderr:** empty (0 bytes)

### `core/22-variadics-spreads.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 28 bytes, SHA-256 `3e5ae314292b12196ac3af9b504c0a8ebc963f543e5afdadb861c30db81e08f2`

```text
10
7
(flag:true, mode:fast)
```

**stderr:** empty (0 bytes)

### `core/22b-literal-spreads.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 15 bytes, SHA-256 `f741b607d95626dc3f96de54fd7ad7cf0a55125fdf1f141155a211e458e29986`

```text
(1, 2, 3, 4)
4
```

**stderr:** empty (0 bytes)

### `core/23-shape-parameters.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 16 bytes, SHA-256 `9f2d2625704e6182bdec03466c5f0a20cdf9e39a40378f2029be48c15d3fe442`

```text
[1, 2, 3, 4, 5]
```

**stderr:** empty (0 bytes)

### `core/24-open-any.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 4 bytes, SHA-256 `b3afef0e7bc7a4e8a30048b5388d63af1c62c2932c7bd15c9db71695e6b9ebc3`

```text
2
7
```

**stderr:** empty (0 bytes)

### `core/25-structural-compatibility.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 27 bytes, SHA-256 `dadd6c6a53d5883844331530b543e641abaaad165311384cc884c24126b6d860`

```text
[2, 4, 6]
[[2, 4], [6, 8]]
```

**stderr:** empty (0 bytes)

### `core/26-structural-conversions.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 13 bytes, SHA-256 `749f71e7de25034687c16e4a72d71fe5dcb80b140a5de551d49ab3de5681e413`

```text
[4, 1.5, -2]
```

**stderr:** empty (0 bytes)

### `core/27-structural-recursion.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 29 bytes, SHA-256 `6943de31c6ffa84ca24290f999a74b6004b8737eca7ae1b0339fe02d2ac360de`

```text
[(x:11, y:-8), (x:13, y:-6)]
```

**stderr:** empty (0 bytes)

### `core/28-structural-records.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 11 bytes, SHA-256 `08e3a5e8430e95f9e6547c835f5298bdbfce19220c5db83ea1f5f2bcf7070769`

```text
[3, 7, 11]
```

**stderr:** empty (0 bytes)

### `core/29-structural-exact-match.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 10 bytes, SHA-256 `3f5caa800a4394143041f3bcb643ee54514adcee3bab1358cfe17d4415d8c120`

```text
[2, 3, 1]
```

**stderr:** empty (0 bytes)

### `core/30-math-structural.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 35 bytes, SHA-256 `8ce2943e922276e1b1c90ce795e13985e6a9fae05310234216d356e8d36f6db2`

```text
[[1, 4], [9, 16]]
[[1, 2], [3, 4]]
```

**stderr:** empty (0 bytes)

### `core/31-conditionals.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 6 bytes, SHA-256 `c4615f9cb6ce29b14379b0661cb7dd7d4d288563bb6eeb7199c52856fffdfcbe`

```text
1
nan
```

**stderr:** empty (0 bytes)

### `core/32-match.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 28 bytes, SHA-256 `3967bff2d510a247a3deeefc323563a4b45b990364a247066352f536eef174e5`

```text
exact three
another integer
```

**stderr:** empty (0 bytes)

### `core/33-loops.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 5 bytes, SHA-256 `eba7437651bd2dabe00aba8388b552da5557f5f7b0fbe2ea2248902e7ffc9cfd`

```text
10
2
```

**stderr:** empty (0 bytes)

### `core/34-errors.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 15 bytes, SHA-256 `09b3f54ee9735fddc87655801eae6e07d76851b8e942b198884072751a2c67bf`

```text
specific value
```

**stderr:** empty (0 bytes)

### `core/35-pipes.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 33 bytes, SHA-256 `3727de73e1b4c11ce046156d73c1659ebbcbef3dc80e3675559845d6088ef3a0`

```text
[2, 4, 6]
(11, 12, 13)
16
ååAA
```

**stderr:** empty (0 bytes)

### `core/36-pipe-blocks.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 14 bytes, SHA-256 `e293556b16abdec668ba2a64a09435af60e074d72d395df1833c56c07d66a72f`

```text
[1, 20, 3, 4]
```

**stderr:** empty (0 bytes)

### `core/36b-pipe-assignment.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 30 bytes, SHA-256 `ef0c4a8693192fbab3a5aa0f8d7e3c4a6af24f3c6416cb0b11ababb7d08adabc`

```text
[4, 3, 2, 1]
(40, 30, 20, 10)
```

**stderr:** empty (0 bytes)

### `core/37-operators.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

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

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 4 bytes, SHA-256 `133f46e9df9c594a4bd844a0ad79a12dfa578d0d86f881d0b0d4c016068a4b90`

```text
5
5
```

**stderr:** empty (0 bytes)

### `core/39-overloads.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 24 bytes, SHA-256 `e1198d89f3035c2863d736ba0b73a4c4f0bb348b96819a2aff710902ddbc535c`

```text
(x:4, y:6)
(x:-3, y:-4)
```

**stderr:** empty (0 bytes)

### `core/40-fixed-shapes.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 2 bytes, SHA-256 `f0b5c2c2211c8d67ed15e75e656c7862d086e9245420892a7de62cd9ec582a06`

```text
5
```

**stderr:** empty (0 bytes)

### `core/41-indexing.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 29 bytes, SHA-256 `e2591385af547aff82e706b0cb9e82ad909b6155381fccf54b5b931f2279e22c`

```text
20
[10, 30]
[10, 21, 30, 41]
```

**stderr:** empty (0 bytes)

### `core/42-axes.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 91 bytes, SHA-256 `3cd7f8426adf3ebeb3f9b26a9f84e3f10e77a8efbc1d724190802fa492b4291e`

```text
[[1, 2, 3], [2, 4, 6], [3, 6, 9]]
[4, 10, 18]
[[[15, 18], [20, 24]], [[30, 36], [40, 48]]]
```

**stderr:** empty (0 bytes)

### `core/43-modules.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 4 bytes, SHA-256 `a4e80b45e6335963b93bfb520655322a4ad9980e3165c3cbe80234d784c2cef1`

```text
3
1
```

**stderr:** empty (0 bytes)

### `core/44-shadowing.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 4 bytes, SHA-256 `452e39c241ac7c3d1fe29b5529a5e2ea849dff1f35727ab388946535f4f2f0f8`

```text
0
4
```

**stderr:** empty (0 bytes)

### `core/45-overloads-dispatch.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 13 bytes, SHA-256 `4ebb68e57868eb17d264f904194253b9d2ba77fa9eefc158c708598c688e6324`

```text
integer
text
```

**stderr:** empty (0 bytes)

### `core/46-member-reflection.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 37 bytes, SHA-256 `7cc61870e09e854f5453599daed147a7654e3cd5cbd21774526d1670929163e4`

```text
(x:int, y:int)
[int, int]
{x:1, y:1}
```

**stderr:** empty (0 bytes)

### `core/47-primitive-spill.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 3 bytes, SHA-256 `913f5d1da2feaf4deeccc9e55cbb350a20f12b3f507e87be85dbb77fdd3cb9bc`

```text
64
```

**stderr:** empty (0 bytes)

### `core/48-dot-overload.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 4 bytes, SHA-256 `1ddb914da9135a2d6dfcc0ff179d68d23e7fd1e5364c088c183234d04a41bece`

```text
3
4
```

**stderr:** empty (0 bytes)

### `core/49-semicolon-pipes.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 14 bytes, SHA-256 `a656bbc90fa54978a0eac95b7c75b6791e8ed097a345cfdd352acb61b93d66a5`

```text
5
[9, 25, 49]
```

**stderr:** empty (0 bytes)

### `stdlib/01-math.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 6 bytes, SHA-256 `6c8aade637e337c00bb7fb50e0085e52d398eb65839748c2af93fd0f1d6a5b96`

```text
9
1
3
```

**stderr:** empty (0 bytes)

### `stdlib/02-stat.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

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

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 39 bytes, SHA-256 `42355a336197258cbb3cf70a1ff3e18cd7f765fbca2b2749a461e67d5fc3f32e`

```text
0.009626434189093501
1.791479416094478
```

**stderr:** empty (0 bytes)

### `stdlib/04-time.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 20 bytes, SHA-256 `506ccb700357d37bb8c599603055b3a449c9c27e853112ff1b80080a264d8fa1`

```text
1970-01-01 00:00:00
```

**stderr:** empty (0 bytes)

### `stdlib/05-io.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 12 bytes, SHA-256 `a948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447`

```text
hello world
```

**stderr:** empty (0 bytes)

### `stdlib/06-collections.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 25 bytes, SHA-256 `082dfaf3fdba63d854cb8d1a24ecc0fbd45a39ab10ae378fa99c01a1f74e3520`

```text
[1, 2, 3]
origin
10
true
```

**stderr:** empty (0 bytes)

### `stdlib/07-errors.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 5 bytes, SHA-256 `a17fcf0a2f50e2d495e4f90ce263410edc183add6c62699a2facbccf60410f74`

```text
true
```

**stderr:** empty (0 bytes)

### `stdlib/08-system.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 125 bytes, SHA-256 `45ba0a5d8aec8eb7f6a1a1192f8bd121b304c07200559df6ec973a3ab50793d6`

```text
macos
arm64
3
/private/var/folders/_5/zjnzxgh147qcg3bb5cg2wvqw0000gn/T/vkf-readme-proof-TSWKf3/runtime/stdlib/08-system
true
```

**stderr:** empty (0 bytes)

### `stdlib/09-process.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 23 bytes, SHA-256 `434751e394c24f0e8906749bc1ea54382f15b04f1e2d5f32cae265e8835d00e2`

```text
0
git version 2.55.0


```

**stderr:** empty (0 bytes)

### `stdlib/10-regex.vkf`

Exit code: `0`. Output stability: 10/10 byte-identical verification rounds.

**stdout:** 15 bytes, SHA-256 `b35cd66fc9c8c1e3c8a685b872f413e55f53226466d5a9c0f827bf63696bd38a`

```text
vektor
vkf
101
```

**stderr:** empty (0 bytes)
