# 0.4.0 retained cloud indicator evidence

Status: evidence-only baseline. This comparison does not carry a `<1.5x` release ratchet. Correctness and retention remain hard gates.

## Result

All eight raw WebGPU, Three.js, deck.gl, and VKF rows passed the frozen correctness oracle and retained-fixture gate in three independent hidden-browser runs. The VKF lanes use a benchmark-internal exact flat opaque marker pipeline over the shipped renderer's retained buffers; the public lit `marker_impostor` defaults are unchanged. No peer ratio or release threshold is claimed.

The primary scheduling values below are rAF **callback intervals**, not proof of display presentation. GPU pass duration is available only for the raw WebGPU floor. Serialized submit-to-completion is a separate diagnostic and must not be treated as equivalent to callback pacing or GPU timestamps.

| Backend | Size | Correctness | rAF mean ± run SD (ms) | 95% CI of mean (ms) | p50 / p95 / p99 / max (ms) | Missed 60 / 30 Hz | GPU timestamp mean (ms) | Serialized mean (ms) | Cold first-visible mean (ms) |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| raw WebGPU floor, discrete point | 1 px | pass (max error 0.103906) | 17.618 ± 0.125 | 17.308–17.929 | 17.862 / 18.562 / 25.243 / 26.837 | 97.3% / 0.7% | 55.105 | 61.671 | 2868.1 |
| Three.js r185, retained discrete layer | 1 px | pass (max error 0.000312) | 104.308 ± 10.498 | 78.230–130.385 | 101.371 / 213.113 / 228.111 / 238.262 | 100.0% / 85.0% | unavailable | 0.120 | 273.2 |
| deck.gl 9.3.11, retained discrete layer | 1 px | pass (max error 0.000312) | 242.819 ± 25.511 | 179.447–306.191 | 239.555 / 358.513 / 423.186 / 429.423 | 100.0% / 97.3% | unavailable | 1.652 | 1508.7 |
| VKF internal exact-flat retained marker | 1 px | pass (max error 0.103906) | 61.839 ± 8.292 | 41.240–82.437 | 59.782 / 88.631 / 101.263 / 101.690 | 100.0% / 98.3% | unavailable | 48.579 | 28713.5 |
| raw WebGPU floor, analytic circle | 4 px | pass (max error 0.052151) | 17.842 ± 0.235 | 17.258–18.426 | 17.896 / 18.606 / 24.160 / 24.480 | 98.7% / 0.7% | 77.211 | 79.280 | 2566.2 |
| Three.js r185 `Points` | 4 px | pass (max error 0.000858) | 60.687 ± 2.810 | 53.707–67.667 | 53.998 / 124.785 / 137.256 / 138.343 | 99.3% / 82.7% | unavailable | 0.158 | 399.3 |
| deck.gl 9.3.11 `ScatterplotLayer` | 4 px | pass (max error 0.045511) | 169.371 ± 21.517 | 115.919–222.823 | 166.694 / 276.065 / 346.871 / 363.608 | 100.0% / 95.7% | unavailable | 1.755 | 1157.7 |
| VKF internal exact-flat retained marker | 4 px | pass (max error 0.055769) | 77.332 ± 9.105 | 54.714–99.950 | 77.652 / 107.719 / 114.786 / 125.408 | 100.0% / 99.0% | unavailable | 83.862 | 27752.8 |

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
- Tested source commit: `dd7882c8531f3a4700f6585ec2d63171d7d19cee`.
- Benchmark source hash: `c083d54c524b395c1a695af133357aebf8a59d921a16b852885c1f1538862109`.
- Protocol hash: `e7ae5935fdf0bf2af9cad582004a2efcffb05ef14da054727bb9592ef1796939`.
- Environment hash: `00a295987babac3433caffdb1240930d65566637aa46e998b6a223b29dea3c83`.
- Windows 10.0.26200 x64; Intel Core Ultra 7 255U; Intel Xe-LPG hardware; Microsoft Edge 152; hidden/offscreen browser; no visible windows.
- Artifact: [`040-retained-cloud-indicator.json`](artifacts/040-retained-cloud-indicator.json), SHA-256 `331dea0754ed71e75a0957b4984e030d9b81012b192a86524a2176bd340001cea`.
- First-run PNG captures: [`040-retained-cloud-indicator-captures/`](artifacts/040-retained-cloud-indicator-captures/), 40 files with per-file SHA-256 and byte length in the artifact.
- End-to-end hidden hardware suite wall time: 1330.826 seconds (22 minutes 10.826 seconds).

The earlier VKF failures were responsibility mismatches: the shipped marker shader uses antialiased premultiplied blending and depth-correct sphere fragments, while the common peer oracle requires nearest opaque discrete/circular points. The benchmark now selects an internal exact-flat pipeline without adding a public marker mode; its timing is therefore specific to that benchmark responsibility, not the public lit marker default.
