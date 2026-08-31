import {
  conditionChild,
  conditionedNodeStreamReference,
  createConditionedRoot,
  sampleBoundedUniform,
} from './vf-conditioned-distribution.mjs';
import {
  sampleSpatialCorrelation2Reference,
} from './vf-spatial-correlation.mjs';

const fieldState = new WeakMap();
const MAX_OCTAVES = 6;
const MAX_DEMANDED_CELLS = 4096;
const MAX_CACHED_CELL_MATERIALS = MAX_DEMANDED_CELLS;
const MAX_BLADE_BUDGET = 65536;
const DRY_COLOR = Object.freeze([0.24, 0.31, 0.08]);
const LUSH_COLOR = Object.freeze([0.16, 0.48, 0.09]);
const GRASS_BLADE_TEMPLATE_VERTICES = new Float32Array([
  -1, 0, 0, 0, 0, 1, 1, 1, 1, 1,
  1, 0, 0, 0, 0, 1, 1, 1, 1, 1,
  0.28, 0, 1, 0, 0, 1, 1, 1, 1, 1,
  -0.28, 0, 1, 0, 0, 1, 1, 1, 1, 1,
]);
const GRASS_BLADE_TEMPLATE_INDICES = new Uint32Array([0, 1, 2, 0, 2, 3]);

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function requirePosition(position) {
  const typed = ArrayBuffer.isView(position) && !(position instanceof DataView);
  if ((!Array.isArray(position) && !typed) || position.length !== 2) {
    throw new TypeError('grass field position must contain exactly two numbers');
  }
  for (let axis = 0; axis < 2; axis += 1) {
    if (typeof position[axis] !== 'number') {
      throw new TypeError(`grass field position[${axis}] must be a number`);
    }
    if (!Number.isFinite(position[axis])) {
      throw new RangeError(`grass field position[${axis}] must be finite`);
    }
  }
}

function requireOptions({ detailLevel, footprint }) {
  if (!Number.isSafeInteger(detailLevel) || detailLevel < 0) {
    throw new RangeError('grass material detailLevel must be a non-negative safe integer');
  }
  if (typeof footprint !== 'number') {
    throw new TypeError('grass material footprint must be a number');
  }
  if (!Number.isFinite(footprint) || footprint < 0) {
    throw new RangeError('grass material footprint must be finite and non-negative');
  }
}

function filterWeight(wavelength, footprint) {
  if (footprint <= wavelength * 0.5) return 1;
  if (footprint >= wavelength) return 0;
  const ratio = (wavelength - footprint) / (wavelength * 0.5);
  return ratio * ratio * (3 - 2 * ratio);
}

function sampleDetail(node, position, detailLevel, footprint) {
  const octaveCount = Math.min(MAX_OCTAVES, detailLevel + 1);
  let weighted = 0;
  let totalWeight = 0;
  for (let octave = 0; octave < octaveCount; octave += 1) {
    const wavelength = 1.5 * (2 ** -octave);
    const weight = (0.52 ** octave) * filterWeight(wavelength, footprint);
    if (!(weight > 0)) continue;
    weighted += weight * sampleSpatialCorrelation2Reference(node, position, {
      correlationLength: wavelength,
      mean: 0,
      amplitude: 1,
    });
    totalWeight += weight;
  }
  return totalWeight > 0 ? weighted / totalWeight : 0;
}

export function createGrassMaterialFieldReference(identity) {
  const root = createConditionedRoot(identity);
  const field = Object.freeze({
    kind: 'grass-multiscale-field:v1',
    identity: root,
    maxOctaves: MAX_OCTAVES,
  });
  fieldState.set(field, {
    fieldNode: conditionChild(root, {
      segment: 'grass:field:v1',
      channel: 'field-variation',
    }),
    patchNode: conditionChild(root, {
      segment: 'grass:patch:v1',
      channel: 'patch-variation',
    }),
    detailNode: conditionChild(root, {
      segment: 'grass:blade-surface:v1',
      channel: 'blade-surface-variation',
    }),
    cellMaterialCache: new Map(),
  });
  return field;
}

