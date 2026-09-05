# 0.5 native complex-position parity evidence

Date: 2026-09-05

## Scope

- Base: `b0dca9f27b1dfce995c8f95d0538823689ca9db1`.
- Branch: `codex/0.5/050-p-complex-native-parity`.
- Decision: ADR 0009.

The native frontend now accepts the approved one-axis `p_u` form when every
leaf is a complex scalar. It canonicalizes the real components to the existing
`x` coordinate and imaginary components to the existing `y` coordinate before
retained-scene lowering. It emits no public `z` coordinate and does not infer a
3D scene. The retained packet continues through the existing x/y line path,
which packs internal z values as zero and connects adjacent u samples in source
order. Existing numeric `p_uc` indexed component-vector geometry is unchanged.

Complex-expression recognition was extracted from machine-IR display-shape
inference and is shared with the new frontend canonicalization. No renderer,
JavaScript, public syntax beyond ADR 0009, schema, ABI, or diagnostic string was
changed. A noncanonical or mixed `p_u` remains on the pre-existing exact
``Frame.add does not support `p_u` `` rejection path.

## RED -> GREEN

```powershell
$env:VKF_NATIVE_COMPILER_BIN=(Resolve-Path '.work/native-p-complex-compiler/bin/Release').Path
$env:VKF_NATIVE_SCENE_STAGER=(Resolve-Path '.work/native-p-complex-compiler/bin/Release/vkf_ast_to_ir_smoke.exe').Path
node --test --test-name-pattern="complex p_u" tests/compiler/frame-add-scene-parity.test.mjs
```

- RED: exit `1`, `0/1`;
  ``<ast-to-ir>:1:1: Frame.add does not support `p_u` ``.

After the minimal frontend canonicalization and a focused rebuild:

```powershell
$env:VKF_NATIVE_COMPILER_BIN=(Resolve-Path '.work/native-p-complex-compiler/bin/Release').Path
node --test --test-name-pattern="complex p_u" tests/compiler/frame-add-scene-parity.test.mjs
```

- GREEN: exit `0`, `1/1`.
- Exact assertions cover real to x, imaginary to y, no typed-IR z, line-list
  topology, source-order adjacency indices, `mode3d:false`, and seven packed
  zero z components.

## Regression gates

Fresh MSVC Release builds succeeded for `vkf_ast_to_ir_smoke`, `vkf-strict`,
and `vkf_layer_time_runtime_test`.

```powershell
node --test tests/compiler/frame-add-scene-parity.test.mjs tests/compiler/frame-add-indexed-mesh.test.mjs
```

- exit `0`, `16/16`, including native/WASM packet parity and existing `p_uc`
  indexed geometry.

```powershell
$env:VKF_NATIVE_DRIVER=(Resolve-Path '.work/native-p-complex-compiler/bin/Release/vkf-strict.exe').Path
node --test tests/compiler/machine-ir-dead-code-ratchet.test.mjs
```

- exit `0`, `2/2`.

```powershell
& .work/native-p-complex-compiler/bin/Release/vkf_layer_time_runtime_test.exe
node --test tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
git diff --check
```

- native runtime test and diff check exit `0`; source graph exits `0`, `2/2`.

Environment: Windows x64, Node `v22.14.0`, MSVC `19.44.35217`.

## Preserved base-build defect

The base commit includes `compiler/native/vkf_spectral_emission.hpp` from
`vkf_native_scene_lowering.hpp`, and the native stager additionally versions
three runtime assets, but none of those four files exists in the Git tree or
any fetched ref. Fresh `vkf_wasm_artifact_smoke` and stager builds therefore
fail before this packet unless the preserved recovery copies are supplied.

For regression execution only, the missing header and runtime assets were read
from `.work/recovery/VKF-Recovery-2026-09-04/dirty-payload/010-041-rabbit-gallery/untracked`.
They were not added to this worktree or packet. Their SHA-256 receipts are:

```text
49D3D768F5A313738FBE6D065511AD316B9E744643E161E432F5D42587DA318A  compiler/native/vkf_spectral_emission.hpp
38748972A44163D25F883F15AF76E804889F4B0340D30886931A9C5A24147A64  web/vf-ui/runtime-js-ownership.json
DF04D69A6B8568A9F010E762D96C2D8545B28AA1FAE693E8EABFC9A9759B7BB1  web/vf-ui/runtime-js-ownership.schema.json
EC551B48249BF6CD10FF9224750E31BD9EA88FB4DA99F789F64D2B55D51DC78D  web/vf-ui/vf-startup-gate.js
```

## Packet SHA-256 receipts

```text
9654E033922B2230782130E5664433B9E728B9180B93BE901BB6C7D893773BDA  compiler/native/vkf_ast_to_ir_smoke.cpp
A3FAA05FA2C46DCDB47859A468BBCAF7373759E9CF3E1D52EC74CCB58AA12C2A  compiler/native/vkf_machine_ir_lowering.hpp
928F05BF69184710F371D954E5E4DA7BA1397576A81C67A1DBE03C7D82098E8E  compiler/native/vkf_complex_expression.hpp
25B4407D93E8CA00F51C7F6EFA18726853E05F0E4546AB7CF1661939E88F1F05  tests/compiler/frame-add-scene-parity.test.mjs
```
