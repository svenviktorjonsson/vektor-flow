const RELATION_OPERATORS = new Set(['=', '<', '>', '<=', '>=']);

const CALLS = Object.freeze({
  abs: ['abs', 'abs'],
  atan2: ['atan2', 'atan'],
  cos: ['cos', 'cos'],
  sin: ['sin', 'sin'],
  sqrt: ['sqrt', 'sqrt'],
  tan: ['tan', 'tan']
});

export function compileSymbolicScalarFieldShader(ast, style = {}) {
  const wgslValue = emit(ast, 'wgsl');
  const glslValue = emit(ast, 'glsl');
  if (!wgslValue || !glslValue) return null;
  const points = normalizedShaderColormap(style);
  return Object.freeze({
    kind: 'scalar-field',
    operator: 'scalar-field',
    wgslValue,
    glslValue,
    valueMin: finiteOr(style.valueMin, 0),
    valueMax: finiteOr(style.valueMax, 1),
    colorScaleMode: style.colorScaleMode === 'cyclic' ? 'cyclic' : 'clamp',
    colormapPoints: points
  });
}

export function compileSymbolicComplexFieldShader(ast, style = {}) {
  const wgslValue = emitComplex(ast, 'wgsl');
  const glslValue = emitComplex(ast, 'glsl');
  if (!wgslValue || !glslValue) return null;
  return Object.freeze({
    kind: 'complex-field',
    operator: 'complex-field',
    wgslValue,
    glslValue,
    magnitudeMin: finiteOr(style.magnitudeMin, 0),
    magnitudeMax: finiteOr(style.magnitudeMax, 1),
    colormapPoints: normalizedShaderColormap(style, 'phase')
  });
}

export function compileSymbolicRelationShader(ast, variants = null, style = {}) {
  if (ast?.kind === 'binary' && ast.op === 'and' && !(Array.isArray(variants) && variants.length)) {
    return compileSymbolicRelationShaderGroup(
      chainedRelationMembers(ast).map((relation) => ({ ast: relation })),
      style
    );
  }
  const relations = Array.isArray(variants) && variants.length ? variants : [ast];
  if (!relations.every((relation) => relation?.kind === 'binary' && RELATION_OPERATORS.has(relation.op))) return null;
  if (!relations.every((relation) => relation.op === ast.op)) return null;
  const wgslResiduals = relations.map((relation) => emitResidual(relation, 'wgsl'));
  const glslResiduals = relations.map((relation) => emitResidual(relation, 'glsl'));
  if (![...wgslResiduals, ...glslResiduals].every(Boolean)) return null;
  const boundaryResidual = (residuals) => combine(residuals.map((residual) => `abs(${residual})`), 'min');
  const projectionResidual = (residuals, language) => closestSignedResidual(residuals, language);
  const fillOperator = ['<', '<='].includes(ast.op) ? 'min' : 'max';
  const insideSign = ['<', '<='].includes(ast.op) ? -1 : 1;
  const wgslFillResidual = combine(wgslResiduals, fillOperator);
  const glslFillResidual = combine(glslResiduals, fillOperator);
  return Object.freeze({
    kind: 'relation',
    operator: ast.op,
    hasFill: ast.op !== '=',
    hasBoundary: ['=', '<=', '>='].includes(ast.op),
    insideSign,
    wgslBoundaryResidual: boundaryResidual(wgslResiduals),
    glslBoundaryResidual: boundaryResidual(glslResiduals),
    wgslBoundaryProjectionResidual: projectionResidual(wgslResiduals, 'wgsl'),
    glslBoundaryProjectionResidual: projectionResidual(glslResiduals, 'glsl'),
    wgslFillResidual,
    glslFillResidual,
    wgslInsideResidual: `((${wgslFillResidual}) * ${insideSign.toFixed(1)})`,
    glslInsideResidual: `((${glslFillResidual}) * ${insideSign.toFixed(1)})`,
    faceColormap: style.faceColormap === true && ast.op !== '=',
    valueMin: finiteOr(style.valueMin, 0),
    valueMax: finiteOr(style.valueMax, 1),
    colorScaleMode: style.colorScaleMode === 'cyclic' ? 'cyclic' : 'clamp',
    colormapPoints: normalizedShaderColormap(style)
  });
}