export function sampleGrassMaterialReference(
  field,
  position,
  { detailLevel, footprint },
) {
  const state = fieldState.get(field);
  if (!state) {
    throw new TypeError('grass material field is required');
  }
  requirePosition(position);
  requireOptions({ detailLevel, footprint });
  const fieldVariation = sampleSpatialCorrelation2Reference(
    state.fieldNode,
    position,
    { correlationLength: 24, mean: 0, amplitude: 1 },
  );
  const patchVariation = sampleSpatialCorrelation2Reference(
    state.patchNode,
    position,
    { correlationLength: 3, mean: 0, amplitude: 1 },
  );
  const surfaceVariation = sampleDetail(
    state.detailNode,
    position,
    detailLevel,
    footprint,
  );
  const vigor = clamp(
    0.58 + 0.23 * fieldVariation + 0.14 * patchVariation,
    0,
    1,
  );
  const colorBlend = clamp(vigor + 0.08 * surfaceVariation, 0, 1);
  return Object.freeze({
    fieldVariation,
    patchVariation,
    surfaceVariation,
    coverage: clamp(0.68 + 0.22 * fieldVariation + 0.1 * patchVariation, 0, 1),
    bladeHeight: clamp(0.2 + 0.44 * vigor + 0.05 * surfaceVariation, 0.18, 0.72),
    roughness: clamp(0.94 - 0.16 * vigor + 0.03 * surfaceVariation, 0.72, 0.98),
    baseColor: Object.freeze([
      DRY_COLOR[0] + (LUSH_COLOR[0] - DRY_COLOR[0]) * colorBlend,
      DRY_COLOR[1] + (LUSH_COLOR[1] - DRY_COLOR[1]) * colorBlend,
      DRY_COLOR[2] + (LUSH_COLOR[2] - DRY_COLOR[2]) * colorBlend,
      1,
    ]),
  });
}

function realizeGrassCellMaterial(field, state, cellX, cellY) {
  const cacheKey = `${cellX}:${cellY}`;
  const cached = state.cellMaterialCache.get(cacheKey);
  if (cached) {
    state.cellMaterialCache.delete(cacheKey);
    state.cellMaterialCache.set(cacheKey, cached);
    return cached;
  }
  const cellNode = conditionChild(state.detailNode, {
    segment: `grass:cell:${cellX}:${cellY}`,
    channel: 'blade-traits',
  });
  const realized = Object.freeze({
    cellNode,
    stream: conditionedNodeStreamReference(cellNode),
    material: sampleGrassMaterialReference(
      field,
      [cellX + 0.5, cellY + 0.5],
      { detailLevel: 0, footprint: 0 },
    ),
  });
  state.cellMaterialCache.set(cacheKey, realized);
  if (state.cellMaterialCache.size > MAX_CACHED_CELL_MATERIALS) {
    const oldestKey = state.cellMaterialCache.keys().next().value;
    state.cellMaterialCache.delete(oldestKey);
  }
  return realized;
}

function requireDemandedCells(cells) {
  if (!Array.isArray(cells)) {
    throw new TypeError('grass demand cells must be an array');
  }
  if (cells.length > MAX_DEMANDED_CELLS) {
    throw new RangeError(`grass demand exceeds ${MAX_DEMANDED_CELLS} cells`);
  }
  const canonical = new Map();
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    const typed = ArrayBuffer.isView(cell) && !(cell instanceof DataView);
    if ((!Array.isArray(cell) && !typed) || cell.length !== 2) {
      throw new TypeError(`grass demand cell[${index}] must contain two integers`);
    }
    for (let axis = 0; axis < 2; axis += 1) {
      if (!Number.isSafeInteger(cell[axis])) {
        throw new RangeError(`grass demand cell[${index}][${axis}] must be a safe integer`);
      }
      if (cell[axis] < -2_000_000_000 || cell[axis] > 2_000_000_000) {
        throw new RangeError(`grass demand cell[${index}][${axis}] exceeds the bounded field`);
      }
    }
    canonical.set(`${cell[0]}:${cell[1]}`, [cell[0], cell[1]]);
  }
  return [...canonical.values()].sort((first, second) => (
    first[0] - second[0] || first[1] - second[1]
  ));
}

