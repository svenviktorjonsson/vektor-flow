# 040-P01 large-scene visualization benchmark contract

Recorded: `2026-08-31T14:44:19+02:00`

## Scope

- Base: `cdcfb8e21292fe98bd855e51ea19c891bc06a523`
- Implementation: `ae3d44feb7dcaaa594963844655d328ed83107e6`
- Research/contract documentation: `2e5b994762ce9c2f5882458aa4a0e922f1784e4a`
- Correctness-oracle hardening: `682270ed8a83f5ec2353bf38a0e2069d8a930b9a`
- No public VKF API, renderer, syntax, schema, or ABI changed.
- No browser was launched; all work was Node-only.

## Official-source peer selection

| Peer | Research pin | Primary evidence |
| --- | --- | --- |
| deck.gl | `@deck.gl/core` + `@deck.gl/layers` 9.3.11 | [performance guidance](https://deck.gl/docs/developer-guide/performance), [ScatterplotLayer](https://deck.gl/docs/api-reference/layers/scatterplot-layer) |
| VTK.js | `@kitware/vtk.js` 36.10.0 | [official repository](https://github.com/Kitware/vtk-js), [Mapper](https://kitware.github.io/vtk-js/api/Rendering_Core_Mapper.html), [SphereMapper](https://kitware.github.io/vtk-js/api/Rendering_Core_SphereMapper.html) |
| Plotly.js | `plotly.js-dist-min` 4.0.0 | [scattergl reference](https://plotly.com/javascript/reference/scattergl/), [100k/1m WebGL examples](https://plotly.com/javascript/webgl-vs-svg/) |

`regl` was reviewed from its [official repository](https://github.com/regl-project/regl)
but excluded from published rows because it is a low-level rendering building
block rather than an equivalent visualization product. luma.gl is not duplicated
as a peer because the selected deck.gl lane already consumes that stack.

The exact versions above were queried from the official npm registry. They are
manifest research pins only; peer dependencies were not installed or executed.

## Reproducibility and equivalence

- Workloads: 100,000 fixed points and 1,000,000 points under the same camera-only
  pan at 1280×720, DPR 1.
- Positions are generated as packed float32 `x,y` using `vkf-point-mix-v1` and
  seed `144862629`.
- 100k fixture SHA-256:
  `c1b3e0a927e822fc113ac65c24254565a00ed0794a1bdb59fe0001c0fcb87e63`.
- 1m fixture SHA-256:
  `1520b7e81a98109b762d554900540824cb942b4f7c6bfc44b5695035893d9e5d`.
- File SHA-256 of `manifest.json`:
  `49ac4218fe397e7eadc6ddf247c6877edb48eb97c4256a682f354bc23d1425b8`.
- Canonical manifest contract SHA-256 embedded in the scaffold:
  `c9a0d712bda981f12613f9857fadd835e2b82bd898aece31164d3b23884f4400`.
- File SHA-256 of `results/scaffold.json`:
  `669c82f7da2ac6686d011c18d94eec8ba9a26fe31c42cdaa55d9741a6db3a7ec`.
- Every measured lane must upload the same position bytes during preparation;
  measured pan frames may update only the camera. Data rebuild/reupload makes a
  lane noncomparable.

## TDD receipt

RED sequence:

1. focused test failed because `contract.mjs` did not exist;
2. executable-scaffold test failed because `run.mjs` did not exist;
3. equivalence test failed because the manifest had not yet frozen `dataMutation:
   none` and the camera-only pan responsibility;
4. ratchet test showed that a VKF-only timing could be mislabeled published.
5. oracle-contract test failed until the exact camera formula, ideal-disc
   reference, 8×8 subpixel grid, and region channels were manifest data.

GREEN behavior:

- generated fixtures reproduce their pinned hashes;
- publishable rows require exact dataset/workload hashes, framebuffer oracle
  evidence, bounded region error, and correctness completion before timing;
- a peer cannot publish without VKF and VKF cannot publish without a peer;
- every individual 0.4 row requires `VKF median / peer median < 1.5`; equality
  fails;
- the `<0.5` target is present but deferred to 0.6;
- the checked-in scaffold has no timing or correctness fields and prints an
  explicit no-performance-claim result.

## Commands and results

```text
npm run test:large-scene-benchmark-harness
9 tests passed
verified 2 generated point fixtures
scaffold only: 0 published comparisons; no performance claim

npm test
395 tests: 394 passed, 1 expected portable-archive skip, 0 failed
```

## Honest limitation

This packet establishes the comparable contract and enforcement machinery, not
a speed baseline. VKF and peer browser adapters, hidden/headless GPU execution,
framebuffer captures, and measured reports remain future work. In particular,
the existing VKF point renderer needs an internal camera-uniform update seam so
the one-million-point pan does not pass through its point-buffer upload path.
Until that is implemented and the shared correctness oracle passes for every
lane, the repository makes no large-scene performance claim.
