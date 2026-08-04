import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ColorScaleMode,
  mapComplexColorScale,
  normalizeColorScale,
  normalizeColorScaleValue,
} from '../../web/vf-ui/vf-color-scale.mjs';

import { buildSymbolicPlotStyle } from '../../web/vf-ui/vf-symbolic-plot-controller.mjs';

test('color scales default to normalized clamp domains', () => {
  assert.deepEqual(normalizeColorScale(), {
    domain: [0, 1],
    magnitudeDomain: [0, 1],
    mode: ColorScaleMode.CLAMP,
  });
  assert.equal(normalizeColorScaleValue(-2), 0);
  assert.equal(normalizeColorScaleValue(2), 1);
});

test('cyclic color scales repeat in both directions', () => {
  const scale = { domain: [10, 20], mode: ColorScaleMode.CYCLIC };
  assert.equal(normalizeColorScaleValue(22.5, scale), 0.25);
  assert.equal(normalizeColorScaleValue(7.5, scale), 0.75);
  assert.equal(normalizeColorScaleValue(20, scale), 0);
});

test('complex scales map phase to position and magnitude to clamped alpha', () => {
  const scale = { magnitudeDomain: [0, 2], mode: ColorScaleMode.CYCLIC };
  assert.deepEqual(mapComplexColorScale({ real: -1, imaginary: 0 }, scale), {
    phase: Math.PI,
    position: 0,
    magnitude: 1,
    alpha: 0.5,
  });
  assert.equal(mapComplexColorScale({ real: 0, imaginary: 4 }, scale).alpha, 1);
});

test('color scale validation rejects ambiguous domains and modes', () => {
  assert.throws(() => normalizeColorScale({ domain: [1, 1] }), RangeError);
  assert.throws(() => normalizeColorScale({ mode: 'mirror' }), TypeError);
});
test('plot styles expose normalized color scale metadata while accepting legacy domains', () => {
  const style = buildSymbolicPlotStyle(
    { edge: [1, 1, 1, 1], face: [1, 1, 1, 1], valueMin: -2, valueMax: 2 },
    null,
    { magnitudeDomain: [0, 4], mode: ColorScaleMode.CYCLIC }
  );
  assert.deepEqual(
    {
      domain: [style.valueMin, style.valueMax],
      magnitudeDomain: [style.magnitudeMin, style.magnitudeMax],
      mode: style.colorScaleMode,
    },
    { domain: [-2, 2], magnitudeDomain: [0, 4], mode: ColorScaleMode.CYCLIC }
  );
});
