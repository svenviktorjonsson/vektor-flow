# MAT070J: wood spectral presentation GPU descriptor

Status: private 0.6 GPU descriptor tracer. No public VKF syntax, material
property, schema, ABI, diagnostic, compiler lowering, renderer, or gallery
changed.

## Versioned f32 schema

`wood-spectral-presentation-gpu:v1` is one 16-byte-aligned f32 buffer with
three contiguous sections:

```text
vec4 0..2   version, counts, exposure, HDR and layout constants
vec4 3..83  81 CIE 1931 2-degree observer records at 5 nm
vec4 84..   unchanged wood-polarization-gpu:v1 bytes
```

The header carries schema version 1, basis and wood record counts, exposure
stops and multiplier, maximum linear HDR, the largest f32 display value below
one, visible wavelength bounds, basis step, and wood header/stride sizes.
The 81 basis rows reuse MAT070G's committed official CIE samples rather than
duplicating color data. The wood section is copied without reinterpretation.

Validation checks metadata, total byte length, every f32 header lane, every CIE
basis lane, and every source wood lane. The focused corruption test changes
only the packed version and is rejected before GPU consumption.

## Independent GPU consumer

The private WGSL compute tracer reads the packed schema, linearly interpolates
reflected Stokes intensity between wood wavelengths, integrates all CIE rows,
normalizes equal-energy Y, converts XYZ to linear sRGB, applies packed exposure,
and applies the packed peak-Reinhard presentation constants. It does not read
the CPU color result.

TDD RED was the missing descriptor module. The first off-screen run then found
two reserved WGSL names, `meta` and `layout`. After those were renamed, hardware
parity found a wrong header component selection (`780` rather than wood header
size `4`). Correcting the component produced GREEN.

Off-screen WebGPU evidence:

```json
{"outcome":"pass","records":3,"maxAbsoluteError":0,
 "bundledBytes":1456,
 "bundledMaxAbsoluteError":1.4901161194e-7,
 "linearHdrRgb":[0.2869574148,0.1844956818,0.0552520860],
 "displayLinearRgb":[0.3646416050,0.2344417606,0.0702097533]}
```

The fixture ran in headless Edge with no visible window. The established
Windows temporary-profile cleanup deferred a locked directory after the
successful evidence result; GPU parity was unaffected.

Relevant MAT070 regression evidence is recorded after colorimetry,
absorbing-Fresnel, rough-GGX, wood GPU, presentation, and descriptor tests pass
together:

```text
19 passed, 0 failed
```

## Acceptance-gate impact

Renderer integration now has one validated private GPU record containing the
spectral basis, polarized material data, and presentation policy needed to
reconstruct the observable color independently. Conservative estimated 0.6.0
completion is **50.9%**, up **0.4 percentage points** from MAT070I's 50.5%.
Main-renderer/compiler consumption, shared descriptor allocation, and
released-scene capture evidence remain open.
