export const STEFAN_BOLTZMANN = 5.670374419e-8;

export const MAXWELL_BOUNDARIES = Object.freeze({
  PERIODIC: 'periodic',
  PEC: 'pec'
});

export const BUILTIN_PHYSICS_MODULES = Object.freeze({
  inertia: Object.freeze({ id: 'inertia', requiresTime: true, symbols: Object.freeze(['p', 'L', 'F', 'tau']) }),
  rigidCollisions: Object.freeze({
    id: 'rigidCollisions',
    requiresTime: true,
    dependsOn: Object.freeze(['inertia']),
    symbols: Object.freeze(['e_n', 'e_t', 'mu_s', 'mu_d', 'mu_r', 'restitution', 'friction'])
  }),
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

/** Advance a planar double pendulum with an RK4 integration step.
 * Angles are measured from the downward vertical, in radians.
 */
export function stepDoublePendulum(state, dt) {
  const step = finiteNonNegative(dt, 'dt');
  const length1 = finitePositive(state.length1 ?? 1, 'length1');
  const length2 = finitePositive(state.length2 ?? 1, 'length2');
  const mass1 = finitePositive(state.mass1 ?? 1, 'mass1');
  const mass2 = finitePositive(state.mass2 ?? 1, 'mass2');
  const gravity = finiteNonNegative(state.gravity ?? 9.82, 'gravity');
  const initial = [
    finiteNumber(state.theta1, 'theta1'),
    finiteNumber(state.omega1 ?? 0, 'omega1'),
    finiteNumber(state.theta2, 'theta2'),
    finiteNumber(state.omega2 ?? 0, 'omega2')
  ];
  const derivative = ([theta1, omega1, theta2, omega2]) => {
    const delta = theta1 - theta2;
    const denominator = 2 * mass1 + mass2 - mass2 * Math.cos(2 * delta);
    const alpha1 = (
      -gravity * (2 * mass1 + mass2) * Math.sin(theta1)
      - mass2 * gravity * Math.sin(theta1 - 2 * theta2)
      - 2 * Math.sin(delta) * mass2 * (
        omega2 * omega2 * length2 + omega1 * omega1 * length1 * Math.cos(delta)
      )
    ) / (length1 * denominator);
    const alpha2 = 2 * Math.sin(delta) * (
      omega1 * omega1 * length1 * (mass1 + mass2)
      + gravity * (mass1 + mass2) * Math.cos(theta1)
      + omega2 * omega2 * length2 * mass2 * Math.cos(delta)
    ) / (length2 * denominator);
    return [omega1, alpha1, omega2, alpha2];
  };
  const offset = (values, slope, amount) => values.map((value, index) => value + slope[index] * amount);
  const k1 = derivative(initial);
  const k2 = derivative(offset(initial, k1, step * 0.5));
  const k3 = derivative(offset(initial, k2, step * 0.5));
  const k4 = derivative(offset(initial, k3, step));
  const [theta1, omega1, theta2, omega2] = initial.map((value, index) => value + step * (
    k1[index] + 2 * k2[index] + 2 * k3[index] + k4[index]
  ) / 6);
  const delta = theta1 - theta2;
  const kinetic = 0.5 * mass1 * length1 ** 2 * omega1 ** 2
    + 0.5 * mass2 * (length1 ** 2 * omega1 ** 2 + length2 ** 2 * omega2 ** 2
      + 2 * length1 * length2 * omega1 * omega2 * Math.cos(delta));
  const potential = -(mass1 + mass2) * gravity * length1 * Math.cos(theta1)
    - mass2 * gravity * length2 * Math.cos(theta2);
  return { ...state, theta1, theta2, omega1, omega2, length1, length2, mass1, mass2, gravity, energy: kinetic + potential };
}

/**
 * Advance convex rigid polygons inside a fixed, axis-aligned world rectangle.
 * The rectangle is centred on the origin. Bodies retain authored fields while
 * position, velocity, angle, and angularVelocity are replaced by stepped values.
 */
export function stepRigidPolygonWorld2D(world, dt) {
  const step = finiteNonNegative(dt, 'dt');
  const width = finitePositive(world.width ?? 2, 'world width');
  const height = finitePositive(world.height ?? 2, 'world height');
  const gravity = vector2(world.gravity ?? [0, -9.82], 'gravity');
  const iterations = Math.max(1, Math.trunc(Number(world.solverIterations ?? world.solver_iterations ?? 6)));
  const maxStep = finitePositive(world.maxStep ?? world.step_dt ?? 1 / 120, 'maxStep');
  const sleepLinearThreshold = finiteNonNegative(
    world.sleepLinearThreshold ?? world.sleep_linear_threshold ?? 0.1,
    'sleep linear threshold'
  );
  const sleepAngularThreshold = finiteNonNegative(
    world.sleepAngularThreshold ?? world.sleep_angular_threshold ?? 0.3,
    'sleep angular threshold'
  );
  const sleepDelay = finiteNonNegative(world.sleepDelay ?? world.sleep_delay ?? 0.5, 'sleep delay');
  const sleepContactGrace = finiteNonNegative(
    world.sleepContactGrace ?? world.sleep_contact_grace ?? 0.05,
    'sleep contact grace'
  );
  const substeps = Math.max(1, Math.ceil(step / maxStep));
  const h = substeps ? step / substeps : 0;
  const bodies = (world.bodies || []).map(normalizeRigidPolygonBody);
  for (let substep = 0; substep < substeps; substep += 1) {
    for (const body of bodies) {
      body.hadContact = false;
      if (body.inverseMass === 0 || body.sleeping) continue;
      body.velocity[0] += gravity[0] * h;
      body.velocity[1] += gravity[1] * h;
      body.position[0] += body.velocity[0] * h;
      body.position[1] += body.velocity[1] * h;
      body.angle += body.angularVelocity * h;
    }
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      for (const body of bodies) resolveRigidBoundary(body, width, height);
      for (let a = 0; a < bodies.length; a += 1) {
        for (let b = a + 1; b < bodies.length; b += 1) resolveRigidPair(bodies[a], bodies[b]);
      }
    }
    for (const body of bodies) {
      if (body.inverseMass === 0 || body.sleeping) continue;
      const belowThreshold = Math.hypot(...body.velocity) <= sleepLinearThreshold
        && Math.abs(body.angularVelocity) <= sleepAngularThreshold;
      body.contactMemory = body.hadContact
        ? sleepContactGrace
        : Math.max(0, body.contactMemory - h);
      body.sleepTimer = body.contactMemory > 0 && belowThreshold ? body.sleepTimer + h : 0;
      if (sleepDelay > 0 && body.sleepTimer >= sleepDelay) {
        body.velocity = [0, 0];
        body.angularVelocity = 0;
        body.sleeping = true;
      }
    }
  }
  return {
    ...world,
    width,
    height,
    gravity,
    bodies: bodies.map(({ authored, position, velocity, angle, angularVelocity, sleeping, sleepTimer, contactMemory }) => ({
      ...authored,
      position: [...position],
      velocity: [...velocity],
      angle,
      angularVelocity,
      sleeping,
      sleep_time: sleepTimer,
      sleep_contact_time: contactMemory
    }))
  };
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

function normalizeRigidPolygonBody(body, index) {
  const vertices = body.localVertices ?? body.local_vertices ?? body.contours?.[0];
  if (!Array.isArray(vertices) || vertices.length < 3) {
    throw new TypeError(`rigid body ${body.id ?? index} requires at least three localVertices`);
  }
  const localVertices = vertices.map((point) => vector2(point, 'local vertex'));
  let signedArea2 = 0;
  let inertiaFactor = 0;
  for (let i = 0; i < localVertices.length; i += 1) {
    const a = localVertices[i];
    const b = localVertices[(i + 1) % localVertices.length];
    const cross = cross2(a, b);
    signedArea2 += cross;
    inertiaFactor += cross * (dot2(a, a) + dot2(a, b) + dot2(b, b));
  }
  const area = Math.abs(signedArea2) / 2;
  if (!(area > 1e-12)) throw new RangeError(`rigid body ${body.id ?? index} has zero area`);
  const fixed = body.fixed === true || body.static === true || body.mass === Number.POSITIVE_INFINITY;
  const mass = fixed ? Number.POSITIVE_INFINITY : finitePositive(body.mass ?? finitePositive(body.density ?? 1, 'body density') * area, 'body mass');
  const inertia = fixed ? Number.POSITIVE_INFINITY : Math.max(1e-12, mass * Math.abs(inertiaFactor) / (6 * Math.abs(signedArea2)));
  const muS = finiteNonNegative(body.mu_s ?? body.static_friction ?? body.friction ?? 0.65, 'body mu_s');
  const muD = finiteNonNegative(body.mu_d ?? body.dynamic_friction ?? body.friction ?? Math.min(muS, 0.45), 'body mu_d');
  if (muD > muS) throw new RangeError(`rigid body ${body.id ?? index} requires mu_d <= mu_s`);
  const contactRadius = finitePositive(
    body.contact_radius ?? Math.max(...localVertices.map((point) => Math.hypot(...point))),
    'body contact_radius'
  );
  return {
    authored: { ...body, localVertices: localVertices.map((point) => [...point]) },
    localVertices,
    position: vector2(body.position ?? [0, 0], 'body position'),
    velocity: vector2(body.velocity ?? [0, 0], 'body velocity'),
    angle: finiteNumber(body.angle ?? 0, 'body angle'),
    angularVelocity: finiteNumber(body.angularVelocity ?? body.angular_velocity ?? 0, 'body angularVelocity'),
    inverseMass: fixed ? 0 : 1 / mass,
    inverseInertia: fixed ? 0 : 1 / inertia,
    material: {
      eN: unitInterval(body.e_n ?? body.normal_restitution ?? body.restitution ?? 0.35, 'body e_n'),
      eT: unitInterval(body.e_t ?? body.tangential_restitution ?? 0, 'body e_t'),
      muS,
      muD,
      muR: finiteNonNegative(body.mu_r ?? body.rolling_friction ?? 0, 'body mu_r'),
      contactRadius,
      restitutionThreshold: finiteNonNegative(
        body.restitution_threshold ?? 0.5,
        'body restitution_threshold'
      )
    },
    sleeping: body.sleeping === true,
    sleepTimer: finiteNonNegative(body.sleep_time ?? 0, 'body sleep_time'),
    contactMemory: finiteNonNegative(body.sleep_contact_time ?? 0, 'body sleep_contact_time'),
    hadContact: false
  };
}

function mixRigidContactMaterial(a, b = null) {
  if (!b) return a.material;
  return {
    eN: Math.max(a.material.eN, b.material.eN),
    eT: Math.max(a.material.eT, b.material.eT),
    muS: Math.sqrt(a.material.muS * b.material.muS),
    muD: Math.sqrt(a.material.muD * b.material.muD),
    muR: Math.sqrt(a.material.muR * b.material.muR),
    contactRadius: Math.min(a.material.contactRadius, b.material.contactRadius),
    restitutionThreshold: Math.max(a.material.restitutionThreshold, b.material.restitutionThreshold)
  };
}

function rigidWorldVertices(body) {
  const cosine = Math.cos(body.angle);
  const sine = Math.sin(body.angle);
  return body.localVertices.map(([x, y]) => [
    body.position[0] + cosine * x - sine * y,
    body.position[1] + sine * x + cosine * y
  ]);
}

function resolveRigidBoundary(body, width, height) {
  if (body.inverseMass === 0) return;
  const vertices = rigidWorldVertices(body);
  const limits = [
    { penetration: -width / 2 - Math.min(...vertices.map((v) => v[0])), normal: [1, 0], pick: (a, b) => a[0] < b[0] },
    { penetration: Math.max(...vertices.map((v) => v[0])) - width / 2, normal: [-1, 0], pick: (a, b) => a[0] > b[0] },
    { penetration: -height / 2 - Math.min(...vertices.map((v) => v[1])), normal: [0, 1], pick: (a, b) => a[1] < b[1] },
    { penetration: Math.max(...vertices.map((v) => v[1])) - height / 2, normal: [0, -1], pick: (a, b) => a[1] > b[1] }
  ];
  for (const wall of limits) {
    if (!(wall.penetration > 0)) continue;
    body.hadContact = true;
    body.position[0] += wall.normal[0] * wall.penetration;
    body.position[1] += wall.normal[1] * wall.penetration;
    const correctedVertices = rigidWorldVertices(body);
    const extreme = correctedVertices.reduce((chosen, vertex) => wall.pick(vertex, chosen) ? vertex : chosen, correctedVertices[0]);
    const contacts = correctedVertices.filter((vertex) => Math.abs(dot2(subtract2(vertex, extreme), wall.normal)) < 1e-9);
    const contact = scale2(contacts.reduce(add2, [0, 0]), 1 / contacts.length);
    const r = subtract2(contact, body.position);
    const velocity = velocityAtRigidPoint(body, r);
    const normalSpeed = dot2(velocity, wall.normal);
    if (normalSpeed >= 0) continue;
    const rn = cross2(r, wall.normal);
    const material = mixRigidContactMaterial(body);
    const isImpact = -normalSpeed > material.restitutionThreshold;
    const restitution = isImpact ? material.eN : 0;
    const normalImpulse = -(1 + restitution) * normalSpeed
      / (body.inverseMass + rn * rn * body.inverseInertia);
    applyRigidImpulse(body, scale2(wall.normal, normalImpulse), r);
    applyRigidContactFriction(null, body, [0, 0], r, wall.normal, normalImpulse, material, isImpact);
  }
}

function resolveRigidPair(a, b) {
  if (a.inverseMass + b.inverseMass === 0) return;
  const verticesA = rigidWorldVertices(a);
  const verticesB = rigidWorldVertices(b);
  let overlap = Number.POSITIVE_INFINITY;
  let normal = null;
  for (const vertices of [verticesA, verticesB]) {
    for (let index = 0; index < vertices.length; index += 1) {
      const edge = subtract2(vertices[(index + 1) % vertices.length], vertices[index]);
      const length = Math.hypot(edge[0], edge[1]);
      if (!(length > 1e-12)) continue;
      const axis = [-edge[1] / length, edge[0] / length];
      const projectionA = projectRigidVertices(verticesA, axis);
      const projectionB = projectRigidVertices(verticesB, axis);
      const axisOverlap = Math.min(projectionA.max, projectionB.max) - Math.max(projectionA.min, projectionB.min);
      if (!(axisOverlap > 0)) return;
      if (axisOverlap < overlap) {
        overlap = axisOverlap;
        normal = axis;
      }
    }
  }
  if (!normal) return;
  a.hadContact = true;
  b.hadContact = true;
  if (dot2(subtract2(b.position, a.position), normal) < 0) normal = scale2(normal, -1);
  const inverseMass = a.inverseMass + b.inverseMass;
  const correction = overlap / inverseMass;
  a.position[0] -= normal[0] * correction * a.inverseMass;
  a.position[1] -= normal[1] * correction * a.inverseMass;
  b.position[0] += normal[0] * correction * b.inverseMass;
  b.position[1] += normal[1] * correction * b.inverseMass;

  const contact = rigidPolygonContactPoint(rigidWorldVertices(a), rigidWorldVertices(b));
  const rA = subtract2(contact, a.position);
  const rB = subtract2(contact, b.position);
  const relativeVelocity = subtract2(velocityAtRigidPoint(b, rB), velocityAtRigidPoint(a, rA));
  const normalSpeed = dot2(relativeVelocity, normal);
  if (normalSpeed >= 0) return;
  const raNormal = cross2(rA, normal);
  const rbNormal = cross2(rB, normal);
  const denominator = inverseMass + raNormal ** 2 * a.inverseInertia + rbNormal ** 2 * b.inverseInertia;
  const material = mixRigidContactMaterial(a, b);
  const isImpact = -normalSpeed > material.restitutionThreshold;
  const restitution = isImpact ? material.eN : 0;
  const normalImpulse = -(1 + restitution) * normalSpeed / denominator;
  const impulse = scale2(normal, normalImpulse);
  applyRigidImpulse(a, scale2(impulse, -1), rA);
  applyRigidImpulse(b, impulse, rB);
  applyRigidContactFriction(a, b, rA, rB, normal, normalImpulse, material, isImpact);
}

function applyRigidContactFriction(a, b, rA, rB, normal, normalImpulse, material, isImpact) {
  if (!(normalImpulse > 0) || (!(material.muS > 0) && !(material.muR > 0))) return;
  const tangent = [-normal[1], normal[0]];
  const inverseMassA = a?.inverseMass ?? 0;
  const inverseMassB = b?.inverseMass ?? 0;
  const inverseInertiaA = a?.inverseInertia ?? 0;
  const inverseInertiaB = b?.inverseInertia ?? 0;
  const rtA = cross2(rA, tangent);
  const rtB = cross2(rB, tangent);
  const kTT = inverseMassA + inverseMassB
    + rtA ** 2 * inverseInertiaA + rtB ** 2 * inverseInertiaB;
  const kTL = rtA * inverseInertiaA + rtB * inverseInertiaB;
  const kLL = inverseInertiaA + inverseInertiaB;
  if (!(kTT > 1e-12)) return;

  const velocityA = a ? velocityAtRigidPoint(a, rA) : [0, 0];
  const velocityB = b ? velocityAtRigidPoint(b, rB) : [0, 0];
  const relativeVelocity = subtract2(velocityB, velocityA);
  const tangentSpeed = dot2(relativeVelocity, tangent);
  const relativeOmega = (b?.angularVelocity ?? 0) - (a?.angularVelocity ?? 0);
  const targetTangentSpeed = isImpact ? -material.eT * tangentSpeed : 0;
  const rhsT = targetTangentSpeed - tangentSpeed;
  const staticLimit = material.muS * normalImpulse;
  const rollingLimit = material.muR * material.contactRadius * normalImpulse;
  const determinant = kTT * kLL - kTL * kTL;
  let rollingCandidate = 0;
  if (determinant > 1e-12) {
    rollingCandidate = (kTT * -relativeOmega - kTL * rhsT) / determinant;
  }
  let angularImpulse = Math.max(-rollingLimit, Math.min(rollingLimit, rollingCandidate));
  const staticCandidate = (rhsT - kTL * angularImpulse) / kTT;
  let tangentImpulse = 0;
  if (Math.abs(staticCandidate) <= staticLimit + 1e-12) {
    tangentImpulse = staticCandidate;
  } else {
    tangentImpulse = tangentSpeed === 0 ? 0 : -Math.sign(tangentSpeed) * material.muD * normalImpulse;
    const omegaAfterSliding = relativeOmega + kTL * tangentImpulse;
    const stopRollingImpulse = kLL > 1e-12 ? Math.abs(omegaAfterSliding) / kLL : 0;
    angularImpulse = omegaAfterSliding === 0
      ? 0
      : -Math.sign(omegaAfterSliding) * Math.min(rollingLimit, stopRollingImpulse);
  }
  const impulse = scale2(tangent, tangentImpulse);
  if (a) applyRigidGeneralizedImpulse(a, scale2(impulse, -1), rA, -angularImpulse);
  if (b) applyRigidGeneralizedImpulse(b, impulse, rB, angularImpulse);
}

function applyRigidImpulse(body, impulse, radius) {
  if (body.inverseMass === 0) return;
  if (body.sleeping && Math.hypot(...impulse) > 1e-12) {
    body.sleeping = false;
    body.sleepTimer = 0;
  }
  body.velocity[0] += impulse[0] * body.inverseMass;
  body.velocity[1] += impulse[1] * body.inverseMass;
  body.angularVelocity += cross2(radius, impulse) * body.inverseInertia;
}

function applyRigidGeneralizedImpulse(body, impulse, radius, angularImpulse) {
  if (body.sleeping && Math.abs(angularImpulse) > 1e-12) {
    body.sleeping = false;
    body.sleepTimer = 0;
  }
  applyRigidImpulse(body, impulse, radius);
  body.angularVelocity += angularImpulse * body.inverseInertia;
}

function velocityAtRigidPoint(body, radius) {
  return [
    body.velocity[0] - body.angularVelocity * radius[1],
    body.velocity[1] + body.angularVelocity * radius[0]
  ];
}

function projectRigidVertices(vertices, axis) {
  const values = vertices.map((vertex) => dot2(vertex, axis));
  return { min: Math.min(...values), max: Math.max(...values) };
}

function rigidPolygonContactPoint(verticesA, verticesB) {
  let minimumDistanceSquared = Number.POSITIVE_INFINITY;
  let candidates = [];
  const consider = (point, from, to) => {
    const closest = closestPointOnSegment2(point, from, to);
    const dx = point[0] - closest[0];
    const dy = point[1] - closest[1];
    const distanceSquared = dx * dx + dy * dy;
    const candidate = [(point[0] + closest[0]) / 2, (point[1] + closest[1]) / 2];
    const tolerance = Number.isFinite(minimumDistanceSquared)
      ? 1e-16 * Math.max(1, minimumDistanceSquared)
      : 0;
    if (!Number.isFinite(minimumDistanceSquared) || distanceSquared < minimumDistanceSquared - tolerance) {
      minimumDistanceSquared = distanceSquared;
      candidates = [candidate];
    } else if (Math.abs(distanceSquared - minimumDistanceSquared) <= tolerance) {
      candidates.push(candidate);
    }
  };
  const compare = (points, edges) => {
    for (const point of points) {
      for (let index = 0; index < edges.length; index += 1) {
        consider(point, edges[index], edges[(index + 1) % edges.length]);
      }
    }
  };
  compare(verticesA, verticesB);
  compare(verticesB, verticesA);
  return candidates.length
    ? scale2(candidates.reduce(add2, [0, 0]), 1 / candidates.length)
    : scale2(add2(verticesA[0], verticesB[0]), 0.5);
}

function closestPointOnSegment2(point, from, to) {
  const segment = subtract2(to, from);
  const lengthSquared = dot2(segment, segment);
  if (!(lengthSquared > 1e-24)) return [...from];
  const offset = subtract2(point, from);
  const parameter = Math.max(0, Math.min(1, dot2(offset, segment) / lengthSquared));
  return add2(from, scale2(segment, parameter));
}

function vector2(value, name) {
  const result = numericArray(value, name, 2);
  return [result[0], result[1]];
}

function add2(a, b) { return [a[0] + b[0], a[1] + b[1]]; }
function subtract2(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
function scale2(value, scalar) { return [value[0] * scalar, value[1] * scalar]; }
function dot2(a, b) { return a[0] * b[0] + a[1] * b[1]; }
function cross2(a, b) { return a[0] * b[1] - a[1] * b[0]; }

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

function finiteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${name} must be finite`);
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
