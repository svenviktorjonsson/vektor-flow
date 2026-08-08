export const STEFAN_BOLTZMANN = 5.670374419e-8;

export const MAXWELL_BOUNDARIES = Object.freeze({
  PERIODIC: 'periodic',
  PEC: 'pec'
});

export const BUILTIN_PHYSICS_MODULES = Object.freeze({
  inertia: Object.freeze({ id: 'inertia', requiresTime: true, symbols: Object.freeze(['p', 'L', 'F', 'tau']) }),
  rigidCollisions: Object.freeze({ id: 'rigidCollisions', requiresTime: true, dependsOn: Object.freeze(['inertia']), symbols: Object.freeze(['restitution', 'friction']) }),
  em: Object.freeze({ id: 'em', requiresTime: false, symbols: Object.freeze(['q', 'rho_q', 'J', 'E', 'B', 'epsilon', 'mu', 'sigma']) }),
  temperature: Object.freeze({ id: 'temperature', requiresTime: true, symbols: Object.freeze(['T', 'kappa', 'c_p', 'epsilon_rad']) }),
  light: Object.freeze({ id: 'light', requiresTime: false, symbols: Object.freeze(['luminousIntensity', 'wavelength', 'ray']) })
});

export function createPhysicsScope({ properties = {}, modules = [] } = {}) {
  const scope = { ...properties };
  const owners = new Map(Object.keys(scope).map((symbol) => [symbol, 'properties']));
  for (const module of modules) {
    if (module?.enabled !== true) continue;
    for (const [symbol, value] of Object.entries(module.exports || {})) {
      if (owners.has(symbol)) {
        throw new Error(`ambiguous physics symbol "${symbol}" from ${owners.get(symbol)} and ${module.id || 'module'}`);
      }
      owners.set(symbol, module.id || 'module');
      scope[symbol] = value;
    }
  }
  return scope;
}

export function createGlobalFieldRegistry({ geometryProperties = [], modules = [] } = {}) {
  const fields = new Map();
  const publish = (name, field, owner) => {
    if (fields.has(name)) throw new Error(`ambiguous global field "${name}" from ${fields.get(name).owner} and ${owner}`);
    if (!field || typeof field.sample !== 'function') throw new TypeError(`global field "${name}" requires a sample function`);
    fields.set(name, Object.freeze({
      name,
      kind: field.kind || 'scalar',
      sample: field.sample,
      owner
    }));
  };
  for (const property of geometryProperties) {
    if (property?.escapesGeometry !== true) continue;
    publish(String(property.name), property, property.geometryId || 'geometry');
  }
  for (const module of modules) {
    if (module?.enabled !== true) continue;
    for (const [name, field] of Object.entries(module.globalFields || {})) {
      publish(name, field, module.id || 'module');
    }
  }
  return fields;
}

export function sampleGlobalField(fields, name, point, context = {}) {
  const field = fields?.get?.(name);
  if (!field) throw new RangeError(`Unknown global field: ${name}`);
  return field.sample([...point], context);
}

export function maxwellGlobalFields(state, { origin = [] } = {}) {
  const shape = normalizedShape(state.shape);
  const spacing = normalizedSpacing(state.spacing, shape.length);
  const cells = cellCount(shape);
  const electric = numericArray(state.electric, 'electric', cells * 3);
  const magnetic = numericArray(state.magnetic, 'magnetic', cells * 3);
  const sample = (values) => (point) => sampleGridVector(values, point, shape, spacing, origin);
  return Object.freeze({
    E: Object.freeze({ kind: 'vector', sample: sample(electric) }),
    B: Object.freeze({ kind: 'vector', sample: sample(magnetic) })
  });
}

export function stepInertialBodies(bodies, dt) {
  const step = finiteNonNegative(dt, 'dt');
  return bodies.map((body) => {
    const position = vector(body.position, 3);
    const momentum = add(vector(body.momentum, 3), scale(vector(body.force, 3), step));
    const angularMomentum = add(
      vector(body.angularMomentum, 3),
      scale(vector(body.torque, 3), step)
    );
    const mass = finitePositive(body.mass, 'body mass');
    const velocity = scale(momentum, 1 / mass);
    const angularVelocity = solveInertia(body.inertia, angularMomentum);
    const orientation = body.orientation
      ? integrateQuaternion(body.orientation, angularVelocity, step)
      : undefined;
    return {
      ...body,
      position: add(position, scale(velocity, step)),
      momentum,
      angularMomentum,
      velocity,
      angularVelocity,
      ...(orientation ? { orientation } : {})
    };
  });
}