function chainedRelationMembers(ast) {
  if (ast?.kind !== 'binary' || ast.op !== 'and') return [ast];
  return [...chainedRelationMembers(ast.left), ...chainedRelationMembers(ast.right)];
}

export function compileSymbolicRelationShaderGroup(programs, style = {}) {
  if (!Array.isArray(programs) || programs.length === 0) return null;
  const shaders = programs.map(({ ast, variants }) => compileSymbolicRelationShader(ast, variants, style));
  if (shaders.some((shader) => shader == null)) return null;
  const boundaries = shaders.filter(({ hasBoundary }) => hasBoundary);
  const fills = shaders.filter(({ hasFill }) => hasFill);
  const boundary = (language) => boundaries.length
    ? combine(boundaries.map((shader) => shader[`${language}BoundaryResidual`]), 'min')
    : '1e20';
  const projectionBoundary = (language) => boundaries.length
    ? closestSignedResidual(
        boundaries.map((shader) => shader[`${language}BoundaryProjectionResidual`]),
        language
      )
    : '1e20';
  const fill = (language) => fills.length
    ? combine(fills.map((shader) =>
        `((${shader[`${language}FillResidual`]}) * ${shader.insideSign.toFixed(1)})`), 'max')
    : '-1e20';
  return Object.freeze({
    kind: 'relation',
    operator: 'group',
    hasFill: fills.length > 0,
    hasBoundary: boundaries.length > 0,
    insideSign: 1,
    wgslBoundaryResidual: boundary('wgsl'),
    glslBoundaryResidual: boundary('glsl'),
    wgslBoundaryProjectionResidual: projectionBoundary('wgsl'),
    glslBoundaryProjectionResidual: projectionBoundary('glsl'),
    wgslFillResidual: fill('wgsl'),
    glslFillResidual: fill('glsl'),
    wgslInsideResidual: fill('wgsl'),
    glslInsideResidual: fill('glsl'),
    faceColormap: style.faceColormap === true && fills.length > 0,
    valueMin: finiteOr(style.valueMin, 0),
    valueMax: finiteOr(style.valueMax, 1),
    colorScaleMode: style.colorScaleMode === 'cyclic' ? 'cyclic' : 'clamp',
    colormapPoints: normalizedShaderColormap(style)
  });
}

export function compileSymbolicExplicitCurveShaderGroup(programs, style = {}) {
  if (!Array.isArray(programs) || programs.length === 0) return null;
  const curves = programs.map(({ explicitCurve }) => explicitCurve).filter(Boolean);
  if (curves.length !== programs.length) return null;
  const compiledCurves = curves.map((curve) => {
    if (!['x', 'y'].includes(curve.parameter) || !['x', 'y'].includes(curve.dependent)
      || curve.parameter === curve.dependent) return null;
    const wgsl = emitJet(curve.expression, 'wgsl', curve.parameter);
    const glsl = emitJet(curve.expression, 'glsl', curve.parameter);
    if (!wgsl || !glsl) return null;
    return Object.freeze({
      dependent: curve.dependent,
      parameter: curve.parameter,
      wgsl: Object.freeze(wgsl),
      glsl: Object.freeze(glsl)
    });
  });
  if (compiledCurves.some((curve) => curve == null)) return null;
  const relationPrograms = programs.map((program) => program.ast ? program : ({
    ...program,
    ast: {
      kind: 'binary', op: '=',
      left: { kind: 'variable', name: program.explicitCurve.dependent },
      right: program.explicitCurve.expression
    }
  }));
  const relation = relationPrograms.length === 1
    ? compileSymbolicRelationShader(relationPrograms[0].ast, null, style)
    : compileSymbolicRelationShaderGroup(relationPrograms, style);
  return relation ? Object.freeze({
    ...relation,
    boundaryDistanceMode: 'explicit',
    explicitCurves: Object.freeze(compiledCurves),
    explicitCurveColors: programs.every(({ edgeColor }) => validShaderColor(edgeColor))
      ? Object.freeze(programs.map(({ edgeColor }) => Object.freeze(edgeColor.map(Number))))
      : null
  }) : null;
}

