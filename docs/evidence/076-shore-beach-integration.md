# 0.6 shore/beach integration reference

Status: private evidence packet. This does not add public VKF syntax, general
water, erosion, fluid motion, or measured beach/geology defaults.

## Contract

`vf-shore-beach-reference.mjs` evaluates one conditioned terrain-height field.
The same retained samples and water level determine submerged/wet/dry
membership, exposed sediment depth, extracted waterline segments, stone support
height, and every renderer packet's `sourceRevision`.

The plausible slope, beach widths, sediment colors, and stone placement are
artist-authored bounded reference conditions. They are not field measurements.
The water surface is static geometry and is not presented as fluid physics.

## RED to GREEN

The first focused run failed because the private shore/beach module did not
exist. GREEN proves:

- exact same-seed replay, seed variation, and deterministic water-level change;
- shore membership and sediment use the exact retained height/water truth;
- submerged samples contain no sediment;
- ten stones (two per existing internal geology species) retain exact terrain
  support with no floating gap and remain above the retained water level;
- terrain, sediment, water, and stone packets share one revision;
- finite indices/vertices and less than 8 MiB retained vector storage.

## Real WebGPU capture

`076-shore-beach-webgpu.png` is a 2017x865 Chrome WebGPU frame. It shows the
conditioned shore boundary, static water surface, wet/dry sediment transition,
and ten existing procedural stones supported on that terrain. Visual inspection
found the boundary visible and all stones grounded. Application exception state
was empty. Renderer initialization reached WebGPU successfully. The installed
WebGPU developer extension emitted its own known extension errors; those are not
application/WGPU errors and are excluded explicitly.

- SHA-256: `6D5FB2779CD1B051A757984037035B196C0D86146C001D5D946DDF8BC6A0AA61`

## Files

- `web/vf-ui/vf-shore-beach-reference.mjs`
- `tests/js/vf-shore-beach-integration.test.mjs`
- `tests/fixtures/shore-beach.html`
- `tests/fixtures/shore-beach-scene.mjs`
- `docs/evidence/076-shore-beach-webgpu.png`