export function stepThermalNetwork(network, dt) {
  const step = finiteNonNegative(dt, 'dt');
  const temperature = numericArray(network.temperatures, 'temperatures');
  const capacity = fieldValues(network.heatCapacities, temperature.length, 1, 'heat capacity');
  capacity.forEach((value) => finitePositive(value, 'heat capacity'));
  const energy = Array(temperature.length).fill(0);
  for (const edge of network.conductanceEdges || []) {
    const from = validIndex(edge.from, temperature.length);
    const to = validIndex(edge.to, temperature.length);
    const transfer = finiteNonNegative(edge.conductance, 'conductance')
      * (temperature[to] - temperature[from]) * step;
    energy[from] += transfer;
    energy[to] -= transfer;
  }
  for (let index = 0; index < temperature.length; index += 1) {
    energy[index] += fieldValue(network.heatSources, index, 0) * step;
  }
  let radiatedEnergy = 0;
  const environment = Number(network.environmentTemperature ?? 0);
  for (const surface of network.radiationSurfaces || []) {
    const node = validIndex(surface.node, temperature.length);
    const emissivity = unitInterval(surface.emissivity, 'emissivity');
    const area = finiteNonNegative(surface.area, 'radiating area');
    const transfer = emissivity * STEFAN_BOLTZMANN * area
      * (environment ** 4 - temperature[node] ** 4) * step;
    energy[node] += transfer;
    radiatedEnergy += transfer;
  }
  const temperatures = temperature.map((value, index) => Math.max(0, value + energy[index] / capacity[index]));
  return {
    ...network,
    temperatures,
    energyDelta: temperatures.reduce((sum, value, index) => (
      sum + capacity[index] * (value - temperature[index])
    ), 0),
    radiatedEnergy
  };
}

export function stepHeatField(field, dt) {
  const shape = normalizedShape(field.shape);
  const spacing = normalizedSpacing(field.spacing, shape.length);
  const cells = cellCount(shape);
  const temperature = numericArray(field.temperature, 'temperature', cells);
  const diffusivity = fieldValues(field.diffusivity, cells, 0, 'diffusivity');
  const maxDiffusivity = Math.max(...diffusivity);
  const stabilityLimit = maxDiffusivity === 0
    ? Number.POSITIVE_INFINITY
    : 1 / (2 * maxDiffusivity * spacing.reduce((sum, value) => sum + 1 / (value * value), 0));
  const step = finiteNonNegative(dt, 'dt');
  if (step > stabilityLimit * (1 + 1e-12)) {
    throw new RangeError(`heat step exceeds explicit stability limit ${stabilityLimit}`);
  }
  const boundary = field.boundary || 'insulated';
  const next = temperature.map((value, index) => {
    const coordinates = coordinatesOf(index, shape);
    let laplacian = 0;
    for (let axis = 0; axis < shape.length; axis += 1) {
      const low = neighborValue(temperature, coordinates, axis, -1, shape, boundary, value);
      const high = neighborValue(temperature, coordinates, axis, 1, shape, boundary, value);
      laplacian += (low - 2 * value + high) / (spacing[axis] ** 2);
    }
    const source = fieldValue(field.heatSources, index, 0);
    let derivative = diffusivity[index] * laplacian + source;
    const emissivity = fieldValue(field.emissivity, index, 0);
    if (emissivity) {
      const densityCapacity = finitePositive(fieldValue(field.volumetricHeatCapacity, index, 1), 'volumetric heat capacity');
      const areaDensity = finiteNonNegative(fieldValue(field.radiatingAreaDensity, index, 0), 'radiating area density');
      const environment = Number(field.environmentTemperature ?? 0);
      derivative += emissivity * STEFAN_BOLTZMANN * areaDensity
        * (environment ** 4 - value ** 4) / densityCapacity;
    }
    return Math.max(0, value + derivative * step);
  });
  return { ...field, shape, spacing, temperature: next, stabilityLimit };
}

