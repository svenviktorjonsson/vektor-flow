# MAT040B retained rock material packet realization evidence

Date: 2026-09-01

## Packet

- Base: `cd9770f` (MAT040A).
- Branch: `codex/0.6/060-mat040b-rock-packet-realization`.
- Scope: internal retained-packet realization reuse for conditioned stone/rock materials.
- Public VKF syntax/API/schema changes: none.
- Shared renderer changes: none.
- Owned paths:
  - `web/vf-ui/vf-rock-material-field.mjs`
  - `tests/js/vf-rock-material-packet-cache.test.mjs`
  - `docs/evidence/060-mat040b-rock-packet-realization.md`

## Observable internal contract

- An unchanged source packet, conditioned material field, radii, detail level, and footprint returns the same frozen adapted packet and typed channel arrays.
- Packet variants use exact IEEE-754 option identity. Equal arrays and typed arrays select the same retained variant without object-identity coupling.
- Each source-packet / field pair retains at most eight variants in least-recently-used order. Source packets are keys in a `WeakMap`, so packet eviction does not leave a strong cache reference.
- Changed footprints remain distinct and reproduce exact deterministic bytes after eviction.
- Existing packet IDs, object IDs, index buffers, conditioned distribution hierarchy, material sample cap, GPU descriptors, and renderer contracts are unchanged.

## RED to GREEN

1. `605c03a` pinned full retained material packet identity and failed because every unchanged demand allocated new vertex/channel arrays. `692781e` added exact option-keyed reuse within weak source-packet ownership.
2. `0aefb70` verifies the eight-variant LRU boundary behavior: the newest variant is retained, the oldest is evicted, and regeneration is byte-equal.

## Executable evidence

Focused affected chain:

```text
node --test tests/js/vf-rock-material-packet-cache.test.mjs tests/js/vf-rock-material-realization-cache.test.mjs tests/js/vf-rock-material-field.test.mjs tests/js/vf-rock-material-gpu.test.mjs tests/js/vf-display-rock-material-pass-through.test.cjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-rock-renderer-packets.test.mjs tests/js/vf-refinement-working-set.test.mjs
tests 48; pass 48; fail 0
```

Real CPU/GPU parity through Edge `--headless=new`:

```text
outcome pass; records 3; maxAbsoluteError 0.00024956464767456055; maxOctaves 6
streamWords [3982524626, 2941269488, 3065520907, 1471304979]
```

Hidden renderer capture:

- 58,298-byte PNG.
- SHA-256 `20C7B5A2E8B1BA73F2CA56AEB5B22159F3D5F1AA8D07B3AAA5066A5DEC8F0B7A`.
- Exact parity with MAT030B and MAT040A.
- WebGPU initialized at 1,236 x 725 with no initialization or runtime failure.
- Three retained rock parts kept their 144-, 96-, and 96-byte material buffers.

Interleaved Node timing compared MAT040B with MAT040A. Each of seven alternating passes adapted the same already-warmed retained coarse packet 10,000 times:

```text
baseline ms:  [1473.5084, 1054.9760, 1341.0660, 994.2901, 1225.5749, 1051.4286, 1329.7048]
candidate ms: [138.1323, 93.7568, 110.7487, 95.7487, 95.1319, 156.0845, 147.3073]
median: baseline 1225.5749 ms; candidate 110.7487 ms
speedup: 11.0663x
checksum: 16496.70813321757; exact equality on every pass
```

Repository suite:

```text
npm test
tests 508; pass 505; fail 3
```

The same inherited failures remain outside this packet's owned paths:

- generated HTML component catalog is stale;
- symbolic document scope expected `8`, observed `-8`;
- named symbolic function/constant geometry expected `[-5, 625]`, observed `[-5, -624]`.

## Content hashes

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-rock-material-field.mjs` | `f5eb9c2f3636c9ba26eee485cc3a0f54b3a62e55` | `A7FCA6ACDE2FA9B019BEFD00FD7378DC1E9731ABCCFF3CACAC419824B236EF4A` |
| `tests/js/vf-rock-material-packet-cache.test.mjs` | `8ed44be330d13b8c9697b46e95f3422d07c10b1b` | `41AF59BDF083DA31C0FE43D8CB50CC063D3E47D700B03E8B318AA1E42072AB4A` |

## Remaining boundary

This slice removes repeated CPU material packet allocation only when the retained source packet and material options are unchanged. A changed view that produces new source packet objects still follows the deterministic bounded MAT040A sample path. Cross-packet structural deduplication is deliberately deferred because stable retained identities already provide the safe zero-churn route.

Recovery: drop commits after base `cd9770f`; no 0.4 renderer path was touched.
