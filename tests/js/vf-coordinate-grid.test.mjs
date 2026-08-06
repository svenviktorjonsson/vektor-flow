import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  AXIS_DISPLAY_MODES,
  GRID_DISPLAY_MODES,
  buildCoordinateGridScene
} from '../../web/vf-ui/vf-coordinate-grid.mjs';

const worldToScreen = ([x, y]) => [160 + x * 40, 100 - y * 40];
const screenToWorld = ([x, y]) => [(x - 160) / 40, (100 - y) / -40];
const base = {
  width: 320,
  height: 200,
  interval: 2,
  xInterval: 2,
  yInterval: 2,
  worldToScreen,
  screenToWorld
};

const coordinateGridSource = await readFile(
  new URL('../../web/vf-ui/vf-coordinate-grid.mjs', import.meta.url),
  'utf8'
);
assert.doesNotMatch(
  coordinateGridSource,
  /import\s+\w+\s+from\s+['"]\.\/vf-axis2d-ticks\.js['"]/,
  'browser ESM cannot default-import the legacy UMD tick module'
);

assert.deepEqual(AXIS_DISPLAY_MODES, ['none', 'regular', 'complex']);
assert.deepEqual(GRID_DISPLAY_MODES, ['lines', 'points', 'triangular', 'polar', 'none']);

const dotted = buildCoordinateGridScene({ ...base, gridMode: 'points', axisMode: 'none' });
assert.equal(dotted.lines.length, 0);
assert.ok(dotted.points.length > 0);

const triangular = buildCoordinateGridScene({ ...base, gridMode: 'triangular', axisMode: 'none' });
assert.equal(triangular.lines.length, 0);
assert.ok(triangular.points.some((point) => point.kind === 'triangular-point'));

const polar = buildCoordinateGridScene({ ...base, gridMode: 'polar', axisMode: 'none' });
assert.ok(polar.circles.length > 0);
assert.ok(polar.lines.some((line) => line.kind === 'polar-ray'));

const regular = buildCoordinateGridScene({ ...base, gridMode: 'lines', axisMode: 'regular' });
assert.equal(regular.axes.length, 2);
assert.ok(regular.labels.length > 0);
assert.ok(regular.labels.every((label) => typeof label.latex === 'string'));
assert.deepEqual(regular.axisLabels.map(({ latex }) => latex), ['x', 'y']);

const complex = buildCoordinateGridScene({ ...base, gridMode: 'none', axisMode: 'complex' });
assert.deepEqual(complex.axisLabels.map(({ latex }) => latex), ['\\operatorname{Re}', '\\operatorname{Im}']);
assert.ok(complex.ticks.length > 0, 'axis ticks remain visible when the grid is hidden');
assert.ok(complex.ticks.every((tick) => tick.kind.startsWith('axis-tick-')));
assert.equal(dotted.ticks.length, 0, 'ticks belong to the axis, not the grid');