export function maxwellCflLimit(state) {
  const shape = normalizedShape(state.shape);
  const spacing = normalizedSpacing(state.spacing, shape.length);
  const cells = cellCount(shape);
  const epsilon = fieldValues(state.permittivity, cells, 1, 'permittivity');
  const mu = fieldValues(state.permeability, cells, 1, 'permeability');
  let maxWaveSpeed = 0;
  for (let index = 0; index < cells; index += 1) {
    maxWaveSpeed = Math.max(maxWaveSpeed, 1 / Math.sqrt(
      finitePositive(epsilon[index], 'permittivity') * finitePositive(mu[index], 'permeability')
    ));
  }
  return 1 / (maxWaveSpeed * Math.sqrt(spacing.reduce((sum, value) => sum + 1 / (value * value), 0)));
}

export function stepMaxwellField(state, dt) {
  const shape = normalizedShape(state.shape);
  const spacing = normalizedSpacing(state.spacing, shape.length);
  const cells = cellCount(shape);
  const electric = numericArray(state.electric, 'electric', cells * 3);
  const magnetic = numericArray(state.magnetic, 'magnetic', cells * 3);
  const current = fieldVectors(state.current, cells);
  const epsilon = fieldValues(state.permittivity, cells, 1, 'permittivity');
  const mu = fieldValues(state.permeability, cells, 1, 'permeability');
  const conductivity = fieldValues(state.conductivity, cells, 0, 'conductivity');
  const step = finiteNonNegative(dt, 'dt');
  const cfl = maxwellCflLimit({ ...state, shape, spacing });
  if (step > cfl * (1 + 1e-12)) throw new RangeError(`Maxwell step exceeds CFL limit ${cfl}`);
  const boundary = state.boundary || MAXWELL_BOUNDARIES.PEC;
  if (!Object.values(MAXWELL_BOUNDARIES).includes(boundary)) throw new RangeError(`Unknown Maxwell boundary: ${boundary}`);

  const nextMagnetic = [...magnetic];
  for (let index = 0; index < cells; index += 1) {
    const curlE = curlAt(electric, index, shape, spacing, boundary);
    for (let component = 0; component < 3; component += 1) {
      nextMagnetic[index * 3 + component] -= step * curlE[component];
    }
  }
  const nextElectric = [...electric];
  for (let index = 0; index < cells; index += 1) {
    const curlB = curlAt(nextMagnetic, index, shape, spacing, boundary);
    const eps = finitePositive(epsilon[index], 'permittivity');
    const permeability = finitePositive(mu[index], 'permeability');
    for (let component = 0; component < 3; component += 1) {
      const offset = index * 3 + component;
      nextElectric[offset] += step * (
        curlB[component] / permeability
        - current[offset]
        - conductivity[index] * electric[offset]
      ) / eps;
    }
  }
  if (boundary === MAXWELL_BOUNDARIES.PEC) {
    for (let index = 0; index < cells; index += 1) {
      const coordinates = coordinatesOf(index, shape);
      if (coordinates.some((value, axis) => value === 0 || value === shape[axis] - 1)) {
        nextElectric[index * 3] = 0;
        nextElectric[index * 3 + 1] = 0;
        nextElectric[index * 3 + 2] = 0;
      }
    }
  }
  return {
    ...state,
    shape,
    spacing,
    electric: nextElectric,
    magnetic: nextMagnetic,
    cflLimit: cfl,
    divergenceElectric: divergenceField(nextElectric, shape, spacing, boundary),
    divergenceMagnetic: divergenceField(nextMagnetic, shape, spacing, boundary)
  };
}