function validShaderColor(value) {
  return (Array.isArray(value) || ArrayBuffer.isView(value))
    && value.length === 4
    && Array.from(value).every(Number.isFinite);
}

function closestSignedResidual(residuals, language) {
  if (residuals.length === 0) return '1e20';
  return residuals.slice(1).reduce((closest, candidate) => language === 'wgsl'
    ? `select((${closest}), (${candidate}), abs(${candidate}) < abs(${closest}))`
    : `((abs(${candidate}) < abs(${closest})) ? (${candidate}) : (${closest}))`, residuals[0]);
}

function normalizedShaderColormap(style, fallback = 'gray') {
  const source = Array.isArray(style.colormapPoints) && style.colormapPoints.length
    ? style.colormapPoints
    : fallback === 'phase' ? [
        { pos: 0, color: [255, 0, 0], alpha: 1 },
        { pos: 1 / 6, color: [255, 255, 0], alpha: 1 },
        { pos: 2 / 6, color: [0, 255, 0], alpha: 1 },
        { pos: 3 / 6, color: [0, 255, 255], alpha: 1 },
        { pos: 4 / 6, color: [0, 0, 255], alpha: 1 },
        { pos: 5 / 6, color: [255, 0, 255], alpha: 1 },
        { pos: 1, color: [255, 0, 0], alpha: 1 }
      ] : [
        { pos: 0, color: [0, 0, 0], alpha: 1 },
        { pos: 1, color: [255, 255, 255], alpha: 1 }
      ];
  return Object.freeze(source
    .map((point) => Object.freeze({
      pos: Math.max(0, Math.min(1, finiteOr(point?.pos, 0))),
      color: Object.freeze([0, 1, 2].map((index) =>
        Math.max(0, Math.min(255, finiteOr(point?.color?.[index], 0))) / 255)),
      alpha: Math.max(0, Math.min(1, finiteOr(point?.alpha, 1)))
    }))
    .sort((left, right) => left.pos - right.pos));
}

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}


function emitResidual(ast, language) {
  const left = emit(ast.left, language);
  const right = emit(ast.right, language);
  return left && right ? `((${left}) - (${right}))` : null;
}

function combine(values, operator) {
  return values.slice(1).reduce((combined, value) => `${operator}(${combined}, ${value})`, values[0]);
}

function emit(node, language) {
  if (!node || typeof node !== 'object') return null;
  if (node.kind === 'group') return emit(node.expression, language);
  if (node.kind === 'number') {
    const value = Number(node.value);
    return Number.isFinite(value) ? shaderNumber(value) : null;
  }
  if (node.kind === 'variable') {
    if (node.name === 'x' || node.name === 'y' || node.name === 't') return node.name;
    if (node.name === 'pi') return shaderNumber(Math.PI);
    if (node.name === 'r') return 'sqrt(x * x + y * y)';
    if (node.name === 'phi') return language === 'wgsl' ? 'atan2(y, x)' : 'atan(y, x)';
    return null;
  }
  if (node.kind === 'unary' && ['+', '-'].includes(node.op)) {
    const operand = emit(node.operand, language);
    return operand ? `(${node.op}${operand})` : null;
  }
  if (node.kind === 'binary') {
    const left = emit(node.left, language);
    const right = emit(node.right, language);
    if (!left || !right) return null;
    if (node.op === '^') return `pow(${left}, ${right})`;
    if (['+', '-', '*', '/'].includes(node.op)) return `(${left} ${node.op} ${right})`;
    return null;
  }
  if (node.kind === 'call') {
    const names = CALLS[node.name];
    if (!names || !Array.isArray(node.args)) return null;
    const args = node.args.map((argument) => emit(argument, language));
    if (args.some((argument) => !argument)) return null;
    if (node.name === 'atan2' && args.length !== 2) return null;
    return `${names[language === 'wgsl' ? 0 : 1]}(${args.join(', ')})`;
  }
  return null;
}

