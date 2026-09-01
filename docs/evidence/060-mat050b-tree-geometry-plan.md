# MAT050B lazy tree geometry planning evidence

Date: 2026-09-01

## Packet

- Base: `4cf54df` (MAT050A).
- Branch: `codex/0.6/060-mat050b-tree-geometry-plan`.
- Scope: internal demand-driven trunk, crown, branch, and foliage-cluster planning over MAT050A forest population vectors.
- Public VKF syntax/API/schema changes: none.
- Renderer changes: none.
- Owned paths:
  - `web/vf-ui/vf-tree-geometry-plan.mjs`
  - `tests/js/vf-tree-geometry-plan.test.mjs`
  - `docs/evidence/060-mat050b-tree-geometry-plan.md`

## Observable internal contract

- A tree realizes two stable coarse primitives first: trunk and crown. Detail level 1 appends four conditioned branches; detail level 2 appends four foliage clusters to each branch. A fully planned tree therefore contains 22 primitives.
- Multi-tree demand is canonicalized by tree index, deduplicated at the greatest demanded detail, and served coarse-first across every tree before any fine primitive consumes the remaining budget.
- Tree and primitive identities are deterministic and independent of request order, duplication, chunking, planner recreation, and unrelated forest demand.
- Growth and position cache identities retain the exact IEEE-754 bit patterns. Repeated refinement reuses the same immutable primitive objects.
- Demand is capped at 4,096 trees and 65,536 primitives. A zero primitive budget realizes no tree or vector storage. The planner retains at most 8,192 tree states in least-recently-used order.
- Output is vector-first: kind and level use `Uint8Array`, owner uses `Uint32Array`, parent uses `Int32Array`, and each packed `Float32Array` transform stores position, direction, length, and radius.
- The packed working-set cost is exactly 42 bytes per primitive. One coarse tree is 84 bytes; one fully refined tree is 924 bytes.

## RED to GREEN

1. `0da45a2` pinned lazy coarse-to-fine hierarchy behavior and failed because no tree geometry planner existed.
2. `daef944` implemented deterministic bounded vector-first planning without touching a renderer or public contract.
3. `36410ee` pinned hierarchy transforms, parent identities, coarse-first budget fairness, order/recreation independence, and hard caps.

## Executable evidence

Focused affected chain:

```text
node --test tests/js/vf-tree-geometry-plan.test.mjs tests/js/vf-forest-population.test.mjs tests/js/vf-marked-point-candidates.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs
tests 33; pass 33; fail 0
```

Pinned first tree:

```text
coarse primitives 2; vector bytes 84
full primitives 22; vector bytes 924
kinds trunk, crown, 4 branches, 16 foliage clusters
```

Pinned bounded two-tree request with a five-primitive budget:

```text
kinds [trunk, crown, trunk, crown, branch]
owners [0, 0, 1, 1, 0]
parents [-1, -1, -1, -1, 0]
vector bytes 210
```

Real CPU/GPU rock-field parity through Edge `--headless=new`:

```text
outcome pass; records 3; maxAbsoluteError 0.00024956464767456055; maxOctaves 6
streamWords [3982524626, 2941269488, 3065520907, 1471304979]
```

Hidden non-renderer regression capture:

- 58,298-byte PNG.
- SHA-256 `20C7B5A2E8B1BA73F2CA56AEB5B22159F3D5F1AA8D07B3AAA5066A5DEC8F0B7A`.
- Exact parity with MAT030B through MAT050A.
- WebGPU initialized at 1,236 x 725 without initialization/runtime failures; retained rock buffers remained 144, 96, and 96 bytes.

Node timing used 64 fully refined trees (1,408 primitives), 256 plans per pass, and seven passes. Retained runs reused bounded immutable tree/level state; cold runs recreated the planner each iteration. Every measured result had the same output checksum:

```text
cold median 3210.3421 ms; retained median 686.6225 ms
speedup 4.6756x
working set 59,136 vector bytes (42 bytes x 1,408 primitives)
checksum 1408:59136:tree:v1:candidate:v1:a9c73dfd:2aa5c422:650522d6:44b2341e:trunk:tree:v1:candidate:v1:03bf34cc:a8dc7a8b:0d05acfc:f3d8c4fb:branch:3:foliage:3:-35.81911849975586:0.7746865153312683
```

Repository suite:

```text
npm test
tests 517; pass 513; fail 4
```

The same three inherited functional failures remain outside this packet's owned paths:

- generated HTML component catalog is stale;
- symbolic document scope expected `8`, observed `-8`;
- named symbolic function/constant geometry expected `[-5, 625]`, observed `[-5, -624]`.

The full parallel suite also exceeded the 50 ms point-projection timing gate once (`68.6 ms`). Its isolated rerun passed all three tests and projected 100,000 points in `6.7399 ms`; this is host-load timing noise, not a tree-planner regression.

## Content hashes

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-tree-geometry-plan.mjs` | `bf58711d1537dfc3889e190347111dce1ee90b08` | `DECF17389119FA78F3867B8FE9EB572BED92CA804F69ECF02DD18AFA9A870F39` |
| `tests/js/vf-tree-geometry-plan.test.mjs` | `369071c5d1c1b2af8bce0152ff21c79609974437` | `B1EA93F100C7CFB39F83DCD2B73B2E75B09D68F709F3CB80680CC708D5325529` |

## Remaining boundary

This packet plans geometry only. Renderer mesh realization, view/frustum-to-tree detail demand, bark and leaf material packets, botanical species names, and a public tree/forest API remain deliberately uncommitted. A later internal adapter can consume the packed hierarchy without changing its identities, budget ordering, or vector layout.

Recovery: drop commits after base `4cf54df`; no 0.4 or shared renderer path was touched.