export function solveElectrostaticPotential(options) {
  const shape = normalizedShape(options.shape);
  const spacing = normalizedSpacing(options.spacing, shape.length);
  const cells = cellCount(shape);
  const charge = fieldValues(options.chargeDensity, cells, 0, 'charge density');
  const epsilon = fieldValues(options.permittivity, cells, 1, 'permittivity');
  let potential = fieldValues(options.initialPotential, cells, 0, 'potential');
  const iterations = Math.max(1, Math.trunc(Number(options.iterations ?? 500)));
  const weights = spacing.map((value) => 1 / (value * value));
  const denominator = 2 * weights.reduce((sum, value) => sum + value, 0);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next = [...potential];
    for (let index = 0; index < cells; index += 1) {
      const coordinates = coordinatesOf(index, shape);
      if (coordinates.some((value, axis) => value === 0 || value === shape[axis] - 1)) {
        next[index] = 0;
        continue;
      }
      let neighbors = 0;
      for (let axis = 0; axis < shape.length; axis += 1) {
        neighbors += weights[axis] * (
          potential[indexOf(offsetCoordinate(coordinates, axis, -1), shape)]
          + potential[indexOf(offsetCoordinate(coordinates, axis, 1), shape)]
        );
      }
      next[index] = (neighbors + charge[index] / finitePositive(epsilon[index], 'permittivity')) / denominator;
    }
    potential = next;
  }
  const electric = Array(cells * 3).fill(0);
  for (let index = 0; index < cells; index += 1) {
    const coordinates = coordinatesOf(index, shape);
    for (let axis = 0; axis < shape.length; axis += 1) {
      const low = neighborValue(potential, coordinates, axis, -1, shape, 'fixed', potential[index]);
      const high = neighborValue(potential, coordinates, axis, 1, shape, 'fixed', potential[index]);
      electric[index * 3 + axis] = -(high - low) / (2 * spacing[axis]);
    }
  }
  return { shape, spacing, potential, electric };
}

function curlAt(field, index, shape, spacing, boundary) {
  const c = coordinatesOf(index, shape);
  const derivative = (component, axis) => {
    if (axis >= shape.length) return 0;
    const low = vectorNeighbor(field, c, component, axis, -1, shape, boundary);
    const high = vectorNeighbor(field, c, component, axis, 1, shape, boundary);
    return (high - low) / (2 * spacing[axis]);
  };
  return [
    derivative(2, 1) - derivative(1, 2),
    derivative(0, 2) - derivative(2, 0),
    derivative(1, 0) - derivative(0, 1)
  ];
}

function divergenceField(field, shape, spacing, boundary) {
  return Array.from({ length: cellCount(shape) }, (_, index) => {
    const c = coordinatesOf(index, shape);
    let divergence = 0;
    for (let axis = 0; axis < shape.length; axis += 1) {
      divergence += (
        vectorNeighbor(field, c, axis, axis, 1, shape, boundary)
        - vectorNeighbor(field, c, axis, axis, -1, shape, boundary)
      ) / (2 * spacing[axis]);
    }
    return divergence;
  });
}

function vectorNeighbor(field, coordinates, component, axis, direction, shape, boundary) {
  const neighbor = [...coordinates];
  neighbor[axis] += direction;
  if (neighbor[axis] < 0 || neighbor[axis] >= shape[axis]) {
    if (boundary === MAXWELL_BOUNDARIES.PERIODIC) {
      neighbor[axis] = (neighbor[axis] + shape[axis]) % shape[axis];
    } else {
      return 0;
    }
  }
  return field[indexOf(neighbor, shape) * 3 + component];
}

function sampleGridVector(values, point, shape, spacing, origin) {
  const coordinates = shape.map((size, axis) => Math.max(0, Math.min(
    size - 1,
    Math.round((Number(point[axis] || 0) - Number(origin[axis] || 0)) / spacing[axis])
  )));
  const offset = indexOf(coordinates, shape) * 3;
  return values.slice(offset, offset + 3);
}

function neighborValue(field, coordinates, axis, direction, shape, boundary, fallback) {
  const neighbor = [...coordinates];
  neighbor[axis] += direction;
  if (neighbor[axis] < 0 || neighbor[axis] >= shape[axis]) {
    if (boundary === 'periodic') neighbor[axis] = (neighbor[axis] + shape[axis]) % shape[axis];
    else if (boundary === 'fixed') return 0;
    else return fallback;
  }
  return field[indexOf(neighbor, shape)];
}

function solveInertia(inertia, angularMomentum) {
  if (typeof inertia === 'number') return scale(angularMomentum, 1 / finitePositive(inertia, 'inertia'));
  if (Array.isArray(inertia) && inertia.length === 3 && inertia.every(Number.isFinite)) {
    return inertia.map((value, index) => angularMomentum[index] / finitePositive(value, 'inertia'));
  }
  if (Array.isArray(inertia) && inertia.length === 3 && inertia.every((row) => Array.isArray(row) && row.length === 3)) {
    return solve3(inertia, angularMomentum);
  }
  throw new TypeError('inertia must be a positive scalar, diagonal vector, or 3x3 tensor');
}