function emitJet(node, language, parameter) {
  if (!node || typeof node !== 'object') return null;
  if (node.kind === 'group') return emitJet(node.expression, language, parameter);
  const constant = (value) => [value, '0.0', '0.0'];
  if (node.kind === 'number') {
    const value = Number(node.value);
    return Number.isFinite(value) ? constant(shaderNumber(value)) : null;
  }
  if (node.kind === 'variable') {
    const value = emit(node, language);
    if (!value) return null;
    return node.name === parameter ? [value, '1.0', '0.0'] : constant(value);
  }
  if (node.kind === 'unary' && ['+', '-'].includes(node.op)) {
    const operand = emitJet(node.operand, language, parameter);
    if (!operand) return null;
    return node.op === '+' ? operand : operand.map((value) => `(-${value})`);
  }
  if (node.kind === 'binary') {
    const left = emitJet(node.left, language, parameter);
    const right = emitJet(node.right, language, parameter);
    if (!left || !right) return null;
    const [a, a1, a2] = left;
    const [b, b1, b2] = right;
    if (node.op === '+' || node.op === '-') return [
      `(${a} ${node.op} ${b})`, `(${a1} ${node.op} ${b1})`, `(${a2} ${node.op} ${b2})`
    ];
    if (node.op === '*') return [
      `(${a} * ${b})`,
      `((${a1} * ${b}) + (${a} * ${b1}))`,
      `((${a2} * ${b}) + (2.0 * ${a1} * ${b1}) + (${a} * ${b2}))`
    ];
    if (node.op === '/') {
      const value = `(${a} / ${b})`;
      const q = `((${a1} * ${b} - ${a} * ${b1}) / (${b} * ${b}))`;
      return [value, q,
        `((${a2} / ${b}) - (2.0 * ${a1} * ${b1} / (${b} * ${b})) - (${a} * ${b2} / (${b} * ${b})) + (2.0 * ${a} * ${b1} * ${b1} / (${b} * ${b} * ${b})))`];
    }
    if (node.op === '^' && node.right?.kind === 'number') {
      const exponent = Number(node.right.value);
      if (!Number.isFinite(exponent)) return null;
      const n = shaderNumber(exponent);
      const nMinusOne = shaderNumber(exponent - 1);
      const nMinusTwo = shaderNumber(exponent - 2);
      const value = `pow(${a}, ${n})`;
      return [value,
        `(${n} * pow(${a}, ${nMinusOne}) * ${a1})`,
        `((${n} * ${nMinusOne} * pow(${a}, ${nMinusTwo}) * ${a1} * ${a1}) + (${n} * pow(${a}, ${nMinusOne}) * ${a2}))`];
    }
    return null;
  }
  if (node.kind === 'call' && Array.isArray(node.args) && node.args.length === 1) {
    const argument = emitJet(node.args[0], language, parameter);
    if (!argument) return null;
    const [a, a1, a2] = argument;
    if (node.name === 'sin') return [
      `sin(${a})`, `(cos(${a}) * ${a1})`,
      `((-sin(${a}) * ${a1} * ${a1}) + (cos(${a}) * ${a2}))`
    ];
    if (node.name === 'cos') return [
      `cos(${a})`, `(-sin(${a}) * ${a1})`,
      `((-cos(${a}) * ${a1} * ${a1}) - (sin(${a}) * ${a2}))`
    ];
    if (node.name === 'tan') {
      const sec2 = `(1.0 / (cos(${a}) * cos(${a})))`;
      return [`tan(${a})`, `(${sec2} * ${a1})`,
        `((${sec2} * ${a2}) + (2.0 * ${sec2} * tan(${a}) * ${a1} * ${a1}))`];
    }
    if (node.name === 'sqrt') return [
      `sqrt(${a})`, `(${a1} / (2.0 * sqrt(${a})))`,
      `((${a2} / (2.0 * sqrt(${a}))) - (${a1} * ${a1} / (4.0 * pow(${a}, 1.5))))`
    ];
  }
  return null;
}

