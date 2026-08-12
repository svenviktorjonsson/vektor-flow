import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compileSymbolicComplexFieldShader,
  compileSymbolicScalarFieldShader,
  compileSymbolicRelationShader,
  compileSymbolicRelationShaderGroup
} from '../../web/vf-ui/geom/vf-symbolic-relation-shader.mjs';
import {
  webGlRelationFragmentSource,
  webGpuRelationShaderSource
} from '../../web/vf-ui/geom/vf-symbolic-plot-renderer.mjs';

const variable = (name) => ({ kind: 'variable', name });
const call = (name, ...args) => ({ kind: 'call', name, args });

test('compiles scalar fields into per-pixel GPU expressions and colormaps', () => {
  const shader = compileSymbolicScalarFieldShader({
    kind: 'binary', op: '-',
    left: { kind: 'binary', op: '^', left: variable('x'), right: { kind: 'number', value: 4 } },
    right: { kind: 'binary', op: '^', left: variable('y'), right: { kind: 'number', value: 2 } }
  }, {
    valueMin: -2,
    valueMax: 2,
    colorScaleMode: 'clamp',
    colormapPoints: [
      { pos: 0, color: [0, 0, 255], alpha: 1 },
      { pos: 1, color: [255, 0, 0], alpha: 1 }
    ]
  });

  assert.equal(shader.kind, 'scalar-field');
  assert.match(shader.wgslValue, /pow\(x, 4\.0\).*pow\(y, 2\.0\)/);
  assert.match(shader.glslValue, /pow\(x, 4\.0\).*pow\(y, 2\.0\)/);
  assert.match(webGpuRelationShaderSource(shader), /textureColor/);
  assert.match(webGlRelationFragmentSource(shader), /texture_color/);
});

