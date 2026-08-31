# 0.4.0 retained cloud indicator evidence

Status: evidence-only baseline. This comparison does not carry a `<1.5x` release ratchet. Correctness and retention remain hard gates.

## Result

The six valid raw WebGPU, Three.js, and deck.gl rows passed the frozen correctness oracle and retained-fixture gate in three independent hidden-browser runs. Both shipped VKF `marker_impostor` rows failed the common opaque-point oracle deterministically, so they have cold/retention/capture evidence but no timing. No VKF timing result or peer ratio is claimed.

The primary scheduling values below are rAF **callback intervals**, not proof of display presentation. GPU pass duration is available only for the raw WebGPU floor. Serialized submit-to-completion is a separate diagnostic and must not be treated as equivalent to callback pacing or GPU timestamps.

| Backend | Size | Correctness | rAF mean ± run SD (ms) | 95% CI of mean (ms) | p50 / p95 / p99 / max (ms) | Missed 60 / 30 Hz | GPU timestamp mean (ms) | Serialized mean (ms) | Cold first-visible mean (ms) |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| raw WebGPU floor, discrete point | 1 px | pass | 16.884 ± 0.385 | 15.927–17.840 | 16.662 / 16.769 / 27.899 / 27.947 | 44.0% / 0.7% | 47.596 | 51.091 | 1305.6 |
| Three.js r185, retained discrete layer | 1 px | pass | 86.031 ± 19.592 | 37.363–134.699 | 86.068 / 177.701 / 205.670 / 222.180 | 91.3% / 83.7% | unavailable | 0.121 | 146.0 |
| deck.gl 9.3.11, retained discrete layer | 1 px | pass | 161.731 ± 31.911 | 82.459–241.004 | 138.861 / 312.147 / 467.186 / 533.088 | 99.0% / 97.3% | unavailable | 1.016 | 475.6 |
| shipped VKF WebGPU `marker_impostor` | 1 px | **unsupported: frame 50, 0.158608 > 0.15** | withheld | withheld | withheld | withheld | withheld | withheld | 20227.2 |
| raw WebGPU floor, analytic circle | 4 px | pass | 16.827 ± 0.169 | 16.408–17.246 | 16.663 / 16.871 / 18.190 / 33.717 | 44.7% / 0.7% | 67.744 | 67.339 | 1176.7 |
| Three.js r185 `Points` | 4 px | pass | 49.600 ± 4.243 | 39.060–60.141 | 49.977 / 99.844 / 111.156 / 116.667 | 89.7% / 70.3% | unavailable | 0.103 | 212.7 |
| deck.gl 9.3.11 `ScatterplotLayer` | 4 px | pass | 133.184 ± 20.227 | 82.938–183.431 | 127.823 / 236.121 / 305.539 / 311.333 | 97.7% / 96.0% | unavailable | 1.513 | 723.2 |
| shipped VKF WebGPU `marker_impostor` | 4 px | **unsupported: frames 25/50, max 0.167135 > 0.15** | withheld | withheld | withheld | withheld | withheld | withheld | 20269.6 |

The p50/p95/p99/max and missed-deadline entries are arithmetic means of the corresponding statistics from the three independent runs. The artifact retains every run separately, including all 100 raw measured samples per valid timing lane. Percentiles use R-7 linear interpolation; run-level confidence intervals use a two-sided Student t interval with 2 degrees of freedom.

## Frozen protocol

- 1,000,000 immutable XYZ + RGBA8 points; fixture SHA-256 `469116dd54fbf3bcf2a061cbbd81a27bbb9d17c5bc0d1f2804fc70d4ce5a9104`.
- 1280×720 framebuffer, DPR 1, 4× MSAA, sRGB canvas, premultiplied-alpha source-over, depth compare `less`, depth write enabled.
- Deterministic 100-frame orbit; captures at frames 0, 25, 50, 75, and 100 before timing; 0↔2π closure required.
- Per valid lane and independent run: 60 rAF warmups + 100 measured callbacks, one final queue drain; then 60 serialized warmups + 100 measured submit-to-completion operations and a second drain.
- Fixture buffers are uploaded once. Any fixture write, mapping, copy, reallocation, or identity change after initialization invalidates timing; bounded camera-uniform writes remain permitted.
- Fixed suite order: repeat, then 1 px/4 px, then raw WebGPU/Three.js/deck.gl/VKF. No adaptive batching.

## Environment and provenance

- Package version: `0.4.0`.
- Tested source commit: `aa2e5250cd053fdb6dec861488a4a40e607dc78b`.
- Benchmark source hash: `fce0f8e7251f8c8a7f9487aa0c0d8ab3e080c5fb4d4fd0c315e677613a7521cd`.
- Protocol hash: `e7ae5935fdf0bf2af9cad582004a2efcffb05ef14da054727bb9592ef1796939`.
- Environment hash: `00a295987babac3433caffdb1240930d65566637aa46e998b6a223b29dea3c83`.
- Windows 10.0.26200 x64; Intel Core Ultra 7 255U; Intel Xe-LPG hardware; Microsoft Edge 152; hidden/offscreen browser; no visible windows.
- Artifact: [`040-retained-cloud-indicator.json`](artifacts/040-retained-cloud-indicator.json), SHA-256 `9af2df3b5ba7ea6bc792a567ca52a8c735a579478d11927ea2f5297fcf9b6484`.
- First-run PNG captures: [`040-retained-cloud-indicator-captures/`](artifacts/040-retained-cloud-indicator-captures/), 40 files with per-file SHA-256 and byte length in the artifact.

The VKF failures are not performance losses. They are responsibility mismatches: the shipped marker shader uses antialiased premultiplied blending and depth-correct sphere fragments, while the common peer oracle requires nearest opaque discrete/circular points. Timing is intentionally withheld until Viktor decides whether VKF should add an exact flat/opaque marker mode, retain the rows as unsupported, or leave VKF out of this comparison.
