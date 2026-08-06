const PROPERTY_DESCRIPTORS = Object.freeze([
  descriptor('p', ['vertex'], 'position', { tuple: true, complex: true, overrides: ['v', 'a'] }),
  descriptor('x', ['vertex'], 'length'),
  descriptor('y', ['vertex'], 'length'),
  descriptor('z', ['vertex'], 'length', { minimumDimension: 3 }),
  descriptor('v', ['vertex'], 'velocity', { temporal: true, tuple: true, complex: true, overrides: ['a'] }),
  descriptor('vx', ['vertex'], 'velocity', { temporal: true }),
  descriptor('vy', ['vertex'], 'velocity', { temporal: true }),
  descriptor('vz', ['vertex'], 'velocity', { temporal: true, minimumDimension: 3 }),
  descriptor('a', ['vertex'], 'acceleration', { temporal: true, tuple: true, complex: true }),
  descriptor('L', ['edge'], 'length', { directed: true }),
  descriptor('k', ['edge'], 'linear-spring-constant'),
  descriptor('m', ['vertex'], 'mass'),
  descriptor('q', ['vertex'], 'charge'),
  descriptor('lambda_m', ['edge'], 'line-mass-density'),
  descriptor('lambda_q', ['edge'], 'line-charge-density'),
  descriptor('sigma_m', ['face'], 'surface-mass-density'),
  descriptor('sigma_q', ['face'], 'surface-charge-density'),
  descriptor('rho_m', ['volume'], 'volume-mass-density'),
  descriptor('rho_q', ['volume'], 'volume-charge-density'),
  descriptor('T', ['vertex', 'edge', 'face', 'volume'], 'temperature'),
  descriptor('epsilon', ['vertex', 'edge', 'face', 'volume'], 'electric-permittivity', { field: true }),
  descriptor('mu', ['vertex', 'edge', 'face', 'volume'], 'magnetic-permeability', { field: true }),
  descriptor('sigma_e', ['vertex', 'edge', 'face', 'volume'], 'electrical-conductivity', { field: true }),
  descriptor('kappa', ['vertex', 'edge', 'face', 'volume'], 'thermal-conductivity', { field: true }),
  descriptor('alpha', ['vertex', 'edge', 'face', 'volume'], 'thermal-diffusivity', { field: true }),
  descriptor('c_p', ['vertex', 'edge', 'face', 'volume'], 'specific-heat-capacity', { field: true }),
  descriptor('h', ['face'], 'convective-heat-transfer', { field: true }),
  descriptor('epsilon_rad', ['face'], 'thermal-emissivity', { field: true }),
  descriptor('eta', ['vertex', 'edge', 'face', 'volume'], 'dynamic-viscosity', { field: true }),
  descriptor('nu', ['vertex', 'edge', 'face', 'volume'], 'kinematic-viscosity', { field: true }),
  descriptor('P', ['vertex', 'edge', 'face', 'volume'], 'pressure', { field: true }),
  descriptor('E', ['vertex', 'edge', 'face', 'volume'], 'electric-field', { field: true, tuple: true, complex: true }),
  descriptor('B', ['vertex', 'edge', 'face', 'volume'], 'magnetic-flux-density', { field: true, tuple: true, complex: true }),
  descriptor('phi', ['vertex', 'edge', 'face', 'volume'], 'electric-potential', { field: true }),
  descriptor('c', ['vertex', 'edge', 'face'], 'color-coordinate')
]);

export function reachablePropertyDescriptors({
  geometryKinds = [],
  dimension = 2,
  temporal = false
} = {}) {
  const kinds = new Set(geometryKinds);
  return Object.freeze(PROPERTY_DESCRIPTORS.filter((property) =>
    property.geometryKinds.some((kind) => kinds.has(kind))
    && dimension >= property.minimumDimension
    && (!property.temporal || temporal)
  ));
}

export function spillEditableBindings(scopes = []) {
  const names = new Set();
  const spilled = [];
  for (const scope of scopes) {
    for (const binding of scope?.bindings || []) {
      if (!binding?.name || names.has(binding.name)) continue;
      names.add(binding.name);
      spilled.push({
        name: binding.name,
        kind: binding.kind || 'variable',
        value: binding.value,
        scopeId: scope.id || 'global',
        writable: binding.writable !== false
      });
    }
  }
  return spilled;
}