function emitComplex(node, language) {
  if (!node || typeof node !== 'object') return null;
  if (node.kind === 'group') return emitComplex(node.expression, language);
  const vector = (real, imaginary = '0.0') =>
    `${language === 'wgsl' ? 'vec2f' : 'vec2'}(${real}, ${imaginary})`;
  if (node.kind === 'number') {
    const value = Number(node.value);
    return Number.isFinite(value) ? vector(shaderNumber(value)) : null;
  }
  if (node.kind === 'variable') {
    if (node.name === 'i') return vector('0.0', '1.0');
    if (node.name === 'z') return vector('x', 'y');
    if (node.name === 'x' || node.name === 'y' || node.name === 't') return vector(node.name);
    if (node.name === 'pi') return vector(shaderNumber(Math.PI));
    if (node.name === 'r') return vector('sqrt(x * x + y * y)');
    if (node.name === 'phi') return vector(language === 'wgsl' ? 'atan2(y, x)' : 'atan(y, x)');
    return null;
  }
  if (node.kind === 'unary' && ['+', '-'].includes(node.op)) {
    const operand = emitComplex(node.operand, language);
    return operand ? (node.op === '-' ? `(-${operand})` : operand) : null;
  }
  if (node.kind === 'binary') {
    const left = emitComplex(node.left, language);
    const right = emitComplex(node.right, language);
    if (!left || !right) return null;
    if (node.op === '+') return `(${left} + ${right})`;
    if (node.op === '-') return `(${left} - ${right})`;
    if (node.op === '*') return `complexMul(${left}, ${right})`;
    if (node.op === '/') return `complexDiv(${left}, ${right})`;
    if (node.op === '^') {
      const exponent = node.right?.kind === 'number' ? Number(node.right.value) : Number.NaN;
      if (Number.isSafeInteger(exponent) && Math.abs(exponent) <= 16) {
        const count = Math.abs(exponent);
        let power = vector('1.0');
        for (let index = 0; index < count; index += 1) power = `complexMul(${power}, ${left})`;
        return exponent < 0 ? `complexDiv(${vector('1.0')}, ${power})` : power;
      }
      return `complexPow(${left}, ${right})`;
    }
    return null;
  }
  if (node.kind === 'call' && Array.isArray(node.args)) {
    const args = node.args.map((argument) => emitComplex(argument, language));
    if (args.some((argument) => !argument)) return null;
    if (node.name === 'complex' && args.length === 2) return vector(`${args[0]}.x`, `${args[1]}.x`);
    if (node.name === 'abs' && args.length === 1) return vector(`length(${args[0]})`);
    if (node.name === 'sqrt' && args.length === 1) return `complexSqrt(${args[0]})`;
    if (node.name === 'sin' && args.length === 1) return `complexSin(${args[0]})`;
    if (node.name === 'cos' && args.length === 1) return `complexCos(${args[0]})`;
    if (node.name === 'tan' && args.length === 1) return `complexDiv(complexSin(${args[0]}), complexCos(${args[0]}))`;
    if (node.name === 'exp' && args.length === 1) return `complexExp(${args[0]})`;
    if ((node.name === 'ln' || node.name === 'log') && args.length === 1) return `complexLog(${args[0]})`;
    if (node.name === 'atan2' && args.length === 2) {
      return vector(language === 'wgsl'
        ? `atan2(${args[0]}.x, ${args[1]}.x)`
        : `atan(${args[0]}.x, ${args[1]}.x)`);
    }
  }
  return null;
}

function shaderNumber(value) {
  if (Object.is(value, -0)) return '0.0';
  const text = String(value);
  return /[.eE]/.test(text) ? text : `${text}.0`;
}
