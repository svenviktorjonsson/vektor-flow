const RELATION_OPERATORS = Object.freeze(['>=', '<=', '>', '<', '=']);
const CONSTRAINT_CLASSIFICATIONS = new Set([
  'open-region',
  'closed-region',
  'boundary-constraint'
]);

export function isSymbolicConstraintClassification(classification) {
  return CONSTRAINT_CLASSIFICATIONS.has(classification);
}

export function symbolicConstraintScope(expressions = []) {
  const global = [];
  const local = {};
  for (const expression of expressions || []) {
    const constraints = constraintSpans(expression).map((span, index) => (
      constraintDescriptor(expression, span, index)
    ));
    if (!constraints.length) continue;
    if (isStandaloneSymbolicConstraintDocument(expression)) {
      global.push(...constraints);
      continue;
    }
    for (const plot of expression.plotSegments || []) {
      local[`${expression.id}::${plot.id}`] = constraints
        .filter((constraint) => constraint.end <= Number(plot.start ?? Number.POSITIVE_INFINITY))
        .map(stripConstraintPosition);
    }
  }
  return Object.freeze({
    global: Object.freeze(global.map(stripConstraintPosition)),
    local: Object.freeze(Object.fromEntries(Object.entries(local).map(([key, value]) => [
      key, Object.freeze(value)
    ])))
  });
}

export function isStandaloneSymbolicConstraintDocument(expression) {
  const spans = Array.isArray(expression?.spans) ? expression.spans : [];
  let count = 0;
  for (const span of spans) {
    if (span?.kind === 'text' && !String(span.source || '').trim()) continue;
    if (span?.kind !== 'math' || !isSymbolicConstraintClassification(span.classification)) {
      return false;
    }
    count += 1;
  }
  return count > 0;
}

export function describeSymbolicConstraint(constraint = {}, { parameterName = null } = {}) {
  const source = String(constraint.source ?? '');
  const relations = topLevelRelations(source);
  const name = String(parameterName || '').trim();
  const boundaries = relations
    .filter(({ operator }) => operator === '<=' || operator === '>=')
    .map((relation, index) => ({ relation, index }))
    .filter(({ relation }) => !name || relation.left === name || relation.right === name)
    .map(({ index }) => Object.freeze({
      index,
      target: `vertex:${index}`,
      inclusive: true
    }));
  return Object.freeze({
    ...constraint,
    source,
    plotParts: symbolicConstraintPlotParts(source),
    boundaries: Object.freeze(boundaries)
  });
}

export function symbolicConstraintPlotParts(source) {
  const relations = topLevelRelations(source);
  if (!relations.length) return Object.freeze([]);
  if (relations.every(({ operator }) => operator === '=')) return Object.freeze(['edge']);
  if (relations.every(({ operator }) => operator === '>' || operator === '<')) {
    return Object.freeze(['face']);
  }
  if (relations.some(({ operator }) => operator === '>=' || operator === '<=')) {
    return Object.freeze(['face', 'edge']);
  }
  return Object.freeze(['face']);
}

export function editSymbolicConstraint(source, parts = []) {
  const text = String(source ?? '');
  const selected = new Set(parts || []);
  const relations = topLevelRelations(text);
  if (!relations.length) return null;
  const inclusive = relations.filter(({ operator }) => operator === '>=' || operator === '<=');
  const vertexPart = [...selected].find((part) => /^vertex:\d+$/.test(part));
  if (vertexPart) {
    const relation = inclusive[Number(vertexPart.slice('vertex:'.length))];
    return relation ? Object.freeze({
      action: 'rewrite',
      source: replaceRelationOperator(text, relation, relation.operator[0])
    }) : null;
  }
  if (selected.has('curve') || selected.has('graph')) {
    if (!inclusive.length) return Object.freeze({ action: 'hide-plot', source: text });
    return Object.freeze({
      action: 'rewrite',
      source: inclusive.map(({ left, right }) => `${left}=${right}`).join(' \\/ ')
    });
  }
  if (selected.has('edge') && selected.has('face')) {
    return Object.freeze({ action: 'hide-plot', source: text });
  }
  if (selected.has('edge') && inclusive.length) {
    return Object.freeze({
      action: 'rewrite',
      source: replaceRelationOperators(text, inclusive, ({ operator }) => operator[0])
    });
  }
  if (selected.has('face') && inclusive.length) {
    return Object.freeze({
      action: 'rewrite',
      source: inclusive.map(({ left, right }) => `${left}=${right}`).join(' \\/ ')
    });
  }
  return null;
}

function constraintSpans(expression) {
  return (Array.isArray(expression?.spans) ? expression.spans : [])
    .filter((span) => span?.kind === 'math' && isSymbolicConstraintClassification(span.classification));
}

function constraintDescriptor(expression, span, index) {
  const segmentId = span.id || `math:${index}`;
  return Object.freeze({
    id: `${expression.id}:constraint:${segmentId}`,
    expressionId: expression.id,
    segmentId,
    source: String(span.source ?? ''),
    classification: span.classification,
    start: Number(span.start) || 0,
    end: Number(span.end) || 0
  });
}

function stripConstraintPosition(constraint) {
  const { start: _start, end: _end, ...publicConstraint } = constraint;
  return Object.freeze(publicConstraint);
}

function topLevelRelations(source) {
  if (typeof source !== 'string') return [];
  const relations = [];
  let round = 0;
  let square = 0;
  let curly = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '(') round += 1;
    else if (character === ')') round = Math.max(0, round - 1);
    else if (character === '[') square += 1;
    else if (character === ']') square = Math.max(0, square - 1);
    else if (character === '{') curly += 1;
    else if (character === '}') curly = Math.max(0, curly - 1);
    if (round || square || curly) continue;
    const operator = RELATION_OPERATORS.find((candidate) => source.startsWith(candidate, index));
    if (!operator) continue;
    relations.push({ index, operator });
    index += operator.length - 1;
  }
  return relations.map((relation, index) => Object.freeze({
    ...relation,
    left: source.slice(
      index === 0 ? 0 : relations[index - 1].index + relations[index - 1].operator.length,
      relation.index
    ).trim(),
    right: source.slice(
      relation.index + relation.operator.length,
      relations[index + 1]?.index ?? source.length
    ).trim()
  }));
}

function replaceRelationOperator(source, relation, operator) {
  return `${source.slice(0, relation.index)}${operator}${source.slice(relation.index + relation.operator.length)}`;
}

function replaceRelationOperators(source, relations, operatorFor) {
  return [...relations].reverse().reduce((rewritten, relation) => (
    replaceRelationOperator(rewritten, relation, operatorFor(relation))
  ), source);
}