function requireBladeBudget(bladeBudget) {
  if (!Number.isSafeInteger(bladeBudget) || bladeBudget < 0) {
    throw new RangeError('grass bladeBudget must be a non-negative safe integer');
  }
  if (bladeBudget > MAX_BLADE_BUDGET) {
    throw new RangeError(`grass bladeBudget exceeds ${MAX_BLADE_BUDGET}`);
  }
}

function appendBlade(vertices, indices, blade, baseIndex) {
  const {
    x,
    y,
    height,
    halfWidth,
    direction,
    lean,
    color,
  } = blade;
  const widthX = Math.cos(direction) * halfWidth;
  const widthY = Math.sin(direction) * halfWidth;
  const leanX = Math.cos(lean.direction) * lean.amount;
  const leanY = Math.sin(lean.direction) * lean.amount;
  const normalLength = Math.hypot(widthY, -widthX, halfWidth * 0.18);
  const normal = [
    widthY / normalLength,
    -widthX / normalLength,
    halfWidth * 0.18 / normalLength,
  ];
  const positions = [
    [x - widthX, y - widthY, 0],
    [x + widthX, y + widthY, 0],
    [x + leanX + widthX * 0.28, y + leanY + widthY * 0.28, height],
    [x + leanX - widthX * 0.28, y + leanY - widthY * 0.28, height],
  ];
  for (const position of positions) {
    vertices.push(...position, ...normal, ...color);
  }
  indices.push(
    baseIndex,
    baseIndex + 1,
    baseIndex + 2,
    baseIndex,
    baseIndex + 2,
    baseIndex + 3,
  );
}

function sampleBlade(cellNode, material, cellX, cellY, bladeIndex) {
  const sample = (lane, minimum, maximum) => sampleBoundedUniform(
    cellNode,
    [bladeIndex, lane],
    { min: minimum, max: maximum },
  );
  const colorShift = sample(6, -0.035, 0.035);
  return Object.freeze({
    x: cellX + sample(0, 0.08, 0.92),
    y: cellY + sample(1, 0.08, 0.92),
    height: material.bladeHeight * sample(2, 0.72, 1.28),
    halfWidth: sample(3, 0.012, 0.028),
    direction: sample(4, 0, Math.PI),
    lean: Object.freeze({
      direction: sample(5, 0, Math.PI * 2),
      amount: material.bladeHeight * sample(7, 0.02, 0.16),
    }),
    color: Object.freeze([
      clamp(material.baseColor[0] + colorShift * 0.4, 0, 1),
      clamp(material.baseColor[1] + colorShift, 0, 1),
      clamp(material.baseColor[2] + colorShift * 0.2, 0, 1),
      1,
    ]),
    roughness: material.roughness,
  });
}

