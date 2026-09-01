# 040-G00 render evidence receipt

## Packet

- Release: 0.4.0, GFX-000 evidence foundation
- Branch: `codex/0.4/040-g00-render-evidence`
- Base commit: `a15e16609d081a125f65b6fe2d2f7c383c39e90d`
- Implementation commit: `b322de2ab7699392f18c183b06e2993d45d5e334`
- Environment: Windows x64, Node.js `v24.11.0`
- Binary/artifact: none; this packet changes browser source and tests only

Owned paths:

- `web/vf-ui/geom/vf-geom-wgpu.js`
- `web/vf-ui/vf-display.js`
- `tests/js/vf-geom-render-evidence.test.cjs`
- `docs/evidence/040-g00-render-evidence.md`

No VKF syntax, public API, shader, generated file, or visual fixture changed.

## RED

Command:

```text
node tests/js/vf-geom-render-evidence.test.cjs
```

The initial run exited 1 in 0.59 seconds with:

```text
TypeError: renderer._debugRenderEvidence is not a function
```

The next vertical cycle exited 1 because an encoded screen-surface pass still
reported `0 !== 1`. The display seam cycle exited 1 because existing display
debug state did not expose `renderEvidence`.

## GREEN

Focused command:

```text
node tests/js/vf-geom-render-evidence.test.cjs
```

Exit 0 in 0.63 seconds. Salient output:

```text
vf-geom render evidence tests passed
```

Affected command:

```text
node tests/js/vf-geom-render-evidence.test.cjs
node tests/js/vf-geom-physics-runtime-hook.test.cjs
node tests/js/vf-display-physics-gpu-pass-through.test.cjs
node tests/js/vf-geom-frame-adapter-hover-dedupe.test.cjs
node tests/js/vf-frame-aspect-resize.test.cjs
node tests/js/vf-runtime-shell-deps.test.cjs
```

All six exited 0 in 0.81 seconds. JavaScript syntax checks for the renderer and
display files also exited 0.

Full-suite command:

```text
npm test
```

Exit 1 in 10.32 seconds: 331 passed and 3 failed. The packet test passed. The
three failures are outside the owned paths and were preserved without retry or
modification:

- stale generated HTML component catalog;
- symbolic document result `-8` versus expected `8`;
- symbolic literal geometry result `-624` versus expected `625`.

## Source hashes

| Source | Base Git blob | GREEN Git blob | GREEN SHA-256 |
|---|---|---|---|
| `web/vf-ui/geom/vf-geom-wgpu.js` | `b79ea1e1378a33ed7cae8583fd5ff353c6396345` | `e2d8fd59e6f5226fc52c0116bbc8e4da28b67b6d` | `63c6884e0551afbdf0fed93f7496e2007d668e239ddb180cb2ceb7727a83f06d` |
| `web/vf-ui/vf-display.js` | `0088da3f9b027359ac5ffeebeb9b4d5424d3992b` | `5ba0e5717052dae5eb24e6bf524c76801ab7fec3` | `1380a6dc20348661091166903d9d4ce21790ec852b5f124cff5afa8146a7c1b5` |
| `tests/js/vf-geom-render-evidence.test.cjs` | absent | `48ce3ad15aff28d7353da5faee10231ae01c6670` | `76d4b5bb9bc1593a9024e8ab27d8b3e2736214fd91074ae3412e56db7c522b98` |

## Accounting boundary

`surfaceTargetPixels` counts live logical surface-target pixels owned by the
renderer. `surfaceTargetBytes` deterministically accounts for the resolved
color attachment, multisampled color attachment, and multisampled depth
attachment. WebGPU leaves `depth24plus` physical storage implementation-defined,
so the receipt assigns it a logical 32-bit-per-sample footprint. This is stable
cross-device accounting for comparisons, not a claim about physical VRAM.

`shadowDraws` counts encoded shadow `drawIndexed` calls, `shadowCacheHits`
counts reused light-shadow entries, and `activeLights` is bounded to the four
lights consumed by the current renderer. Receipts contain no wall-clock field,
so identical renderer state produces identical evidence values.
