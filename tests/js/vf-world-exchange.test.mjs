import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createVkfWorld,
  parseVkfWorld,
  serializeVkfWorld
} from '../../web/vf-ui/vf-world-exchange.mjs';
import { exportVkfWorldSvg, importVkfWorldSvg } from '../../web/vf-ui/vf-world-svg.mjs';
import { exportVkfWorldStep, importVkfWorldStep } from '../../web/vf-ui/vf-world-step.mjs';

const triangle2d = () => createVkfWorld({
  dimension: 2,
  units: { length: 'm' },
  geometry: {
    vertices: [
      { id: 'a', position: [0, 0], properties: { color: '#f00' } },
      { id: 'b', position: [2, 0] },
      { id: 'c', position: [0, 1] }
    ],
    edges: [
      { id: 'ab', vertices: ['a', 'b'] },
      { id: 'bc', vertices: ['b', 'c'] },
      { id: 'ca', vertices: ['c', 'a'] }
    ],
    faces: [{ id: 'abc', vertices: ['a', 'b', 'c'], properties: { fill: '#888' } }]
  },
  extensions: { 'platonic-play': { expressions: [{ source: 'x^2' }] } }
});

test('VKF world JSON is canonical and immutable', () => {
  const world = parseVkfWorld(serializeVkfWorld(triangle2d()));
  assert.equal(world.format, 'vkf.world');
  assert.equal(world.dimension, 2);
  assert.deepEqual(world.geometry.vertices[0].position, [0, 0]);
  assert.ok(Object.isFrozen(world.geometry.faces[0].vertices));
  assert.throws(() => createVkfWorld({
    dimension: 2,
    geometry: { vertices: [{ id: 'a', position: [0, 0] }], edges: [{ id: 'e', vertices: ['a', 'missing'] }] }
  }), /Unknown geometry reference/);
});

test('SVG carries an exact VKF world and remains ordinary vector geometry', () => {
  const source = triangle2d();
  const svg = exportVkfWorldSvg(source);
  assert.match(svg, /<polygon/);
  assert.match(svg, /<polyline/);
  assert.deepEqual(importVkfWorldSvg(svg), source);
});

test('generic SVG polygons become faces with shared edges', () => {
  const world = importVkfWorldSvg('<svg><polygon points="0,0 10,0 10,10 0,10" fill="#f00"/></svg>');
  assert.equal(world.geometry.faces.length, 1);
  assert.equal(world.geometry.edges.length, 4);
  assert.deepEqual(world.geometry.vertices.at(-1).position, [0, -10]);
});

test('faceted STEP carries an exact 3D VKF world', () => {
  const source = createVkfWorld({
    dimension: 3,
    geometry: {
      vertices: [
        { id: 'a', position: [0, 0, 0] },
        { id: 'b', position: [1, 0, 0] },
        { id: 'c', position: [0, 1, 0] }
      ],
      faces: [{ id: 'face', vertices: ['a', 'b', 'c'] }]
    },
    extensions: { test: { time: true } }
  });
  const step = exportVkfWorldStep(source);
  assert.match(step, /ISO-10303-21/);
  assert.match(step, /ADVANCED_FACE/);
  assert.deepEqual(importVkfWorldStep(step), source);
});