export function createGrassRendererPacketsReference(
  field,
  { cells, detailLevel, footprint, bladeBudget },
) {
  const state = fieldState.get(field);
  if (!state) {
    throw new TypeError('grass material field is required');
  }
  requireOptions({ detailLevel, footprint });
  requireBladeBudget(bladeBudget);
  const demandedCells = requireDemandedCells(cells);
  const bladesPerCell = 2 ** Math.min(4, detailLevel);
  const packets = [];
  let bladeCount = 0;
  let vertexBytes = 0;
  let indexBytes = 0;
  for (const [cellX, cellY] of demandedCells) {
    if (bladeCount >= bladeBudget) break;
    const cellBladeCount = Math.min(bladesPerCell, bladeBudget - bladeCount);
    if (cellBladeCount === 0) break;
    const { cellNode, material } = realizeGrassCellMaterial(
      field, state, cellX, cellY,
    );
    const vertexValues = [];
    const indexValues = [];
    const roughness = new Float32Array(cellBladeCount);
    for (let bladeIndex = 0; bladeIndex < cellBladeCount; bladeIndex += 1) {
      const blade = sampleBlade(cellNode, material, cellX, cellY, bladeIndex);
      appendBlade(vertexValues, indexValues, blade, bladeIndex * 4);
      roughness[bladeIndex] = blade.roughness;
    }
    const vertices = new Float32Array(vertexValues);
    const indices = new Uint32Array(indexValues);
    vertexBytes += vertices.byteLength;
    indexBytes += indices.byteLength;
    bladeCount += cellBladeCount;
    packets.push(Object.freeze({
      id: `grass:cell:${cellX}:${cellY}`,
      type: 'field_mesh',
      vertices,
      indices,
      blade_count: cellBladeCount,
      cull_backfaces: false,
      no_lighting: true,
      specular_strength: 0.02,
      material_channels: Object.freeze({ roughness }),
    }));
  }
  return Object.freeze({
    kind: 'grass-renderer-working-set:v1',
    packets: Object.freeze(packets),
    demandedCellCount: demandedCells.length,
    bladeCount,
    vertexBytes,
    indexBytes,
    budget: bladeBudget,
  });
}

export function createGrassRendererInstancePacketsReference(
  field,
  { cells, detailLevel, footprint, bladeBudget },
) {
  const state = fieldState.get(field);
  if (!state) {
    throw new TypeError('grass material field is required');
  }
  requireOptions({ detailLevel, footprint });
  requireBladeBudget(bladeBudget);
  const demandedCells = requireDemandedCells(cells);
  const bladesPerCell = 2 ** Math.min(4, detailLevel);
  const packets = [];
  let bladeCount = 0;
  let templateVertexBytes = 0;
  let templateIndexBytes = 0;
  let instanceBytes = 0;
  for (const [cellX, cellY] of demandedCells) {
    if (bladeCount >= bladeBudget) break;
    const cellBladeCount = Math.min(bladesPerCell, bladeBudget - bladeCount);
    if (cellBladeCount === 0) break;
    const { cellNode, material } = realizeGrassCellMaterial(
      field, state, cellX, cellY,
    );
    const instances = new Float32Array(cellBladeCount * 16);
    for (let bladeIndex = 0; bladeIndex < cellBladeCount; bladeIndex += 1) {
      const blade = sampleBlade(cellNode, material, cellX, cellY, bladeIndex);
      const offset = bladeIndex * 16;
      const directionX = Math.cos(blade.direction);
      const directionY = Math.sin(blade.direction);
      instances.set([
        blade.x,
        blade.y,
        0,
        blade.height,
        directionX,
        directionY,
        blade.halfWidth,
        blade.roughness,
        Math.cos(blade.lean.direction) * blade.lean.amount,
        Math.sin(blade.lean.direction) * blade.lean.amount,
        0,
        0,
        ...blade.color,
      ], offset);
    }
    bladeCount += cellBladeCount;
    templateVertexBytes += GRASS_BLADE_TEMPLATE_VERTICES.byteLength;
    templateIndexBytes += GRASS_BLADE_TEMPLATE_INDICES.byteLength;
    instanceBytes += instances.byteLength;
    packets.push(Object.freeze({
      id: `grass:cell:${cellX}:${cellY}`,
      type: 'field_mesh',
      instance_kind: 'grass-blade-list',
      instance_count: cellBladeCount,
      instances,
      vertices: GRASS_BLADE_TEMPLATE_VERTICES,
      indices: GRASS_BLADE_TEMPLATE_INDICES,
      blade_count: cellBladeCount,
      static_vertices: true,
      static_indices: true,
      static_instances: true,
      cull_backfaces: false,
      no_cull: true,
      no_lighting: true,
      pickable: false,
      specular_strength: 0.02,
    }));
  }
  return Object.freeze({
    kind: 'grass-renderer-instance-working-set:v1',
    packets: Object.freeze(packets),
    demandedCellCount: demandedCells.length,
    bladeCount,
    templateVertexBytes,
    templateIndexBytes,
    instanceBytes,
    uploadBytes: templateVertexBytes + templateIndexBytes + instanceBytes,
    budget: bladeBudget,
  });
}