export function parsePropertyProgram(source) {
  const properties = [];
  const bindings = [];
  for (const rawLine of String(source ?? '').split(/[\n;]/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const property = /^\.([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/.exec(line);
    if (property) {
      properties.push({ name: property[1], expression: property[2].trim() });
      continue;
    }
    const definition = /^([A-Za-z_][A-Za-z0-9_]*)(?:\s*\([^)]*\))?\s*:/.exec(line);
    bindings.push({ source: line, ...(definition ? { name: definition[1] } : {}) });
  }
  return { properties, bindings };
}

export function validatePropertyProgram(program, {
  propertyNames = [],
  variableNames = []
} = {}) {
  const reachable = new Set([...propertyNames, ...variableNames]);
  const diagnostics = [];
  for (const binding of program?.bindings || []) {
    if (binding.name) reachable.add(binding.name);
  }
  for (const property of program?.properties || []) {
    if (reachable.has(property.name)) continue;
    diagnostics.push(Object.freeze({
      severity: 'error',
      code: 'unknown_update_target',
      name: property.name,
      message: `Cannot update unknown name .${property.name}; declare it first with ${property.name}:value`
    }));
  }
  return Object.freeze({
    valid: diagnostics.length === 0,
    diagnostics: Object.freeze(diagnostics)
  });
}

export function serializePropertyProgram(values = {}) {
  return Object.entries(values)
    .map(([name, value]) => `.${name}:${serializeValue(value)}`)
    .join('\n');
}

export function expandEvaluatedReferences(source, bindings = {}) {
  return String(source ?? '').replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (reference, name) => {
    if (!(name in bindings)) return reference;
    const binding = bindings[name];
    if (binding && typeof binding === 'object' && typeof binding.expression === 'string') {
      return `(${binding.expression})`;
    }
    if (binding && typeof binding === 'object' && 'value' in binding) {
      return serializeReferenceValue(binding.value);
    }
    if (typeof binding === 'string') return `(${binding})`;
    return serializeReferenceValue(binding);
  });
}

export function highlightPropertyProgram(source) {
  const text = String(source ?? '');
  const pattern = /(\.[A-Za-z_][A-Za-z0-9_]*)|(\$[A-Za-z_][A-Za-z0-9_]*)|([A-Za-z_][A-Za-z0-9_]*)(?=\s*(?:\([^\n)]*\))?\s*:)|(W\/\(m\^2\*K\)|W\/\(m\*K\)|J\/\(kg\*K\)|kg\/m\^[123]|g\/m\^[123]|C\/m\^[123]|m\^2\/s|Pa\*s|F\/m|H\/m|S\/m|V\/m|N\/m|kg\/m|g\/m|C\/m|mm\/s|cm\/s|m\/s|mm|cm|kg|Pa|K|C|T|V|g|m)(?=\s|$)|([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)|(#[^\n]*)|([A-Za-z_][A-Za-z0-9_]*)|(\s+|[^\s])/giy;
  const tokens = [];
  for (const match of text.matchAll(pattern)) {
    const role = match[1] ? 'update'
      : match[2] ? 'reference'
        : match[3] ? 'definition'
          : match[4] ? 'unit'
            : match[5] ? 'number'
              : match[6] ? 'comment'
                : match[7] ? 'symbol'
                : 'plain';
    tokens.push(Object.freeze({ text: match[0], role }));
  }
  return Object.freeze(tokens);
}

function descriptor(name, geometryKinds, quantity, options = {}) {
  return Object.freeze({
    name,
    geometryKinds: Object.freeze(geometryKinds),
    quantity,
    minimumDimension: options.minimumDimension || 1,
    temporal: options.temporal === true,
    tuple: options.tuple === true,
    complex: options.complex === true,
    field: options.field === true,
    overrides: Object.freeze(options.overrides || []),
    directed: options.directed === true
  });
}

function serializeValue(value) {
  if (Array.isArray(value)) return `(${value.map(serializeScalar).join(',')})`;
  return serializeScalar(value);
}

function serializeScalar(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError('property values must be finite numbers');
  return Object.is(number, -0) ? '0' : String(number);
}

function serializeReferenceValue(value) {
  if (Array.isArray(value)) return `(${value.map(serializeReferenceValue).join(',')})`;
  if (value && typeof value === 'object' && Number.isFinite(value.re) && Number.isFinite(value.im)) {
    return `(${serializeScalar(value.re)}+${serializeScalar(value.im)}i)`;
  }
  return serializeScalar(value);
}
