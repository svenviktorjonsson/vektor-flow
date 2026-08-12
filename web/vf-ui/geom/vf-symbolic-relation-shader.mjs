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
    colormapPoints: normalizedShaderColormap(style)
  });
}

export function compileSymbolicRelationShader(ast, variants = null) {
  const relations = Array.isArray(variants) && variants.length ? variants : [ast];
  if (!relations.every((relation) => relation?.kind === 'binary' && RELATION_OPERATORS.has(relation.op))) return null;
  if (!relations.every((relation) => relation.op === ast.op)) return null;
  const wgslResiduals = relations.map((relation) => emitResidual(relation, 'wgsl'));
  const glslResiduals = relations.map((relation) => emitResidual(relation, 'glsl'));
  if (![...wgslResiduals, ...glslResiduals].every(Boolean)) return null;
  const boundaryResidual = (residuals) => combine(residuals.map((residual) => `abs(${residual})`), 'min');
  const fillOperator = ['<', '<='].includes(ast.op) ? 'min' : 'max';
  return Object.freeze({
    kind: 'relation',
    operator: ast.op,
    hasFill: ast.op !== '=',
    hasBoundary: ['=', '<=', '>='].includes(ast.op),
    insideSign: ['<', '<='].includes(ast.op) ? -1 : 1,
    wgslBoundaryResidual: boundaryResidual(wgslResiduals),
    glslBoundaryResidual: boundaryResidual(glslResiduals),
    wgslFillResidual: combine(wgslResiduals, fillOperator),
    glslFillResidual: combine(glslResiduals, fillOperator)
  });
}

export function compileSymbolicRelationShaderGroup(programs) {
  if (!Array.isArray(programs) || programs.length === 0) return null;
  const shaders = programs.map(({ ast, variants }) => compileSymbolicRelationShader(ast, variants));
  if (shaders.some((shader) => shader == null)) return null;
  const boundaries = shaders.filter(({ hasBoundary }) => hasBoundary);
  const fills = shaders.filter(({ hasFill }) => hasFill);
  const boundary = (language) => boundaries.length
    ? combine(boundaries.map((shader) => shader[`${language}BoundaryResidual`]), 'min')
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
    wgslFillResidual: fill('wgsl'),
    glslFillResidual: fill('glsl')
  });
}

function normalizedShaderColormap(style) {
  const source = Array.isArray(style.colormapPoints) && style.colormapPoints.length
    ? style.colormapPoints
    : [
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

function emitComplex(node, language) {
  if (!node || typeof node !== 'object') return null;
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
    if (node.op === '^') return `complexPow(${left}, ${right})`;
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
