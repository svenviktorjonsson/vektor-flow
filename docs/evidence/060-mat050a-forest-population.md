# MAT050A conditioned forest population evidence

Date: 2026-09-01

## Packet

- Base: `6155fa7` (MAT040C).
- Branch: `codex/0.6/060-mat050a-forest-population`.
- Scope: internal demand-driven forest / species / patch / individual hierarchy over existing conditioned distributions and marked-point populations.
- Public VKF syntax/API/schema changes: none.
- Renderer changes: none.
- Owned paths:
  - `web/vf-ui/vf-forest-population.mjs`
  - `tests/js/vf-forest-population.test.mjs`
  - `docs/evidence/060-mat050a-forest-population.md`

## Observable internal contract

- A forest remains an immutable conditioned identity until patches are demanded. A zero tree budget realizes no patch, species, candidate, or vector data.
- Patch demand is canonicalized, deduplicated, and sorted by signed integer coordinates. A distant patch is a direct deterministic key and does not traverse intervening terrain.
- Every realized patch uses at most 32 candidate slots. Demand is capped at 2,048 patches and 65,536 trees.
- Each forest retains at most 4,096 patch realizations in least-recently-used order. Weak forest ownership releases all caches with the forest.
- Output is vector-first: positions are packed `Float32Array` triples; growth is a packed `Float32Array` of trunk radius, tree height, crown radius, and crown height; rotations use `Float32Array`; species indices use `Uint32Array`.
- Five conditioned species have stable base-growth and foliage vectors. Species are realized only when selected by a demanded individual.
- Patches select a deterministic dominant species from a fixed internal abundance vector. Each species has its own patch affinity (`0.92`, `0.88`, `0.76`, `0.71`, `0.84`); non-followers draw another conditioned species. Height, crown breadth, and trunk scale then vary independently per tree.
- Repeated demand reuses exact patch objects. Recreated forests reproduce equal packed vectors without sharing traversal state.

## RED to GREEN

1. `e8dc0e7` pinned lazy vector-first forest patch behavior and failed because no forest population module existed.
2. `03fbfd6` added the bounded conditioned forest → patch → species → individual realization hierarchy.
3. `bc8bedd` pinned species affinity, exact growth vectors, order/recreation independence, distant zero-work behavior, and hard caps.

## Executable evidence

Focused affected chain:

```text
node --test tests/js/vf-forest-population.test.mjs tests/js/vf-stone-family-population.test.mjs tests/js/vf-marked-point-candidates.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs
tests 33; pass 33; fail 0
```

Pinned patch `forest:patch:-2:3`:

```text
trees 31; vector bytes 1,116; dominant species 1
species 1 count 23; configured affinity 0.88
used species [tree:species:0, tree:species:1, tree:species:2, tree:species:4]
```

The first two packed positions and growth records are:

```text
positions [-35.81911849975586, 124.33760070800781, 0,
           -46.61162567138672, 100.48876190185547, 0]
growth [0.2778277099132538, 35.113807678222656, 4.00105619430542, 9.85130786895752,
        0.3378499448299408, 33.8768310546875, 4.321210861206055, 9.504270553588867]
```

Real CPU/GPU rock-field parity through Edge `--headless=new`:

```text
outcome pass; records 3; maxAbsoluteError 0.00024956464767456055; maxOctaves 6
streamWords [3982524626, 2941269488, 3065520907, 1471304979]
```

Hidden non-renderer regression capture:

- 58,298-byte PNG.
- SHA-256 `20C7B5A2E8B1BA73F2CA56AEB5B22159F3D5F1AA8D07B3AAA5066A5DEC8F0B7A`.
- Exact parity with MAT030B through MAT040C.
- WebGPU initialized at 1,236 x 725 without initialization/runtime failures; retained rock buffers remained 144, 96, and 96 bytes.

Interleaved hot/cold Node timing used eight patches, a 128-tree budget, 128 realizations per pass, and seven alternating passes. Hot runs reused bounded species/patch state; cold runs recreated the same conditioned forest each iteration:

```text
cold ms: [1466.5668, 1032.7393, 1186.4376, 1469.7737, 2047.8307, 1881.9804, 1804.6720]
hot ms:  [13.2407, 3.4809, 4.4909, 5.9887, 5.8459, 11.9459, 9.7724]
median: cold 1469.7737 ms; hot 5.9887 ms
speedup: 245.4245x
checksum: 19009.99871826172; exact equality on every pass
```

Repository suite:

```text
npm test
tests 514; pass 511; fail 3
```

The same inherited failures remain outside this packet's owned paths:

- generated HTML component catalog is stale;
- symbolic document scope expected `8`, observed `-8`;
- named symbolic function/constant geometry expected `[-5, 625]`, observed `[-5, -624]`.

## Content hashes

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-forest-population.mjs` | `5b4607b27dcfcd73dcbe1054dbbefbf5ca401420` | `21F38620A292D2B9A6844DC03A0849A5BCD931E389B060C7059C1A41A868C2C8` |
| `tests/js/vf-forest-population.test.mjs` | `90b4acb4bb16d4983e2a06db76c40625bd257d42` | `FB33635596ADE26578D8A0EB0A122D6A7D1CCD873B066F7BAB832052BBA9E879` |

## Remaining boundary

This is a non-renderer internal population packet. Species names, botanical presets, tree geometry, bark/leaf realization, and a public forest construction API remain deliberately uncommitted. Later packets can condition those layers from these stable species/individual identities without changing population traversal or vector layout.

Recovery: drop commits after base `6155fa7`; no 0.4 or shared renderer path was touched.
