# MAT040A bounded multiscale rock material realization evidence

Date: 2026-09-01

## Packet

- Base: `efeef43848c0f78b0ab0decbe646075c8238b33b`
- Branch: `codex/0.6/060-mat040a-rock-material-realization`
- Scope: internal deterministic reuse for conditioned stone/rock material samples.
- Public VKF syntax/API/schema changes: none.
- Shared renderer changes: none.
- Owned paths:
  - `web/vf-ui/vf-rock-material-field.mjs`
  - `tests/js/vf-rock-material-realization-cache.test.mjs`
  - `docs/evidence/060-mat040a-rock-material-realization.md`

## Observable internal contract

- Rock samples remain demand-driven: an absent coordinate has no sample, grid, or intermediate allocation.
- Each immutable conditioned field retains at most 2,048 realized material samples in a least-recently-used map. The `WeakMap` field state and its cache become collectable with the field.
- Cache identity uses exact IEEE-754 bits for both surface coordinates and footprint, plus the effective filtered octave count. It cannot alias rounded decimal coordinates.
- An unchanged demand returns the same frozen sample object. Recreating the same conditioned hierarchy reproduces equal values without sharing mutable state.
- Detail levels that filter to the same octave set share one realization. Fine detail with a resolvable footprint remains a distinct sample. The existing world / individual stone / correlated surface-field hierarchy and pinned deterministic stream are unchanged.
- No renderer packet, GPU descriptor, pick identity, or WebGPU shader contract changed.

## RED to GREEN

1. `3741f69` pinned exact lazy sample reuse and failed because repeated queries recomputed equal objects. `617d931` added exact demand-keyed realization reuse.
2. `9f1bb3e` required a fixed LRU working-set cap and failed against the unbounded map. `abd99e0` capped and refreshed the 2,048-entry per-field cache.
3. `8a7d53e` pinned multiscale coalescing and failed because filtered-equivalent detail levels used separate keys. `1b0311c` keyed them by effective visible octave count.

## Executable evidence

Focused affected chain:

```text
node --test tests/js/vf-rock-material-realization-cache.test.mjs tests/js/vf-rock-material-field.test.mjs tests/js/vf-rock-material-gpu.test.mjs tests/js/vf-display-rock-material-pass-through.test.cjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-rock-renderer-packets.test.mjs tests/js/vf-refinement-working-set.test.mjs
tests 46; pass 46; fail 0
```

Real CPU/GPU parity through Edge `--headless=new`:

```text
outcome pass; records 3; maxAbsoluteError 0.00024956464767456055; maxOctaves 6
streamWords [3982524626, 2941269488, 3065520907, 1471304979]
```

Hidden renderer capture on committed behavior:

- 58,298-byte PNG.
- SHA-256 `20C7B5A2E8B1BA73F2CA56AEB5B22159F3D5F1AA8D07B3AAA5066A5DEC8F0B7A`.
- This exactly matches the pre-packet MAT030B reference image.
- WebGPU initialized at 1,236 x 725 with no initialization or runtime failure.
- Three retained rock parts still used bounded material buffers of 144, 96, and 96 bytes.

Interleaved Node timing compared this packet with base `efeef43`, using 256 deterministic surface coordinates per pass, seven passes, identical conditioned identity/options, and alternating candidate/baseline order:

```text
baseline ms:  [170.9468, 176.3393, 72.5147, 66.7853, 76.2099, 82.9654, 78.6619]
candidate ms: [204.5669, 20.9749, 4.7959, 1.8200, 1.9007, 2.0612, 1.7928]
warm median: baseline 78.6619 ms; candidate 2.0612 ms
warm speedup: 38.1632x
cold ratio: 1.19667x candidate/baseline
checksum: 190.90583114675354; exact equality on every pass
```

The cold-path key/cache bookkeeping stayed below the release's 1.5x guard while repeated realization became 38.16x faster. The measurement excludes module import and alternates order to reduce warm-up and scheduler bias.

Repository suite:

```text
npm test
tests 506; pass 503; fail 3
```

The same three inherited failures remain outside this packet's owned paths:

- generated HTML component catalog is stale;
- symbolic document scope expected `8`, observed `-8`;
- named symbolic function/constant geometry expected `[-5, 625]`, observed `[-5, -624]`.

## Content hashes

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-rock-material-field.mjs` | `6ec3390284a8f64f11e0f24d4bb9cb9dcf39c9c1` | `5E7EB91E8723CBF1E38A6065A8EA8BD49C9B2D6DFE5C4C66037E5479CA481113` |
| `tests/js/vf-rock-material-realization-cache.test.mjs` | `a27caaf7bdf5b938167d8a9b536c354212f623f6` | `82505DD865A0CB7F33D198FCC3488815B208417A65289CD090ED7FF4DBFCBE81` |

## Remaining boundary

This cache accelerates the CPU reference/material packet realization path only. Per-fragment WebGPU evaluation remains the primary resolved-detail path. The 2,048-entry cap is an internal bounded policy, not a promoted VKF material API, and can be tuned from capture/working-set evidence without a compatibility decision.

Recovery: drop commits after base `efeef43`; no shared 0.4 renderer path was touched.