test('compiles complex fields into per-pixel phase color and magnitude alpha', () => {
  const z = {
    kind: 'binary', op: '+', left: variable('x'),
    right: { kind: 'binary', op: '*', left: variable('y'), right: variable('i') }
  };
  const shader = compileSymbolicComplexFieldShader({
    kind: 'binary', op: '^', left: z, right: { kind: 'number', value: 2 }
  }, {
    magnitudeMin: 0,
    magnitudeMax: 4,
    colormapPoints: [
      { pos: 0, color: [255, 0, 0], alpha: 1 },
      { pos: 1, color: [255, 0, 0], alpha: 1 }
    ]
  });

  assert.equal(shader.kind, 'complex-field');
  assert.match(shader.wgslValue, /complexPow/);
  assert.match(shader.glslValue, /complexPow/);
  const wgsl = webGpuRelationShaderSource(shader);
  const glsl = webGlRelationFragmentSource(shader);
  assert.match(wgsl, /phaseUnit.*textureColor/s);
  assert.match(wgsl, /length\(value\).*alpha/s);
  assert.doesNotMatch(wgsl, /\b(?:cosh|sinh)\s*\(/);
  assert.doesNotMatch(wgsl, /fn complex(?:Sin|Cos|Sqrt|Div)/);
  assert.match(glsl, /phase_unit.*texture_color/s);
  assert.doesNotMatch(`${wgsl}\n${glsl}`, /17\.0/);
});

test('compiles a closed relation from the VKF AST without source interpolation', () => {
  const shader = compileSymbolicRelationShader({
    kind: 'binary',
    op: '<=',
    left: call('sin', variable('x')),
    right: call('cos', variable('y')),
    source: 'INVALID_RAW_SOURCE_INJECTION'
  });
  assert.deepEqual({
    operator: shader.operator,
    hasFill: shader.hasFill,
    hasBoundary: shader.hasBoundary,
    insideSign: shader.insideSign
  }, { operator: '<=', hasFill: true, hasBoundary: true, insideSign: -1 });
  assert.match(shader.glslBoundaryResidual, /sin\(x\).*cos\(y\)/);
  assert.match(shader.wgslBoundaryResidual, /sin\(x\).*cos\(y\)/);
  assert.doesNotMatch(JSON.stringify(shader), /INVALID_RAW_SOURCE_INJECTION/);
});

test('distinguishes open fills from equality boundaries and rejects unsupported AST', () => {
  const open = compileSymbolicRelationShader({
    kind: 'binary', op: '>', left: variable('x'), right: { kind: 'number', value: 2 }
  });
  assert.equal(open.hasFill, true);
  assert.equal(open.hasBoundary, false);
  assert.equal(open.insideSign, 1);
  assert.equal(compileSymbolicRelationShader({ kind: 'variable', name: 'x' }), null);
  assert.equal(compileSymbolicRelationShader({
    kind: 'binary', op: '<=', left: variable('secret'), right: variable('x')
  }), null);
});

test('both GPU backends derive antialiased coverage from the analytic residual', () => {
  const shader = compileSymbolicRelationShader({
    kind: 'binary', op: '<=', left: call('sin', variable('x')), right: call('cos', variable('y'))
  });
  const glsl = webGlRelationFragmentSource(shader);
  const wgsl = webGpuRelationShaderSource(shader);
  assert.match(glsl, /dFdx\(boundary_residual\).*dFdy\(boundary_residual\)/s);
  assert.match(wgsl, /dpdx\(boundaryResidual\).*dpdy\(boundaryResidual\)/s);
  assert.match(glsl, /inverse\(u_transform\)/);
  assert.match(wgsl, /determinant/);
  assert.doesNotMatch(`${glsl}\n${wgsl}`, /17\.0/);
  assert.doesNotMatch(`${glsl}\n${wgsl}`, /undefined/);
});

test('renders a simple equality through the current boundary and fill residual contract', () => {
  const shader = compileSymbolicRelationShader({
    kind: 'binary', op: '=', left: variable('x'), right: { kind: 'number', value: 1 }
  });
  const glsl = webGlRelationFragmentSource(shader);
  const wgsl = webGpuRelationShaderSource(shader);

  assert.match(glsl, /boundary_residual = .*x.*1\.0/);
  assert.match(wgsl, /boundaryResidual = .*x.*1\.0/);
  assert.doesNotMatch(`${glsl}\n${wgsl}`, /undefined/);
});

test('compiles time-dependent equality and every inequality entirely into GPU residuals', () => {
  for (const op of ['=', '<', '>', '<=', '>=']) {
    const shader = compileSymbolicRelationShader({
      kind: 'binary', op,
      left: {
        kind: 'binary', op: '+',
        left: { kind: 'binary', op: '^', left: variable('x'), right: { kind: 'number', value: 2 } },
        right: variable('t')
      },
      right: {
        kind: 'binary', op: '-',
        left: { kind: 'binary', op: '^', left: variable('y'), right: { kind: 'number', value: 2 } },
        right: variable('t')
      }
    });
    assert.ok(shader, op);
    assert.match(shader.glslFillResidual, /t/, op);
    assert.match(shader.wgslFillResidual, /t/, op);
    assert.equal(shader.hasFill, op !== '=', op);
    assert.equal(shader.hasBoundary, ['=', '<=', '>='].includes(op), op);
  }
});


test('combines a set-distributed equality into concentric GPU boundaries', () => {
  const squaredRadius = (value) => ({
    kind: 'binary',
    op: '=',
    left: {
      kind: 'binary',
      op: '+',
      left: { kind: 'binary', op: '^', left: variable('x'), right: { kind: 'number', value: 2 } },
      right: { kind: 'binary', op: '^', left: variable('y'), right: { kind: 'number', value: 2 } }
    },
    right: { kind: 'number', value }
  });
  const variants = [1, 2, 3, 4, 5].map(squaredRadius);
  const shader = compileSymbolicRelationShader(variants[0], variants);

  assert.equal(shader.hasBoundary, true);
  assert.equal(shader.hasFill, false);
  for (const radius of [1, 2, 3, 4, 5]) {
    assert.match(shader.glslBoundaryResidual, new RegExp(radius + '\\.0'));
    assert.match(shader.wgslBoundaryResidual, new RegExp(radius + '\\.0'));
  }
  assert.equal((shader.glslBoundaryResidual.match(/min\(/g) || []).length, 4);
});

test('combines independent relation programs into one GPU plot group', () => {
  const equality = {
    ast: { kind: 'binary', op: '=', left: variable('x'), right: { kind: 'number', value: 1 } },
    variants: []
  };
  const region = {
    ast: { kind: 'binary', op: '>', left: variable('y'), right: { kind: 'number', value: 2 } },
    variants: []
  };
  const shader = compileSymbolicRelationShaderGroup([equality, region]);

  assert.equal(shader.operator, 'group');
  assert.equal(shader.hasBoundary, true);
  assert.equal(shader.hasFill, true);
  assert.equal(shader.insideSign, 1);
  assert.match(shader.glslBoundaryResidual, /x.*1\.0/);
  assert.match(shader.glslFillResidual, /y.*2\.0/);
  assert.doesNotMatch(JSON.stringify(shader), /undefined/);
});
