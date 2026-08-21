import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describeSymbolicConstraint,
  editSymbolicConstraint,
  symbolicConstraintScope
} from 'vektor-flow/symbolic-constraints';

test('scopes standalone relations globally while keeping them plottable', () => {
  const scope = symbolicConstraintScope([{
    id: 'bounds',
    spans: [{ id: 'math:0', kind: 'math', source: '0<=u<=t', start: 0, end: 7, classification: 'closed-region' }],
    plotSegments: [{ id: 'math:0', source: '0<=u<=t', start: 0, end: 7 }]
  }]);

  assert.deepEqual(scope.global, [{
    id: 'bounds:constraint:math:0', expressionId: 'bounds', segmentId: 'math:0',
    source: '0<=u<=t', classification: 'closed-region'
  }]);
  assert.deepEqual(scope.local, {});
});

test('binds a relation only to following plots in the same mixed label', () => {
  const scope = symbolicConstraintScope([{
    id: 'mixed',
    spans: [
      { id: 'math:0', kind: 'math', source: '0<u<t', start: 0, end: 5, classification: 'open-region' },
      { kind: 'text', source: ' then ', start: 5, end: 11 },
      { id: 'math:1', kind: 'math', source: '[cos(u),sin(u)]', start: 11, end: 28, classification: 'parametric' },
      { kind: 'text', source: ' and ', start: 28, end: 33 },
      { id: 'math:2', kind: 'math', source: 'u<1', start: 33, end: 36, classification: 'open-region' }
    ],
    plotSegments: [
      { id: 'math:0', source: '0<u<t', start: 0, end: 5 },
      { id: 'math:1', source: '[cos(u),sin(u)]', start: 11, end: 28 },
      { id: 'math:2', source: 'u<1', start: 33, end: 36 }
    ]
  }]);

  assert.deepEqual(scope.global, []);
  assert.deepEqual(scope.local['mixed::math:0'], []);
  assert.deepEqual(scope.local['mixed::math:1'].map(({ source }) => source), ['0<u<t']);
  assert.deepEqual(scope.local['mixed::math:2'].map(({ source }) => source), ['0<u<t']);
});

test('describes and edits inclusive boundaries in VKF', () => {
  const constraint = describeSymbolicConstraint({
    id: 'range', expressionId: 'bounds', source: '0<=u<=t', classification: 'closed-region'
  }, { parameterName: 'u' });

  assert.deepEqual(constraint.plotParts, ['face', 'edge']);
  assert.deepEqual(constraint.boundaries.map(({ target }) => target), ['vertex:0', 'vertex:1']);
  assert.deepEqual(editSymbolicConstraint('0<=u<=t', ['vertex:0']), {
    action: 'rewrite', source: '0<u<=t'
  });
  assert.deepEqual(editSymbolicConstraint('0<=u<=t', ['curve']), {
    action: 'rewrite', source: String.raw`0=u \/ u=t`
  });
});
