import {
  conditionChild,
  sampleBoundedUniform,
} from './vf-conditioned-distribution.mjs';
import {
  sampleSpatialCorrelation2Reference,
} from './vf-spatial-correlation.mjs';

const U32_RANGE = 0x100000000;
const MAX_CANDIDATES_PER_CELL = 1_024;
const MAX_REGION_CELLS = 4_096;
const MAX_REGION_CANDIDATE_SLOTS = 65_536;

function requireCell2(cell) {
  const isTypedArray = ArrayBuffer.isView(cell) && !(cell instanceof DataView);
  if ((!Array.isArray(cell) && !isTypedArray) || cell.length !== 2) {
    throw new TypeError('marked-point cell must contain exactly two integers');
  }
  for (let index = 0; index < 2; index += 1) {
    if (!Number.isInteger(cell[index])) {
      throw new TypeError(`marked-point cell[${index}] must be an integer`);
    }
    if (cell[index] < -0x80000000 || cell[index] > 0x7fffffff) {
      throw new RangeError(`marked-point cell[${index}] must fit signed 32-bit`);
    }
  }
}

function requireFiniteScalar(value, name, { min = -Infinity, max = Infinity } = {}) {
  if (typeof value !== 'number') {
    throw new TypeError(`${name} must be a number`);
  }
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} must be finite and in [${min}, ${max}]`);
  }
}

function requireFiniteVector2(value, name) {
  const isTypedArray = ArrayBuffer.isView(value) && !(value instanceof DataView);
  if ((!Array.isArray(value) && !isTypedArray) || value.length !== 2) {
    throw new TypeError(`${name} must contain exactly two numbers`);
  }
  for (let index = 0; index < 2; index += 1) {
    if (typeof value[index] !== 'number') {
      throw new TypeError(`${name}[${index}] must be a number`);
    }
    if (!Number.isFinite(value[index])) {
      throw new RangeError(`${name}[${index}] must be finite`);
    }
  }
}

function requireOptions(options) {
  if (!options || typeof options !== 'object') {
    throw new TypeError('marked-point options are required');
  }
  requireFiniteScalar(options.cellSize, 'marked-point cell size', {
    min: Number.MIN_VALUE,
  });
  if (!Number.isInteger(options.maxCandidates)) {
    throw new TypeError('marked-point maximum candidates must be an integer');
  }
  if (options.maxCandidates < 0 || options.maxCandidates > MAX_CANDIDATES_PER_CELL) {
    throw new RangeError(
      `marked-point maximum candidates must be in [0, ${MAX_CANDIDATES_PER_CELL}]`,
    );
  }
  requireFiniteScalar(
    options.baseProbability,
    'marked-point base probability',
    { min: 0, max: 1 },
  );
  requireFiniteScalar(
    options.correlationLength,
    'marked-point correlation length',
    { min: Number.MIN_VALUE },
  );
  requireFiniteScalar(
    options.spatialStrength,
    'marked-point spatial strength',
    { min: 0, max: 1 },
  );
}

function sampleUnit(node, slot, lane) {
  return sampleBoundedUniform(node, [slot, lane], { min: 0, max: 1 });
}

function unitWordHex(unit) {
  return Math.trunc(unit * U32_RANGE).toString(16).padStart(8, '0');
}

export function sampleMarkedPointCell2Reference(
  node,
  cell,
  options,
) {
  requireCell2(cell);
  requireOptions(options);
  const {
    cellSize,
    maxCandidates,
    baseProbability,
    correlationLength,
    spatialStrength,
  } = options;
  const cellNode = conditionChild(node, {
    segment: `cell:${cell[0]}:${cell[1]}`,
    channel: 'marked-point-candidates',
  });
  if (maxCandidates === 0) {
    return Object.freeze([]);
  }
  const densityNode = conditionChild(node, {
    segment: 'density-field',
    channel: 'marked-point-density',
  });
  const frozenCell = Object.freeze([...cell]);
  const center = [(cell[0] + 0.5) * cellSize, (cell[1] + 0.5) * cellSize];
  const density = sampleSpatialCorrelation2Reference(densityNode, center, {
    correlationLength,
    mean: 0,
    amplitude: 1,
  });
  const probability = Math.min(
    1,
    Math.max(0, baseProbability * (1 + spatialStrength * density)),
  );
  const candidates = [];
  for (let slot = 0; slot < maxCandidates; slot += 1) {
    if (sampleUnit(cellNode, slot, 0) >= probability) {
      continue;
    }
    candidates.push(Object.freeze({
      id: `candidate:v1:${unitWordHex(sampleUnit(cellNode, slot, 3))}:${unitWordHex(sampleUnit(cellNode, slot, 4))}`,
      cell: frozenCell,
      slot,
      position: Object.freeze([
        (cell[0] + sampleUnit(cellNode, slot, 1)) * cellSize,
        (cell[1] + sampleUnit(cellNode, slot, 2)) * cellSize,
      ]),
      marks: Object.freeze({
        weight: sampleUnit(cellNode, slot, 5),
        angle: 2 * Math.PI * sampleUnit(cellNode, slot, 6),
      }),
    }));
  }
  return Object.freeze(candidates);
}

export function queryMarkedPointRegion2Reference(node, bounds, options) {
  if (!bounds || typeof bounds !== 'object') {
    throw new TypeError('marked-point bounds are required');
  }
  requireFiniteVector2(bounds.min, 'marked-point bounds min');
  requireFiniteVector2(bounds.max, 'marked-point bounds max');
  if (!(bounds.min[0] < bounds.max[0]) || !(bounds.min[1] < bounds.max[1])) {
    throw new RangeError('marked-point bounds require min < max on both axes');
  }
  requireOptions(options);
  const startX = Math.floor(bounds.min[0] / options.cellSize);
  const startY = Math.floor(bounds.min[1] / options.cellSize);
  const endX = Math.ceil(bounds.max[0] / options.cellSize) - 1;
  const endY = Math.ceil(bounds.max[1] / options.cellSize) - 1;
  if (
    startX < -0x80000000
    || startX > 0x7fffffff
    || startY < -0x80000000
    || startY > 0x7fffffff
    || endX < -0x80000000
    || endX > 0x7fffffff
    || endY < -0x80000000
    || endY > 0x7fffffff
  ) {
    throw new RangeError('marked-point region cells must fit signed 32-bit');
  }
  const cellCountX = endX - startX + 1;
  const cellCountY = endY - startY + 1;
  if (cellCountX > MAX_REGION_CELLS || cellCountY > MAX_REGION_CELLS) {
    throw new RangeError(`marked-point region exceeds ${MAX_REGION_CELLS} cells`);
  }
  const cellCount = cellCountX * cellCountY;
  if (cellCount > MAX_REGION_CELLS) {
    throw new RangeError(`marked-point region exceeds ${MAX_REGION_CELLS} cells`);
  }
  if (cellCount * options.maxCandidates > MAX_REGION_CANDIDATE_SLOTS) {
    throw new RangeError(
      `marked-point region exceeds ${MAX_REGION_CANDIDATE_SLOTS} candidate slots`,
    );
  }
  const candidates = [];
  for (let cellY = startY; cellY <= endY; cellY += 1) {
    for (let cellX = startX; cellX <= endX; cellX += 1) {
      for (const candidate of sampleMarkedPointCell2Reference(
        node,
        [cellX, cellY],
        options,
      )) {
        const [x, y] = candidate.position;
        if (
          x >= bounds.min[0]
          && x < bounds.max[0]
          && y >= bounds.min[1]
          && y < bounds.max[1]
        ) {
          candidates.push(candidate);
        }
      }
    }
  }
  return Object.freeze(candidates);
}
