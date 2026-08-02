import assert from 'node:assert/strict';
import test from 'node:test';

import { compileSymbolicRelationShader } from '../../web/vf-ui/geom/vf-symbolic-relation-shader.mjs';
import {
  webGlRelationFragmentSource,
  webGpuRelationShaderSource
} from '../../web/vf-ui/geom/vf-symbolic-plot-renderer.mjs';

const variable = (name) => ({ kind: 'variable', name });
const call = (name, ...args) => ({ kind: 'call', name, args });

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
  assert.match(shader.glslResidual, /sin\(x\).*cos\(y\)/);
  assert.match(shader.wgslResidual, /sin\(x\).*cos\(y\)/);
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
  assert.match(glsl, /dFdx\(residual\).*dFdy\(residual\)/s);
  assert.match(wgsl, /dpdx\(residual\).*dpdy\(residual\)/s);
  assert.match(glsl, /inverse\(u_transform\)/);
  assert.match(wgsl, /determinant/);
  assert.doesNotMatch(`${glsl}\n${wgsl}`, /17\.0/);
});
