const fieldState = new WeakMap();
const MAX_CELL_BUDGET = 65536;

function requireVector3(value, name) {
  const vector = Array.isArray(value) || ArrayBuffer.isView(value);
  if (!vector || value.length !== 3) {
    throw new TypeError(`${name} must contain three numbers`);
  }
  const result = Array.from(value);
  if (!result.every(Number.isFinite)) {
    throw new RangeError(`${name} must contain finite numbers`);
  }
  return result;
}

function dot(left, right) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function normalize(value, name) {
  const length = Math.hypot(...value);
  if (!(length > 1e-12)) throw new RangeError(`${name} must be non-zero`);
  return value.map((component) => component / length);
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function requirePositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function requireCellSize(cellSize) {
  if (!Array.isArray(cellSize) || cellSize.length !== 2) {
    throw new TypeError('road cellSize must contain longitudinal and lateral sizes');
  }
  if (!cellSize.every((value) => Number.isFinite(value) && value > 0)) {
    throw new RangeError('road cellSize values must be finite and positive');
  }
}

function requireLayers(layerThicknesses) {
  if (!Array.isArray(layerThicknesses) || layerThicknesses.length === 0) {
    throw new TypeError('road layerThicknesses must be a non-empty array');
  }
  if (layerThicknesses.length > 65536) {
    throw new RangeError('road layer count exceeds Uint16 capacity');
  }
  if (!layerThicknesses.every((value) => Number.isFinite(value) && value > 0)) {
    throw new RangeError('road layer thicknesses must be finite and positive');
  }
}

function requireBudget(cellBudget) {
  if (
    !Number.isSafeInteger(cellBudget)
    || cellBudget < 0
    || cellBudget > MAX_CELL_BUDGET
  ) {
    throw new RangeError(`road cellBudget must be an integer from 0 to ${MAX_CELL_BUDGET}`);
  }
}

function requireCell(cell, state) {
  if (!Array.isArray(cell) || cell.length !== 3 || !cell.every(Number.isSafeInteger)) {
    throw new TypeError('road cell demand must contain three integer indices');
  }
  if (
    cell[0] < 0 || cell[0] >= state.longitudinalCells
    || cell[1] < 0 || cell[1] >= state.lateralCells
    || cell[2] < 0 || cell[2] >= state.layerThicknesses.length
  ) {
    throw new RangeError('road cell demand is outside the field');
  }
}

export function createRoadCoordinateFieldReference({
  origin,
  forward,
  up,
  cellSize,
  longitudinalCells,
  lateralCells,
  layerThicknesses,
}) {
  const fieldOrigin = requireVector3(origin, 'road origin');
  const roadForward = normalize(requireVector3(forward, 'road forward'), 'road forward');
  const requestedUp = requireVector3(up, 'road up');
  const alongForward = dot(requestedUp, roadForward);
  const roadUp = normalize(
    requestedUp.map((value, axis) => value - roadForward[axis] * alongForward),
    'road up',
  );
  const lateral = normalize(cross(roadUp, roadForward), 'road lateral frame');
  requireCellSize(cellSize);
  requirePositiveInteger(longitudinalCells, 'road longitudinalCells');
  requirePositiveInteger(lateralCells, 'road lateralCells');
  requireLayers(layerThicknesses);
  const potentialCellCount = longitudinalCells * lateralCells * layerThicknesses.length;
  if (!Number.isSafeInteger(potentialCellCount)) {
    throw new RangeError('road potential cell count exceeds safe integer capacity');
  }
  const depthCenters = [];
  let depth = 0;
  for (const thickness of layerThicknesses) {
    depthCenters.push(-(depth + thickness * 0.5));
    depth += thickness;
  }
  const field = Object.freeze({ kind: 'road-coordinate-field:v1' });
  fieldState.set(field, Object.freeze({
    origin: Object.freeze(fieldOrigin),
    forward: Object.freeze(roadForward),
    up: Object.freeze(roadUp),
    lateral: Object.freeze(lateral),
    cellSize: Object.freeze([...cellSize]),
    longitudinalCells,
    lateralCells,
    layerThicknesses: Object.freeze([...layerThicknesses]),
    depthCenters: Object.freeze(depthCenters),
    potentialCellCount,
  }));
  return field;
}

export function realizeRoadCoordinateCellsReference(field, { cells, cellBudget }) {
  const state = fieldState.get(field);
  if (!state) throw new TypeError('road coordinate field is required');
  if (!Array.isArray(cells)) throw new TypeError('road cells must be an array');
  requireBudget(cellBudget);
  cells.forEach((cell) => requireCell(cell, state));
  const selected = cells.slice(0, cellBudget);
  const cellCount = selected.length;
  const coordinates = new Float32Array(cellCount * 3);
  const positions = new Float32Array(cellCount * 3);
  const layerIndices = new Uint16Array(cellCount);

  selected.forEach(([longitudinalIndex, lateralIndex, layerIndex], index) => {
    const longitudinal = (longitudinalIndex + 0.5) * state.cellSize[0];
    const lateral = (
      lateralIndex + 0.5 - state.lateralCells * 0.5
    ) * state.cellSize[1];
    const depth = state.depthCenters[layerIndex];
    const offset = index * 3;
    coordinates.set([longitudinal, lateral, depth], offset);
    for (let axis = 0; axis < 3; axis += 1) {
      positions[offset + axis] = state.origin[axis]
        + state.forward[axis] * longitudinal
        + state.lateral[axis] * lateral
        + state.up[axis] * depth;
    }
    layerIndices[index] = layerIndex;
  });

  const sharedCoordinates = Object.freeze({
    coordinates,
    positions,
    layerIndices,
  });
  return Object.freeze({
    kind: 'road-coordinate-working-set:v1',
    cellCount,
    potentialCellCount: state.potentialCellCount,
    geometry: sharedCoordinates,
    material: sharedCoordinates,
    vectorBytes: coordinates.byteLength + positions.byteLength + layerIndices.byteLength,
    budget: cellBudget,
    truncated: cellCount < cells.length,
  });
}
