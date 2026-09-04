# 050-I240 locked runner recovery audit

## Scope and outcome

- Git HEAD: `cc310f23ccf1f5dd836ffe1f33218501d4ef83a0`
- Branch: `codex/0.5/050-i240-stage3-pe-crt`
- Host: Windows x64, `Microsoft Windows NT 10.0.26200.0`
- State: **BLOCKED before RED**

This docs-only receipt audits the build and release artifacts preserved under
the relocated repository's ignored `.work/i240` directory. It does not change
the I240 public seed fixture, compiler source, manifest, syntax, semantics,
diagnostics, schema, ABI, timeout, or acceptance gate.

The authoritative locked x64 runner required by the I239/I240 fixed-point
fixture has SHA-256
`8B501F0F67A5AA20E33F82DA8B1747E498A09BCE2BC2B4AD576A165CA792D039`.
Its `.text` virtual size is `0x16b`, and the first eight `.CRT` bytes are
`18 11 00 40 01 00 00 00`, the little-endian VA `0x0000000140001118`.
None of the relocated artifacts matches that identity or layout.

## Rebuilt artifact inventory

The four runner candidates are reproducible local builds of unchanged source,
but are non-authoritative inputs for the locked-seed fixture:

| Relocated `.work/i240` path | Build variant | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `vkf-i240-ninja/bin/vkf_x64_runner_template.exe` | MSVC 14.44, Ninja Release | 37,376 | `924AA1751D2DADD5FEF19351BAE33AE32D667F4318B24A20B8747903D9706031` |
| `vkf-i240-v142/bin/vkf_x64_runner_template.exe` | MSVC 14.29, Ninja Release | 37,376 | `5978775FA3C64F4AFD0C46EBFF31D72DEB20BAA88A9D70B138BC87F9496AD4A7` |
| `vkf-i240-v142-gsminus/bin/vkf_x64_runner_template.exe` | MSVC 14.29, Ninja Release, `/GS-` probe | 37,376 | `F898CAFC8F2EC56A29AD329ABEE2F4D6905F7D6B512369231545CB30C3C9D438` |
| `vkf-i240-v142-sdk19041/bin/vkf_x64_runner_template.exe` | MSVC 14.29, Ninja Release, Windows SDK 10.0.19041 probe | 37,376 | `347EAB9CCBC8A5BA67651925C89074A306AA021CD639E5ABAD44425F20F6930F` |

All four candidates have `.text` virtual size `0x1a3` and first `.CRT` bytes
`50 11 00 40 01 00 00 00`, the little-endian VA
`0x0000000140001150`. Using any of them would substitute a different PE seed
and weaken the exact layout/hash gate, so none is accepted.

Companion executable identities recorded during the same audit are:

| Relocated `.work/i240` path | Bytes | SHA-256 |
| --- | ---: | --- |
| `vkf-i240-ninja/bin/vkf_bootstrap_bundle_artifact_smoke.exe` | 2,078,208 | `7EA35BF1AA09E3D245B607BC2E3013A8218C8D47E5A9DCA68964CB2D28701492` |
| `vkf-i240-ninja/bin/vkf-strict.exe` | 3,474,944 | `1420712A87C7B72E51C8BAB6BF14CB19433F169379DB2B2140B784807A1F031E` |
| `vkf-i240-v142/bin/vkf_bootstrap_bundle_artifact_smoke.exe` | 2,068,992 | `5E7A49C9C3DFE197CF5961D92C1A2873BCE13ABA3472D3DF0C4DC1A35F8A175A` |
| `vkf-i240-v142/bin/vkf-strict.exe` | 3,452,416 | `0AA2B59A905076BCAAEF96D71C2B12A3B1CCDBDCE102888DE6972598DB32AD4C` |

These companion tools do not restore the missing locked runner body and are
not evidence that the I240 baseline is green.

## Release and recovery audit

The inspected official release material has these identities:

| Relocated `.work/i240` path | Bytes | SHA-256 |
| --- | ---: | --- |
| `vkf-i240-release/vektor-flow-windows-x64.zip` | 5,450,079 | `131313DEC53F0785F644B9E8C67632C7A12FD1883035140235EE55F89AE9C4AC` |
| `vkf-i240-release/extract/bin/vkf-runner.exe` | 4,736,512 | `F5CE8B208DE7F16B81E818673EC5CA76E7F67A728549A55A309B9A4ED4C0FCEB` |
| `vkf-i240-release/extract/bin/vkf.exe` | 5,350,912 | `5CD4D6A49F47318C40F87623899E8C9596EB170DFC280F449DDA1F38B99ED375` |
| `vkf-i240-release-v010/vektor-flow-windows-x64.zip` | 1,186,365 | `0BADFF591B2C4E7F1DB801ADFA350DB217AE1C2559417E28AC380038D7002BAE` |

Archive listing found neither `vkf_x64_runner_template.exe` nor
`vkf-strict.exe` in either Windows release zip. The extracted `vkf-runner.exe`
and `vkf.exe` are different packaged products, not locked-runner substitutes.

The recovery inventory confirms why the original local seed is unavailable.
Line 67,403 of
`dirty-payload/excluded-generated-files.txt` records exactly:

```text
001-vektor-flow	.work/bootstrap-current-bin/vkf_x64_runner_template.exe
```

The recovery payload intentionally excluded that generated file; neither the
source archive nor the Git bundle contains its bytes.

## Verification receipt

Node `v22.14.0` on the host above:

```powershell
node --test tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 2/2 passed in 104.19 ms;
- the bootstrap dependency order and canonical source/bundle digests remain
  intact;
- `git status --short --branch` remained clean at the recorded HEAD before
  this evidence-only change.

The earlier focused seed baseline with a rebuilt runner reached generated
program execution and failed with Windows status `2147483651` (`0x80000003`),
because the fixture's exact entry/layout addresses do not describe the rebuilt
PE. It was not rerun during this audit. Future crash-capable reruns must inherit
Windows `SetErrorMode` flags `0x1 | 0x2 | 0x8000` so an expected process failure
cannot display an interactive error dialog; assertions remain unchanged.

## Blocker and disposal boundary

I240 cannot begin its documented RED until the exact locked runner is present.
The next gate is:

1. obtain `vkf_x64_runner_template.exe` from the original locked build or
   reproduce it with the exact historical toolchain;
2. verify SHA-256
   `8B501F0F67A5AA20E33F82DA8B1747E498A09BCE2BC2B4AD576A165CA792D039`;
3. rerun the existing focused I239 seed baseline under the headless Windows
   error-mode wrapper; and
4. only after GREEN, start I240's documented 2,560-byte public RED.

All audited `.work/i240` rebuild and release artifacts are ignored,
reproducible, non-authoritative scratch data. They are safe to delete when no
longer useful, but this audit does not delete them, and deleting them does not
resolve the locked-runner blocker.
