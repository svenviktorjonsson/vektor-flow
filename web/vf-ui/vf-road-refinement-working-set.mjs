import {
  realizeRoadCoordinateCellsReference,
} from './vf-road-coordinate-field.mjs';

const workingSetState = new WeakMap();
const MAX_CELL_BUDGET = 65536;

function cellId([longitudinal, lateral, layer]) {
  return `road-cell:${longitudinal}:${lateral}:${layer}`;
}

function compareCells(left, right) {
  return left[0] - right[0]
    || left[1] - right[1]
    || left[2] - right[2];
}

function canonicalCells(demands) {
  const cellsById = new Map();
  for (const cell of demands) cellsById.set(cellId(cell), cell);
  return [...cellsById.values()].sort(compareCells);
}

function createPacket(field, cell) {
  const realization = realizeRoadCoordinateCellsReference(field, {
    cells: [cell],
    cellBudget: 1,
  });
  return Object.freeze({
    id: cellId(cell),
    cell: Object.freeze([...cell]),
    coordinates: realization.geometry.coordinates,
    positions: realization.geometry.positions,
    layerIndices: realization.geometry.layerIndices,
    vectorBytes: realization.vectorBytes,
  });
}

function requirePrevious(previous, field) {
  if (previous !== null && workingSetState.get(previous)?.field !== field) {
    throw new TypeError('road refinement working set is required');
  }
}

function requireBudget(cellBudget) {
  if (
    !Number.isSafeInteger(cellBudget)
    || cellBudget < 0
    || cellBudget > MAX_CELL_BUDGET
  ) {
    throw new RangeError(
      `road refinement cellBudget must be an integer from 0 to ${MAX_CELL_BUDGET}`,
    );
  }
}

export function updateRoadRefinementWorkingSetReference(
  field,
  previous,
  { demands, cellBudget },
) {
  requirePrevious(previous, field);
  requireBudget(cellBudget);
  const probe = realizeRoadCoordinateCellsReference(field, {
    cells: demands,
    cellBudget: 0,
  });
  const cells = canonicalCells(demands);
  const selected = cells.slice(0, cellBudget);
  const previousPackets = previous?.packets ?? [];
  const previousById = new Map(previousPackets.map((packet) => [packet.id, packet]));
  const selectedIds = new Set(selected.map(cellId));
  const retained = [];
  const created = [];
  const packets = selected.map((cell) => {
    const id = cellId(cell);
    const packet = previousById.get(id);
    if (packet) {
      retained.push(id);
      return packet;
    }
    created.push(id);
    return createPacket(field, cell);
  });
  const evicted = previousPackets
    .map(({ id }) => id)
    .filter((id) => !selectedIds.has(id));

  const workingSet = Object.freeze({
    kind: 'road-refinement-working-set:v1',
    packets: Object.freeze(packets),
    changes: Object.freeze({
      retained: Object.freeze(retained),
      created: Object.freeze(created),
      evicted: Object.freeze(evicted),
    }),
    potentialCellCount: probe.potentialCellCount,
    demandCount: cells.length,
    cellCount: packets.length,
    vectorBytes: packets.reduce((sum, packet) => sum + packet.vectorBytes, 0),
    budget: cellBudget,
    truncated: packets.length < cells.length,
  });
  workingSetState.set(workingSet, Object.freeze({ field }));
  return workingSet;
}