export function createGrassRendererBatchPacketsReference(field, demand) {
  const workingSet = createGrassRendererInstancePacketsReference(field, demand);
  if (workingSet.packets.length === 0) {
    return Object.freeze({
      kind: 'grass-renderer-batch-working-set:v1',
      packets: Object.freeze([]),
      demandedCellCount: workingSet.demandedCellCount,
      bladeCount: 0,
      templateVertexBytes: 0,
      templateIndexBytes: 0,
      instanceBytes: 0,
      uploadBytes: 0,
      budget: workingSet.budget,
    });
  }
  const first = workingSet.packets[0];
  const instances = new Float32Array(workingSet.bladeCount * 16);
  const cellIds = [];
  const cellInstanceRanges = [];
  let instanceOffset = 0;
  for (const packet of workingSet.packets) {
    instances.set(packet.instances, instanceOffset * 16);
    cellIds.push(packet.id);
    cellInstanceRanges.push(Object.freeze({
      id: packet.id,
      offset: instanceOffset,
      count: packet.instance_count,
    }));
    instanceOffset += packet.instance_count;
  }
  const retainedSignature = cellInstanceRanges
    .map(({ id, count }) => `${id}:${count}`)
    .join('|');
  const packet = Object.freeze({
    id: 'grass:view-batch:v1',
    type: 'field_mesh',
    instance_kind: 'grass-blade-list',
    instance_count: workingSet.bladeCount,
    instances,
    vertices: first.vertices,
    indices: first.indices,
    blade_count: workingSet.bladeCount,
    cell_ids: Object.freeze(cellIds),
    cell_instance_ranges: Object.freeze(cellInstanceRanges),
    retained_signature: retainedSignature,
    static_vertices: true,
    static_indices: true,
    static_instances: false,
    cull_backfaces: false,
    no_cull: true,
    no_lighting: true,
    pickable: false,
    casts_shadow: true,
    specular_strength: 0.02,
  });
  const templateVertexBytes = packet.vertices.byteLength;
  const templateIndexBytes = packet.indices.byteLength;
  const instanceBytes = packet.instances.byteLength;
  return Object.freeze({
    kind: 'grass-renderer-batch-working-set:v1',
    packets: Object.freeze([packet]),
    demandedCellCount: workingSet.demandedCellCount,
    bladeCount: workingSet.bladeCount,
    templateVertexBytes,
    templateIndexBytes,
    instanceBytes,
    uploadBytes: templateVertexBytes + templateIndexBytes + instanceBytes,
    budget: workingSet.budget,
  });
}