function solve3(matrix, vectorValue) {
  const [a, b, c] = matrix.map((row) => row.map(Number));
  const det = a[0] * (b[1] * c[2] - b[2] * c[1])
    - a[1] * (b[0] * c[2] - b[2] * c[0])
    + a[2] * (b[0] * c[1] - b[1] * c[0]);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-15) throw new RangeError('inertia tensor must be invertible');
  const replace = (column) => matrix.map((row, rowIndex) => row.map((value, index) => (
    index === column ? vectorValue[rowIndex] : value
  )));
  const determinant = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  return [0, 1, 2].map((column) => determinant(replace(column)) / det);
}

function integrateQuaternion(value, angularVelocity, dt) {
  const q = numericArray(value, 'orientation', 4);
  const [wx, wy, wz] = angularVelocity;
  const derivative = [
    -q[1] * wx - q[2] * wy - q[3] * wz,
    q[0] * wx + q[2] * wz - q[3] * wy,
    q[0] * wy + q[3] * wx - q[1] * wz,
    q[0] * wz + q[1] * wy - q[2] * wx
  ].map((component) => component * 0.5);
  const next = q.map((component, index) => component + derivative[index] * dt);
  const norm = Math.hypot(...next);
  return next.map((component) => component / norm);
}

function normalizedShape(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) throw new TypeError('shape must have one to three dimensions');
  return value.map((entry) => {
    const size = Number(entry);
    if (!Number.isSafeInteger(size) || size < 2) throw new RangeError('shape dimensions must be integers of at least 2');
    return size;
  });
}

function normalizedSpacing(value, dimensions) {
  const spacing = Array.isArray(value) ? value.map(Number) : Array(dimensions).fill(Number(value ?? 1));
  if (spacing.length !== dimensions) throw new RangeError('spacing must match shape dimensions');
  spacing.forEach((entry) => finitePositive(entry, 'spacing'));
  return spacing;
}

function fieldValues(value, count, fallback, name) {
  if (value == null) return Array(count).fill(fallback);
  if (typeof value === 'number') return Array(count).fill(value);
  return numericArray(value, name, count);
}

function fieldVectors(value, cells) {
  if (value == null) return Array(cells * 3).fill(0);
  if (Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)) {
    return Array.from({ length: cells }, () => value).flat();
  }
  return numericArray(value, 'current', cells * 3);
}

function fieldValue(value, index, fallback) {
  if (value == null) return fallback;
  return typeof value === 'number' ? value : Number(value[index] ?? fallback);
}

function numericArray(value, name, length) {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) throw new TypeError(`${name} must be an array`);
  const result = Array.from(value, Number);
  if (length != null && result.length !== length) throw new RangeError(`${name} must contain ${length} values`);
  if (!result.every(Number.isFinite)) throw new TypeError(`${name} must contain finite values`);
  return result;
}

function vector(value, dimensions) {
  return value == null ? Array(dimensions).fill(0) : numericArray(value, 'vector', dimensions);
}

function add(left, right) {
  return left.map((value, index) => value + right[index]);
}

function scale(value, scalar) {
  return value.map((component) => component * scalar);
}

function cellCount(shape) {
  return shape.reduce((product, value) => product * value, 1);
}

function coordinatesOf(index, shape) {
  const coordinates = [];
  let remaining = index;
  for (const size of shape) {
    coordinates.push(remaining % size);
    remaining = Math.floor(remaining / size);
  }
  return coordinates;
}

function indexOf(coordinates, shape) {
  let index = 0;
  let stride = 1;
  for (let axis = 0; axis < shape.length; axis += 1) {
    index += coordinates[axis] * stride;
    stride *= shape[axis];
  }
  return index;
}

function offsetCoordinate(coordinates, axis, amount) {
  const next = [...coordinates];
  next[axis] += amount;
  return next;
}

function validIndex(value, length) {
  const index = Number(value);
  if (!Number.isSafeInteger(index) || index < 0 || index >= length) throw new RangeError(`node index ${value} is out of range`);
  return index;
}

function finitePositive(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new RangeError(`${name} must be positive`);
  return number;
}

function finiteNonNegative(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${name} must be non-negative`);
  return number;
}

function unitInterval(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new RangeError(`${name} must be between 0 and 1`);
  return number;
}
