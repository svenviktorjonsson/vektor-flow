const RELATION_OPERATORS = new Set(['=', '<', '>', '<=', '>=']);

const CALLS = Object.freeze({
  abs: ['abs', 'abs'],
  atan2: ['atan2', 'atan'],
  cos: ['cos', 'cos'],
  sin: ['sin', 'sin'],
  sqrt: ['sqrt', 'sqrt'],
  tan: ['tan', 'tan']
});

export function compileSymbolicRelationShader(ast) {
  if (!ast || ast.kind !== 'binary' || !RELATION_OPERATORS.has(ast.op)) return null;
  const wgslLeft = emit(ast.left, 'wgsl');
  const wgslRight = emit(ast.right, 'wgsl');
  const glslLeft = emit(ast.left, 'glsl');
  const glslRight = emit(ast.right, 'glsl');
  if (![wgslLeft, wgslRight, glslLeft, glslRight].every(Boolean)) return null;
  return Object.freeze({
    operator: ast.op,
    hasFill: ast.op !== '=',
    hasBoundary: ['=', '<=', '>='].includes(ast.op),
    insideSign: ['<', '<='].includes(ast.op) ? -1 : 1,
    wgslResidual: `((${wgslLeft}) - (${wgslRight}))`,
    glslResidual: `((${glslLeft}) - (${glslRight}))`
  });
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

function shaderNumber(value) {
  if (Object.is(value, -0)) return '0.0';
  const text = String(value);
  return /[.eE]/.test(text) ? text : `${text}.0`;
}
