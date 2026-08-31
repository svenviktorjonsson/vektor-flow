import {
  conditionChild,
  sampleBoundedUniform,
} from './vf-conditioned-distribution.mjs';
import {
  sampleSpatialCorrelation2Reference,
} from './vf-spatial-correlation.mjs';

const U32_RANGE = 0x100000000;

function sampleUnit(node, slot, lane) {
  return sampleBoundedUniform(node, [slot, lane], { min: 0, max: 1 });
}

function unitWordHex(unit) {
  return Math.trunc(unit * U32_RANGE).toString(16).padStart(8, '0');
}

export function sampleMarkedPointCell2Reference(
  node,
  cell,
  {
    cellSize,
    maxCandidates,
    baseProbability,
    correlationLength,
    spatialStrength,
  },
) {
  const densityNode = conditionChild(node, {
    segment: 'density-field',
    channel: 'marked-point-density',
  });
  const cellNode = conditionChild(node, {
    segment: `cell:${cell[0]}:${cell[1]}`,
    channel: 'marked-point-candidates',
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
