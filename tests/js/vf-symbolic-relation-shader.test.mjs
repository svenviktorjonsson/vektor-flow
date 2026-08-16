import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compileSymbolicExplicitCurveShaderGroup,
  compileSymbolicComplexFieldShader,
  compileSymbolicScalarFieldShader,
  compileSymbolicRelationShader,
  compileSymbolicRelationShaderGroup
} from '../../web/vf-ui/geom/vf-symbolic-relation-shader.mjs';
import {
  closestExplicitCurveScreenDistance,
  webGlRelationFragmentSource,
  webGlRelationPickFragmentSource,
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
  assert.equal(shader.colormapPoints.length, 2);
  assert.deepEqual(shader.colormapPoints[0].color, [1, 0, 0]);
  assert.deepEqual(shader.colormapPoints.at(-1).color, [1, 0, 0]);
  const defaultPhaseShader = compileSymbolicComplexFieldShader(z);
  assert.equal(defaultPhaseShader.colormapPoints.length, 7);
  assert.deepEqual(defaultPhaseShader.colormapPoints[0].color, [1, 0, 0]);
  assert.deepEqual(defaultPhaseShader.colormapPoints.at(-1).color, [1, 0, 0]);
  assert.match(shader.wgslValue, /complexMul/);
  assert.match(shader.glslValue, /complexMul/);
  assert.doesNotMatch(`${shader.wgslValue}\n${shader.glslValue}`, /complexPow/);
  const wgsl = webGpuRelationShaderSource(shader);
  const glsl = webGlRelationFragmentSource(shader);
  assert.match(wgsl, /phaseUnit.*textureColor/s);
  assert.match(wgsl, /length\(value\).*alpha/s);
  assert.doesNotMatch(wgsl, /\b(?:cosh|sinh)\s*\(/);
  assert.doesNotMatch(wgsl, /fn complex(?:Sin|Cos|Sqrt|Div)/);
  assert.match(glsl, /phase_unit.*texture_color/s);
  assert.doesNotMatch(`${wgsl}\n${glsl}`, /17\.0/);
  const pickGlsl = webGlRelationPickFragmentSource(shader);
  assert.match(pickGlsl, /out_color = vec4\(1\.0 \/ 255\.0/);
  assert.doesNotMatch(pickGlsl, /undefined/);
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

test('both GPU backends project to the analytic boundary before drawing fixed-distance rings', () => {
  const shader = compileSymbolicRelationShader({
    kind: 'binary', op: '=', left: variable('y'), right: call('sin', variable('x'))
  });
  const glsl = webGlRelationFragmentSource(shader);
  const wgsl = webGpuRelationShaderSource(shader);

  assert.match(glsl, /projected_boundary_distance_px\(v_screen, t\)/);
  assert.match(glsl, /for \(int iteration = 0; iteration < 6; iteration \+= 1\)/);
  assert.match(glsl, /length\(screen - projected\) \* u_geometry\.w/);
  assert.match(wgsl, /projectedBoundaryDistancePx\(input\.screen, t\)/);
  assert.match(wgsl, /for \(var iteration = 0; iteration < 6; iteration \+= 1\)/);
  assert.match(wgsl, /length\(screen - projected\) \* uniforms\.geometry\.w/);
  assert.match(glsl, /return \(\(y\) - \(sin\(x\)\)\)/);
  assert.match(wgsl, /return \(\(y\) - \(sin\(x\)\)\)/);
  assert.match(glsl, /fwidth\(exact_boundary_distance_px\)/);
  assert.match(wgsl, /fwidth\(boundaryDistancePx\)/);
  assert.match(glsl, /exact_boundary_distance_px = abs\(approximate_boundary_distance_px\)/);
  assert.match(wgsl, /boundaryDistancePx = abs\(approximateBoundaryDistancePx\)/);
  assert.match(glsl, /return -1\.0/);
  assert.match(wgsl, /return -1\.0/);
  assert.match(glsl, /projected_distance_px >= 0\.0/);
  assert.match(wgsl, /projectedDistancePx >= 0\.0/);
  assert.match(glsl, /projected_distance_px : 1e20/);
  assert.match(wgsl, /select\(1e20, projectedDistancePx/);
  assert.match(glsl, /fill_coverage \* u_interaction\.y \* 0\.0/);
  assert.match(wgsl, /fillCoverage \* uniforms\.interaction\.y \* 0\.0/);
  assert.doesNotMatch(wgsl, /select\([^;]*projectedBoundaryDistancePx\(/);
  assert.doesNotMatch(`${glsl}\n${wgsl}`, /offset.*polyline/i);
});

test('explicit curves use a fast one-dimensional analytic closest-point solver', () => {
  const expression = call('sin', variable('x'));
  const shader = compileSymbolicExplicitCurveShaderGroup([{
    explicitCurve: { dependent: 'y', parameter: 'x', expression }
  }]);
  const glsl = webGlRelationFragmentSource(shader);
  const wgsl = webGpuRelationShaderSource(shader);

  assert.equal(shader.boundaryDistanceMode, 'explicit');
  assert.match(glsl, /for \(int iteration = 0; iteration < 3; iteration \+= 1\)/);
  assert.match(wgsl, /for \(var iteration = 0; iteration < 3; iteration \+= 1\)/);
  assert.match(`${glsl}\n${wgsl}`, /cos\(x\)/);
  assert.match(glsl, /step_limit_px[\s\S]*u_geometry/);
  assert.match(glsl, /parameter_screen_gradient/);
  assert.match(glsl, /step_limit_px\s*\*\s*length\(parameter_screen_gradient\)\s*\/\s*u_geometry\.w/);
  assert.match(glsl, /clamp\(gauss_newton_step,\s*-parameter_step_limit,\s*parameter_step_limit\)/);
  assert.match(wgsl, /stepLimitPx[\s\S]*uniforms\.geometry/);
  assert.match(wgsl, /parameterScreenGradient/);
  assert.match(wgsl, /stepLimitPx\s*\*\s*length\(parameterScreenGradient\)\s*\/\s*uniforms\.geometry\.w/);
  assert.match(wgsl, /clamp\(gaussNewtonStep,\s*-parameterStepLimit,\s*parameterStepLimit\)/);
  assert.doesNotMatch(glsl, /step_limit_px \/ \(tangentLength \* u_geometry\.w\)/);
  assert.doesNotMatch(wgsl, /stepLimitPx \/ \(tangentLength \* uniforms\.geometry\.w\)/);
  assert.match(`${glsl}\n${wgsl}`, /dot\(delta, screenAcceleration\)/);
  assert.match(glsl, /clamp\(fwidth\(exact_boundary_distance_px\), 0\.5, 1\.0\)/);
  assert.match(wgsl, /clamp\(fwidth\(boundaryDistancePx\), 0\.5, 1\.0\)/);
  assert.match(glsl, /exact_boundary_distance_px = 1e20/);
  assert.match(wgsl, /boundaryDistancePx = 1e20/);
  assert.match(glsl, /selection_outer \+ 4\.0 \* u_geometry\.w/);
  assert.match(wgsl, /selectionOuter \+ 4\.0 \* uniforms\.geometry\.w/);
  assert.doesNotMatch(glsl, /exact_boundary_distance_px = abs\(approximate_boundary_distance_px\)/);
  assert.doesNotMatch(wgsl, /boundaryDistancePx = abs\(approximateBoundaryDistancePx\)/);
  assert.doesNotMatch(`${glsl}\n${wgsl}`, /projected.*residual|epsilon|iteration < 6/i);
});

test('explicit curve families keep a distinct GPU color for each series', () => {
  const curves = [0, 1].map((offset) => ({
    explicitCurve: {
      dependent: 'y', parameter: 'x',
      expression: {
        kind: 'binary', op: '+', left: variable('x'), right: { kind: 'number', value: offset }
      }
    },
    edgeColor: offset === 0 ? [1, 0, 0, 1] : [0, 0, 1, 1]
  }));
  const shader = compileSymbolicExplicitCurveShaderGroup(curves);
  const glsl = webGlRelationFragmentSource(shader);
  const wgsl = webGpuRelationShaderSource(shader);

  assert.deepEqual(shader.explicitCurveColors, [[1, 0, 0, 1], [0, 0, 1, 1]]);
  assert.match(glsl, /boundaryColor = vec4\(1\.0, 0\.0, 0\.0, 1\.0\)/);
  assert.match(glsl, /boundaryColor = vec4\(0\.0, 0\.0, 1\.0, 1\.0\)/);
  assert.match(wgsl, /boundaryColor = vec4f\(1\.0, 0\.0, 0\.0, 1\.0\)/);
  assert.match(wgsl, /boundaryColor = vec4f\(0\.0, 0\.0, 1\.0, 1\.0\)/);
});

test('explicit curve selection subtracts the inner tube union from the outer tube union', () => {
  const shader = compileSymbolicExplicitCurveShaderGroup([
    { explicitCurve: { dependent: 'y', parameter: 'x', expression: variable('x') } },
    {
      explicitCurve: {
        dependent: 'y', parameter: 'x',
        expression: { kind: 'unary', op: '-', operand: variable('x') }
      }
    }
  ]);
  const glsl = webGlRelationFragmentSource(shader);
  const wgsl = webGpuRelationShaderSource(shader);

  assert.match(glsl, /vec3 explicit_boundary_sample_px/);
  assert.match(wgsl, /fn explicitBoundarySamplePx\(/);
  assert.match(glsl, /outer_selection_coverage/);
  assert.match(glsl, /inner_selection_coverage/);
  assert.match(wgsl, /outerSelectionCoverage/);
  assert.match(wgsl, /innerSelectionCoverage/);
  assert.match(glsl, /outer_selection_coverage \* \(1\.0 - inner_selection_coverage\)/);
  assert.match(wgsl, /outerSelectionCoverage \* \(1\.0 - innerSelectionCoverage\)/);
  assert.match(glsl, /edge_selection = projected_sample\.z \* u_interaction\.x/);
  assert.match(wgsl, /edgeSelection = projectedSample\.z \* uniforms\.interaction\.x/);
  assert.doesNotMatch(glsl, /selection_delta = min/);
  assert.doesNotMatch(wgsl, /selectionDelta = min/);
  assert.equal((glsl.match(/explicit_curve_distance_0\(screen_point, time_value\)/g) || []).length, 1);
  assert.equal((wgsl.match(/explicitCurveDistance0\(screen, timeValue\)/g) || []).length, 1);
  assert.doesNotMatch(glsl, /abs\(selection_boundary_distance_px - selection_center\)/);
  assert.doesNotMatch(wgsl, /abs\(selectionBoundaryDistancePx - selectionCenter\)/);
});

test('explicit curve gate compares per-curve screen distances instead of raw residuals', () => {
  const shader = compileSymbolicExplicitCurveShaderGroup([
    {
      explicitCurve: {
        dependent: 'y', parameter: 'x',
        expression: {
          kind: 'binary', op: '*',
          left: { kind: 'number', value: -0.55 }, right: variable('x')
        }
      }
    },
    {
      explicitCurve: {
        dependent: 'y', parameter: 'x',
        expression: {
          kind: 'binary', op: '*',
          left: { kind: 'number', value: 15 }, right: variable('x')
        }
      }
    }
  ]);
  const glsl = webGlRelationFragmentSource(shader);
  const wgsl = webGpuRelationShaderSource(shader);

  assert.match(glsl, /explicit_residual_0/);
  assert.match(glsl, /explicit_approximate_distance_0_px/);
  assert.match(glsl, /explicit_approximate_distance_1_px/);
  assert.match(glsl, /min\(explicit_approximate_distance_0_px, explicit_approximate_distance_1_px\)/);
  assert.match(wgsl, /explicitResidual0/);
  assert.match(wgsl, /explicitApproximateDistance0Px/);
  assert.match(wgsl, /explicitApproximateDistance1Px/);
  assert.match(wgsl, /min\(explicitApproximateDistance0Px, explicitApproximateDistance1Px\)/);
  assert.doesNotMatch(glsl, /float approximate_boundary_distance_px = boundary_residual \/ boundary_gradient/);
  assert.doesNotMatch(wgsl, /let approximateBoundaryDistancePx = boundaryResidual \/ boundaryGradient/);
});

test('explicit screen distance is invariant under positive and negative slope', () => {
  for (const slope of [-12, -3, 0, 3, 12]) {
    const normalLength = Math.hypot(slope, 1);
    const distance = closestExplicitCurveScreenDistance({
      point: [200 + slope * 7 / normalLength, 200 + 7 / normalLength],
      value: (x) => slope * x,
      first: () => slope,
      transform: [20, 0, 0, -20, 200, 200]
    });
    assert.ok(Math.abs(distance - 7) < 1e-8, `slope ${slope} gave ${distance}`);
  }
});

test('explicit screen distance keeps the closest oscillation branch at far zoom', () => {
  const distance = closestExplicitCurveScreenDistance({
    point: [-30, 45],
    value: (x) => 5 * Math.sin(4 * x),
    first: (x) => 20 * Math.cos(4 * x),
    second: (x) => -80 * Math.sin(4 * x),
    transform: [15, 0, 0, -15, 0, 0],
    searchRadiusPx: 7,
    seeds: 5
  });

  assert.ok(Math.abs(distance - 2.92407) < 0.001, `far-zoom distance was ${distance}`);
});

test('explicit GPU distance widens its search only for unresolved curvature', () => {
  const expression = call('sin', {
    kind: 'binary', op: '*', left: { kind: 'number', value: 4 }, right: variable('x')
  });
  const shader = compileSymbolicExplicitCurveShaderGroup([{
    explicitCurve: { dependent: 'y', parameter: 'x', expression }
  }]);
  const glsl = webGlRelationFragmentSource(shader);
  const wgsl = webGpuRelationShaderSource(shader);

  assert.match(glsl, /screen_curvature_span/);
  assert.match(wgsl, /screenCurvatureSpan/);
  assert.match(glsl, /for \(int seed = 0; seed < 5; seed \+= 1\)/);
  assert.match(wgsl, /for \(var seed = 0; seed < 5; seed \+= 1\)/);
  assert.match(`${glsl}\n${wgsl}`, /screenAcceleration/);
});

test('GPU picking keeps its radius separate from render pixel ratio', () => {
  const shader = compileSymbolicRelationShader({
    kind: 'binary', op: '=', left: variable('y'), right: variable('x')
  });
  const wgsl = webGpuRelationShaderSource(shader);

  assert.match(wgsl, /boundaryDistancePx <= uniforms\.geometry\.x \* 0\.5 \+ uniforms\.interaction\.w/);
  assert.doesNotMatch(
    wgsl,
    /boundaryDistancePx <= uniforms\.geometry\.x \* 0\.5 \+ uniforms\.geometry\.w/
  );
});

test('renders a simple equality through the current boundary and fill residual contract', () => {
  const shader = compileSymbolicRelationShader({
    kind: 'binary', op: '=', left: variable('x'), right: { kind: 'number', value: 1 }
  });
  const glsl = webGlRelationFragmentSource(shader);
  const wgsl = webGpuRelationShaderSource(shader);

  assert.match(glsl, /return .*x.*1\.0/);
  assert.match(wgsl, /return .*x.*1\.0/);
  assert.doesNotMatch(`${glsl}\n${wgsl}`, /undefined/);
});

test('colors inequality faces by their positive inside residual', () => {
  const colormapStyle = {
    faceColormap: true,
    valueMin: 0,
    valueMax: 4,
    colorScaleMode: 'clamp',
    colormapPoints: [
      { pos: 0, color: [255, 0, 0], alpha: 1 },
      { pos: 1, color: [0, 0, 255], alpha: 1 }
    ]
  };
  const greater = compileSymbolicRelationShader({
    kind: 'binary', op: '>', left: variable('r'), right: { kind: 'number', value: 1 }
  }, null, colormapStyle);
  const less = compileSymbolicRelationShader({
    kind: 'binary', op: '<', left: variable('r'), right: { kind: 'number', value: 1 }
  }, null, colormapStyle);

  assert.equal(greater.faceColormap, true);
  assert.match(greater.glslInsideResidual, /r.*1\.0/);
  assert.doesNotMatch(greater.glslInsideResidual, /^-/);
  assert.match(less.glslInsideResidual, /\* -1\.0/);
  assert.match(webGlRelationFragmentSource(greater), /texture_color\(fill_unit\)/);
  assert.match(webGlRelationFragmentSource(greater), /value_min = 0\.0/);
  assert.match(webGlRelationFragmentSource(greater), /value_max = 4\.0/);
  assert.match(webGpuRelationShaderSource(less), /textureColor\(fillUnit\)/);
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
