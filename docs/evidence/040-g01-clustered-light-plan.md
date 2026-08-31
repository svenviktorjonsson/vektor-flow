# 040-G01 clustered-light planner evidence

Recorded: 2026-08-31 07:22:09 +02:00

## Packet identity

- Base commit: `a15e16609d081a125f65b6fe2d2f7c383c39e90d`
- Implementation head: `4312e8660c7764c833055e9f85a822dcd2c48ba3`
- Implementation tree: `2d8a9fce8c93aa42054430bca1971019192d5898`
- Module SHA-256: `e0bb67084aba93b38bc7225642be531850b7c39e0c27f15072dd94c4ddf9f4cc`
- Test SHA-256: `a899225e62f7bbb1a2fbc8e245d64634316123e3d60ac17b8c653d3ff6180956`

## Owned paths

- `web/vf-ui/geom/vf-clustered-light-plan.mjs`
- `tests/js/vf-clustered-light-plan.test.mjs`
- `docs/evidence/040-g01-clustered-light-plan.md`

No package export, renderer integration, shader, or public VKF contract changed.

## RED evidence

Command for every focused cycle:

```text
node --test tests/js/vf-clustered-light-plan.test.mjs
```

Observed failures before their corresponding implementation:

1. Initial point-light test failed with `ERR_MODULE_NOT_FOUND` because the
   planner did not exist.
2. Spot/projected coverage failed with `TypeError: light.kind must be point`.
3. Overflow evidence failed because `candidateAssignmentCount` was
   `undefined` instead of `5`.
4. Exact cluster-boundary coverage failed with occupied clusters `[]` instead
   of `[5]`.
5. Allocation safety failed with `Missing expected exception`; the unchecked
   1,049,600-cluster grid allocated before the test completed.

## GREEN evidence

At implementation head `4312e86`:

```text
node --test tests/js/vf-clustered-light-plan.test.mjs
```

Result: 5 tests passed, 0 failed. Proven behavior:

- deterministic x-fast screen/log-depth cluster assignment;
- identical plans after input shuffling;
- point, spot, and projected bounds share the bounded planner;
- bounds outside the frustum produce no assignments;
- per-cluster retention is capped and overflow has fixed-size per-cluster plus
  aggregate evidence;
- zero-volume bounds on an exact cluster boundary remain assigned; and
- cluster counts above the explicit internal 1,048,576 limit fail before
  cluster storage allocation.

Implementation commits:

- `6ab1f23` — point assignment and frustum culling
- `b07b136` — spot/projected kinds and stable ID ordering
- `da98f54` — bounded retention and overflow evidence
- `e061bee` — exact-boundary retention
- `222090d` — exact cluster-coordinate assertions
- `4312e86` — pre-allocation cluster-count guard

## Full JavaScript suite baseline

Command at implementation head:

```text
npm test
```

Result: 338 tests, 335 passed, 3 failed. All five owned focused tests passed.
The failures are outside the owned paths:

- `vf-html-component-catalog-generated.test.cjs`: generated HTML component
  catalog is stale relative to `spec/html-component-identities.json`.
- `vf-symbolic-document.test.mjs`: expected `8`, received `-8`.
- `vf-symbolic-literal-geometry.test.mjs`: expected `[-5, 625]`, received
  `[-5, -624]`.

The packet does not modify the catalog or symbolic implementation involved in
those failures.
