import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parsePropertyProgram,
  highlightPropertyProgram,
  expandEvaluatedReferences,
  reachablePropertyDescriptors,
  serializePropertyProgram,
  spillEditableBindings,
  validatePropertyProgram
} from '../../web/vf-ui/vf-property-program.mjs';

test('lists geometry properties reachable in spatial and temporal contexts', () => {
  assert.deepEqual(
    reachablePropertyDescriptors({ geometryKinds: ['vertex'], dimension: 2 }).map(({ name }) => name),
    ['p', 'x', 'y', 'vertex_px_radius', 'vertex_radius', 'm', 'q', 'T', 'epsilon', 'mu', 'sigma_e', 'kappa', 'alpha', 'c_p', 'eta', 'nu', 'P', 'E', 'B', 'phi', 'c']
  );
  assert.deepEqual(
    reachablePropertyDescriptors({ geometryKinds: ['vertex'], dimension: 3, temporal: true }).map(({ name }) => name),
    ['p', 'x', 'y', 'z', 'v', 'vx', 'vy', 'vz', 'a', 'vertex_px_radius', 'vertex_radius', 'm', 'q', 'T', 'epsilon', 'mu', 'sigma_e', 'kappa', 'alpha', 'c_p', 'eta', 'nu', 'P', 'E', 'B', 'phi', 'c']
  );
  assert.deepEqual(
    reachablePropertyDescriptors({ geometryKinds: ['edge', 'face'] }).map(({ name }) => name),
    ['L', 'edge_px_width', 'edge_width', 'k', 'k_theta', 'lambda_m', 'lambda_q', 'sigma_m', 'sigma_q', 'T', 'epsilon', 'mu', 'sigma_e', 'kappa', 'alpha', 'c_p', 'h', 'epsilon_rad', 'eta', 'nu', 'P', 'E', 'B', 'phi', 'c']
  );
  assert.equal(
    reachablePropertyDescriptors({ geometryKinds: ['face'] }).find(({ name }) => name === 'kappa').field,
    true
  );
  const edgeProperties = reachablePropertyDescriptors({ geometryKinds: ['edge'] });
  assert.deepEqual(edgeProperties.find(({ name }) => name === 'k').dimension, [0, 1, -2, 0, 0, 0, 0]);
  assert.deepEqual(edgeProperties.find(({ name }) => name === 'k_theta').dimension, [2, 1, -2, 0, 0, 0, 0]);
  assert.equal(edgeProperties.find(({ name }) => name === 'edge_px_width').quantity, 'screen-length');
  assert.equal(edgeProperties.find(({ name }) => name === 'edge_width').quantity, 'length');
});

test('parses dot properties plus ordinary VKF bindings and functions', () => {
  assert.deepEqual(parsePropertyProgram(`
.x:(1,2,3)
.y:(3,4,5)
F(x):x^2
.L:2 mm
`), {
    properties: [
      { name: 'x', expression: '(1,2,3)' },
      { name: 'y', expression: '(3,4,5)' },
      { name: 'L', expression: '2 mm' }
    ],
    bindings: [{ source: 'F(x):x^2', name: 'F' }]
  });
});

test('canonicalizes adjacent numeric unit suffixes without treating symbols as units', () => {
  assert.deepEqual(parsePropertyProgram(`
.m:10kg
.L:(1,2)mm
.k_theta:8N*m
.k:2dyn/cm
speed:3m/s
gain:2alpha
`), {
    properties: [
      { name: 'm', expression: '10 kg' },
      { name: 'L', expression: '(1,2) mm' },
      { name: 'k_theta', expression: '8 N*m' },
      { name: 'k', expression: '2 dyn/cm' }
    ],
    bindings: [
      { source: 'speed:3 m/s', name: 'speed' },
      { source: 'gain:2alpha', name: 'gain' }
    ]
  });
});

test('serializes current property tuples for deterministic dot reopening', () => {
  assert.equal(serializePropertyProgram({ x: [1, 2], y: [3, 4] }), '.x:(1,2)\n.y:(3,4)');
});

test('enforces dot update versus undotted declaration semantics', () => {
  const program = parsePropertyProgram('.x:2\n.speed:3\nnewValue:4');
  assert.deepEqual(validatePropertyProgram(program, {
    propertyNames: ['x'],
    variableNames: ['speed']
  }).diagnostics, []);
  assert.deepEqual(program.bindings, [{ source: 'newValue:4', name: 'newValue' }]);

  const invalid = validatePropertyProgram(parsePropertyProgram('.missing:1'), {
    propertyNames: ['x'], variableNames: ['speed']
  });
  assert.match(invalid.diagnostics[0].message, /Cannot update unknown name \.missing/);
});

test('spills nearest editable bindings into one generic dot scope', () => {
  assert.deepEqual(spillEditableBindings([
    { id: 'selection', bindings: [{ name: 'x', kind: 'property', value: [1, 2] }] },
    { id: 'global', bindings: [
      { name: 'x', kind: 'variable', value: 9 },
      { name: 'view', kind: 'property', value: 1 },
      { name: 'F', kind: 'function', value: 'F(x):x^2' }
    ] }
  ]), [
    { name: 'x', kind: 'property', value: [1, 2], scopeId: 'selection', writable: true },
    { name: 'view', kind: 'property', value: 1, scopeId: 'global', writable: true },
    { name: 'F', kind: 'function', value: 'F(x):x^2', scopeId: 'global', writable: true }
  ]);
});

test('provides VKF syntax tokens for mixed property and code blocks', () => {
  const source = '.L:2 mm\n.k_theta:8 N*m\n.k:2 dyn/cm\n.kappa:$gain W/(m*K)\nF(x):x^2';
  const tokens = highlightPropertyProgram(source);
  assert.equal(tokens.map(({ text }) => text).join(''), source);
  assert.ok(tokens.some(({ text, role }) => text === '.L' && role === 'update'));
  assert.ok(tokens.some(({ text, role }) => text === 'mm' && role === 'unit'));
  assert.ok(tokens.some(({ text, role }) => text === 'N*m' && role === 'unit'));
  assert.ok(tokens.some(({ text, role }) => text === 'dyn/cm' && role === 'unit'));
  assert.ok(tokens.some(({ text, role }) => text === 'W/(m*K)' && role === 'unit'));
  assert.ok(tokens.some(({ text, role }) => text === '$gain' && role === 'reference'));
  assert.ok(tokens.some(({ text, role }) => text === 'F' && role === 'definition'));
});

test('expands dollar references to evaluated constants or symbolic expressions', () => {
  assert.equal(expandEvaluatedReferences('.kappa:$gain*x', { gain: 2 }), '.kappa:2*x');
  assert.equal(
    expandEvaluatedReferences('.kappa:$gain*x', { gain: { expression: '1+t' } }),
    '.kappa:(1+t)*x'
  );
});