export function createGrassRendererGpuBatchPacketsReference(
  field,
  { cells, detailLevel, footprint, bladeBudget },
) {
  const state = fieldState.get(field);
  if (!state) {
    throw new TypeError('grass material field is required');
  }
  requireOptions({ detailLevel, footprint });
  requireBladeBudget(bladeBudget);
  const demandedCells = requireDemandedCells(cells);
  const bladesPerCell = 2 ** Math.min(4, detailLevel);
  const shadowBladesPerCell = 2 ** Math.max(0, Math.min(4, detailLevel) - 1);
  const activeCells = [];
  let bladeCount = 0;
  let shadowBladeCount = 0;
  for (const [cellX, cellY] of demandedCells) {
    if (bladeCount >= bladeBudget) break;
    const cellBladeCount = Math.min(bladesPerCell, bladeBudget - bladeCount);
    if (cellBladeCount === 0) break;
    activeCells.push({ cellX, cellY, cellBladeCount });
    bladeCount += cellBladeCount;
    shadowBladeCount += Math.min(cellBladeCount, shadowBladesPerCell);
  }
  if (activeCells.length === 0) {
    return Object.freeze({
      kind: 'grass-renderer-gpu-batch-working-set:v1',
      packets: Object.freeze([]),
      demandedCellCount: demandedCells.length,
      bladeCount: 0,
      templateVertexBytes: 0,
      templateIndexBytes: 0,
      instanceBytes: 0,
      cellDescriptorBytes: 0,
      computeParameterBytes: 0,
      uploadBytes: 0,
      budget: bladeBudget,
    });
  }
  const cellRecords = new Uint32Array(activeCells.length * 12);
  const cellRecordFloats = new Float32Array(cellRecords.buffer);
  const cellIds = [];
  const cellInstanceRanges = [];
  let instanceOffset = 0;
  activeCells.forEach(({ cellX, cellY, cellBladeCount }, cellIndex) => {
    const { stream, material } = realizeGrassCellMaterial(
      field, state, cellX, cellY,
    );
    const wordOffset = cellIndex * 12;
    cellRecords[wordOffset] = cellX;
    cellRecords[wordOffset + 1] = cellY;
    cellRecords.set(stream.key, wordOffset + 2);
    cellRecords.set(stream.counterPrefix, wordOffset + 4);
    cellRecordFloats[wordOffset + 6] = material.bladeHeight;
    cellRecordFloats[wordOffset + 7] = material.roughness;
    cellRecordFloats.set(material.baseColor, wordOffset + 8);
    const id = `grass:cell:${cellX}:${cellY}`;
    cellIds.push(id);
    cellInstanceRanges.push(Object.freeze({
      id,
      offset: instanceOffset,
      count: cellBladeCount,
    }));
    instanceOffset += cellBladeCount;
  });
  const retainedSignature = cellInstanceRanges
    .map(({ id, count }) => `${id}:${count}`)
    .join('|');
  const grassGpu = Object.freeze({
    kind: 'grass-blade-philox:v1',
    cell_records: cellRecords,
    cell_stride_words: 12,
    blades_per_cell: bladesPerCell,
    shadow_blades_per_cell: shadowBladesPerCell,
    shadow_instance_count: shadowBladeCount,
  });
  const packet = Object.freeze({
    id: 'grass:view-batch:v1',
    type: 'field_mesh',
    instance_kind: 'grass-blade-list',
    instance_count: bladeCount,
    grass_gpu: grassGpu,
    vertices: GRASS_BLADE_TEMPLATE_VERTICES,
    indices: GRASS_BLADE_TEMPLATE_INDICES,
    blade_count: bladeCount,
    cell_ids: Object.freeze(cellIds),
    cell_instance_ranges: Object.freeze(cellInstanceRanges),
    retained_signature: retainedSignature,
    static_vertices: true,
    static_indices: true,
    static_instances: false,
    cull_backfaces: false,
    no_cull: true,
    no_lighting: true,
    pickable: false,
    casts_shadow: true,
    specular_strength: 0.02,
  });
  const templateVertexBytes = packet.vertices.byteLength;
  const templateIndexBytes = packet.indices.byteLength;
  const cellDescriptorBytes = cellRecords.byteLength;
  const computeParameterBytes = 16;
  return Object.freeze({
    kind: 'grass-renderer-gpu-batch-working-set:v1',
    packets: Object.freeze([packet]),
    demandedCellCount: demandedCells.length,
    bladeCount,
    templateVertexBytes,
    templateIndexBytes,
    instanceBytes: 0,
    cellDescriptorBytes,
    computeParameterBytes,
    uploadBytes: templateVertexBytes + templateIndexBytes
      + cellDescriptorBytes + computeParameterBytes,
    budget: bladeBudget,
  });
}
