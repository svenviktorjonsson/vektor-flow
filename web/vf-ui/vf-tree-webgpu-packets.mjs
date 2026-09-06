const MAX_VERTEX_BUDGET = 65_536;
const MAX_INDEX_BUDGET = 393_216;
const KIND_TRUNK = 0;
const KIND_CROWN = 1;
const KIND_BRANCH = 2;
const KIND_FOLIAGE = 3;
const KIND_TWIG = 4;
const TRUNK_SIDES = 10;
const BRANCH_SIDES = 7;
const TWIG_SIDES = 5;
const LEAVES_PER_CLUSTER = 24;
const LEAF_PARAMETER_STRIDE = 9;
const LEAF_VERTEX_COUNT = 16;
const LEAF_INDEX_COUNT = 72;

function add(left, right) {
  return left.map((value, axis) => value + right[axis]);
}

function scale(vector, amount) {
  return vector.map((value) => value * amount);
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function normalize(vector) {
  const length = Math.hypot(...vector);
  if (!(length > 1.0e-12)) {
    throw new RangeError('tree WebGPU primitive direction must be non-zero');
  }
  return vector.map((value) => value / length);
}

function basis(direction) {
  const axis = Math.abs(direction[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const first = normalize(cross(axis, direction));
  return [first, normalize(cross(direction, first))];
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function hashString(value, initial = 0x811c9dc5) {
  let hash = initial >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash;
}

function leafRoot(packet) {
  return createConditionedRoot({
    generator: 'vkf.conditioned',
    version: 1,
    seed: [hashString(packet.treeId), hashString(packet.id, 0x9e3779b9)],
    domain: 'material',
    hierarchy: ['tree:webgpu-leaves', packet.treeId],
    lod: packet.detailLevel,
    channel: 'leaf-mesh',
  });
}

function boundedNormal(node, lane, mean, standardDeviation, minimum, maximum) {
  return clamp(
    sampleNormalReference(node, [0, lane], { mean, standardDeviation }),
    minimum,
    maximum,
  );
}

function requirePacket(packet) {
  if (
    packet?.kind !== 'tree-render-packet:v1'
    || !Number.isSafeInteger(packet.primitiveCount)
    || packet.primitiveCount < 1
    || !Array.isArray(packet.primitiveIds)
    || !(packet.primitiveKinds instanceof Uint8Array)
    || !(packet.detailLevels instanceof Uint8Array)
    || !(packet.parents instanceof Int32Array)
    || !(packet.transforms instanceof Float32Array)
    || !(packet.baseColors instanceof Float32Array)
    || !(packet.surfaceParams instanceof Float32Array)
    || packet.primitiveIds.length !== packet.primitiveCount
    || packet.primitiveKinds.length !== packet.primitiveCount
    || packet.detailLevels.length !== packet.primitiveCount
    || packet.parents.length !== packet.primitiveCount
    || packet.transforms.length !== packet.primitiveCount * 8
    || packet.baseColors.length !== packet.primitiveCount * 4
    || packet.surfaceParams.length !== packet.primitiveCount * 4
  ) {
    throw new TypeError('tree render packet is required');
  }
  const counts = { trunks: 0, crowns: 0, branches: 0, twigs: 0, foliageClusters: 0 };
  for (const kind of packet.primitiveKinds) {
    if (kind === KIND_TRUNK) counts.trunks += 1;
    else if (kind === KIND_CROWN) counts.crowns += 1;
    else if (kind === KIND_BRANCH) counts.branches += 1;
    else if (kind === KIND_FOLIAGE) counts.foliageClusters += 1;
    else if (kind === KIND_TWIG) counts.twigs += 1;
    else throw new RangeError('tree WebGPU primitive kind is unsupported');
  }
  if (
    counts.trunks !== 1
    || counts.crowns !== 1
    || counts.branches !== 18
    || counts.twigs < 24
    || counts.twigs > 54
    || counts.foliageClusters !== counts.twigs
  ) {
    throw new RangeError('complete tree detail packet is required');
  }
  for (let index = 0; index < packet.primitiveCount; index += 1) {
    const kind = packet.primitiveKinds[index];
    const parent = packet.parents[index];
    if (kind === KIND_BRANCH && !(
      parent >= 0
      && parent < index
      && (packet.primitiveKinds[parent] === KIND_TRUNK
        || packet.primitiveKinds[parent] === KIND_BRANCH)
    )) throw new RangeError('complete tree detail packet is required');
    if (kind === KIND_FOLIAGE && !(
      parent >= 0
      && parent < index
      && packet.primitiveKinds[parent] === KIND_TWIG
    )) throw new RangeError('complete tree detail packet is required');
    if (kind === KIND_TWIG && !(
      parent >= 0
      && parent < index
      && packet.primitiveKinds[parent] === KIND_BRANCH
    )) throw new RangeError('complete tree detail packet is required');
  }
  const leafParents = new Set();
  for (let index = 0; index < packet.primitiveCount; index += 1) {
    if (packet.primitiveKinds[index] === KIND_FOLIAGE) leafParents.add(packet.parents[index]);
  }
  for (let index = 0; index < packet.primitiveCount; index += 1) {
    if (packet.primitiveKinds[index] === KIND_TWIG && !leafParents.has(index)) {
      throw new RangeError('complete tree detail packet is required');
    }
  }
  return counts;
}

function requireBudgets(vertexBudget, indexBudget) {
  if (
    !Number.isSafeInteger(vertexBudget)
    || vertexBudget < 0
    || vertexBudget > MAX_VERTEX_BUDGET
  ) {
    throw new RangeError(`tree WebGPU vertexBudget must be from 0 through ${MAX_VERTEX_BUDGET}`);
  }
  if (
    !Number.isSafeInteger(indexBudget)
    || indexBudget < 0
    || indexBudget > MAX_INDEX_BUDGET
  ) {
    throw new RangeError(`tree WebGPU indexBudget must be from 0 through ${MAX_INDEX_BUDGET}`);
  }
}

function meshBuilder(vertexBudget, indexBudget, usage) {
  const vertices = [];
  const indices = [];
  const uvs = [];
  const roughness = [];
  function reserve(vertexCount, indexCount) {
    if (usage.vertices + vertexCount > vertexBudget) {
      throw new RangeError('tree WebGPU vertex budget is exhausted');
    }
    if (usage.indices + indexCount > indexBudget) {
      throw new RangeError('tree WebGPU index budget is exhausted');
    }
    usage.vertices += vertexCount;
    usage.indices += indexCount;
  }
  function vertex(position, normal, color, surfaceRoughness, uv = [0, 0]) {
    const index = vertices.length / 10;
    vertices.push(...position, ...normal, ...color);
    uvs.push(...uv);
    roughness.push(surfaceRoughness);
    return index;
  }
  return { vertices, indices, uvs, roughness, reserve, vertex };
}

function appendCylinder(builder, transform, color, roughness, sides, taper, centered = false) {
  let origin = Array.from(transform.slice(0, 3));
  const direction = normalize(Array.from(transform.slice(3, 6)));
  const length = transform[6];
  const radius = transform[7];
  if (!(length > 0) || !(radius > 0)) {
    throw new RangeError('tree WebGPU cylinder dimensions must be positive');
  }
  if (centered) origin = add(origin, scale(direction, length * -0.5));
  builder.reserve(sides * 2 + 2, sides * 12);
  const [first, second] = basis(direction);
  const end = add(origin, scale(direction, length));
  const base = builder.vertices.length / 10;
  for (let ring = 0; ring < 2; ring += 1) {
    const center = ring === 0 ? origin : end;
    const ringRadius = radius * (ring === 0 ? 1 : taper);
    for (let side = 0; side < sides; side += 1) {
      const angle = 2 * Math.PI * side / sides;
      const normal = add(scale(first, Math.cos(angle)), scale(second, Math.sin(angle)));
      builder.vertex(
        add(center, scale(normal, ringRadius)),
        normal,
        color,
        roughness,
        [side / sides, ring],
      );
    }
  }
  const bottom = builder.vertex(origin, scale(direction, -1), color, roughness, [0.5, 0.5]);
  const top = builder.vertex(end, direction, color, roughness, [0.5, 0.5]);
  for (let side = 0; side < sides; side += 1) {
    const next = (side + 1) % sides;
    const lower = base + side;
    const lowerNext = base + next;
    const upper = base + sides + side;
    const upperNext = base + sides + next;
    builder.indices.push(lower, lowerNext, upper, lowerNext, upperNext, upper);
    builder.indices.push(bottom, lowerNext, lower, top, upper, upperNext);
  }
}

function addDoubleSidedTriangle(indices, first, second, third) {
  indices.push(first, second, third, third, second, first);
}

function addDoubleSidedQuad(indices, first, second, third, fourth) {
  addDoubleSidedTriangle(indices, first, second, third);
  addDoubleSidedTriangle(indices, first, third, fourth);
}

function leafParameters(leafNode, transform) {
  const scaleHint = transform[7];
  const bladeLength = boundedNormal(
    leafNode, 0, scaleHint * 0.9, scaleHint * 0.12, scaleHint * 0.6, scaleHint * 1.2,
  );
  const widthRatio = boundedNormal(leafNode, 1, 0.46, 0.06, 0.28, 0.65);
  const baseRoundness = boundedNormal(leafNode, 2, 0.72, 0.07, 0.5, 0.92);
  const asymmetry = boundedNormal(leafNode, 3, 0, 0.05, -0.16, 0.16);
  const petioleRatio = boundedNormal(leafNode, 4, 0.27, 0.04, 0.16, 0.4);
  const camberRatio = boundedNormal(leafNode, 5, 0, 0.025, -0.08, 0.08);
  const attachment = boundedNormal(leafNode, 6, 0.68, 0.18, 0.12, 0.98);
  const orientationOffset = boundedNormal(leafNode, 7, 0, 0.34, -0.9, 0.9);
  const colorVariation = boundedNormal(leafNode, 8, 0, 0.025, -0.06, 0.06);
  return [
    bladeLength,
    bladeLength * widthRatio,
    baseRoundness,
    asymmetry,
    bladeLength * petioleRatio,
    bladeLength * camberRatio,
    attachment,
    orientationOffset,
    colorVariation,
  ];
}

function appendOvateLeaf(builder, transform, color, roughness, parameters, leafIndex) {
  const origin = Array.from(transform.slice(0, 3));
  const direction = normalize(Array.from(transform.slice(3, 6)));
  const [first, second] = basis(direction);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const angle = leafIndex * goldenAngle + parameters[7];
  const radial = add(scale(first, Math.cos(angle)), scale(second, Math.sin(angle)));
  const wideAxis = normalize(cross(direction, radial));
  const longAxis = normalize(add(radial, scale(direction, 0.24 + 0.06 * (leafIndex % 3))));
  const normal = normalize(cross(longAxis, wideAxis));
  const bladeLength = parameters[0];
  const bladeWidth = parameters[1];
  const baseRoundness = parameters[2];
  const asymmetry = parameters[3];
  const petioleLength = parameters[4];
  const camber = parameters[5];
  const attachment = add(
    add(origin, scale(direction, transform[6] * parameters[6])),
    scale(radial, transform[7] * 0.14),
  );
  const leafColor = color.map((value, channel) => (
    channel === 3 ? value : clamp(value + parameters[8], 0, 1)
  ));
  const petioleHalfWidth = Math.max(bladeWidth * 0.025, bladeLength * 0.008);
  const bladeBase = add(attachment, scale(longAxis, petioleLength));
  const base = builder.vertices.length / 10;
  builder.vertex(add(attachment, scale(wideAxis, -petioleHalfWidth)), normal, leafColor, roughness, [0.48, 0]);
  builder.vertex(add(attachment, scale(wideAxis, petioleHalfWidth)), normal, leafColor, roughness, [0.52, 0]);
  builder.vertex(add(bladeBase, scale(wideAxis, -petioleHalfWidth)), normal, leafColor, roughness, [0.48, 0.16]);
  builder.vertex(add(bladeBase, scale(wideAxis, petioleHalfWidth)), normal, leafColor, roughness, [0.52, 0.16]);
  builder.vertex(bladeBase, normal, leafColor, roughness, [0.5, 0.18]);
  const stations = [0.12, 0.28, 0.48, 0.68, 0.84];
  for (const station of stations) {
    const profile = Math.pow(Math.sin(Math.PI * station), baseRoundness)
      * (1 - station * 0.12);
    const halfWidth = bladeWidth * 0.5 * profile;
    const center = add(
      add(bladeBase, scale(longAxis, bladeLength * station)),
      add(
        scale(wideAxis, bladeWidth * asymmetry * Math.sin(Math.PI * station)),
        scale(normal, camber * Math.sin(Math.PI * station)),
      ),
    );
    builder.vertex(add(center, scale(wideAxis, -halfWidth)), normal, leafColor, roughness, [0, 0.18 + station * 0.82]);
    builder.vertex(add(center, scale(wideAxis, halfWidth)), normal, leafColor, roughness, [1, 0.18 + station * 0.82]);
  }
  const apex = add(
    add(bladeBase, scale(longAxis, bladeLength)),
    scale(normal, camber * 0.18),
  );
  builder.vertex(apex, normal, leafColor, roughness, [0.5, 1]);
  addDoubleSidedQuad(builder.indices, base, base + 1, base + 3, base + 2);
  addDoubleSidedTriangle(builder.indices, base + 4, base + 5, base + 6);
  for (let station = 0; station < stations.length - 1; station += 1) {
    const firstPair = base + 5 + station * 2;
    const nextPair = firstPair + 2;
    addDoubleSidedQuad(
      builder.indices,
      firstPair,
      nextPair,
      nextPair + 1,
      firstPair + 1,
    );
  }
  addDoubleSidedTriangle(builder.indices, base + 13, base + 15, base + 14);
}

function appendLeaves(builder, transform, color, roughness, clusterNode, parameterBuffer) {
  if (!(transform[6] > 0) || !(transform[7] > 0)) {
    throw new RangeError('tree WebGPU leaf dimensions must be positive');
  }
  builder.reserve(
    LEAVES_PER_CLUSTER * LEAF_VERTEX_COUNT,
    LEAVES_PER_CLUSTER * LEAF_INDEX_COUNT,
  );
  for (let leaf = 0; leaf < LEAVES_PER_CLUSTER; leaf += 1) {
    const leafNode = conditionChild(clusterNode, {
      segment: `leaf:${leaf}`,
      channel: 'leaf-geometry',
    });
    const parameters = leafParameters(leafNode, transform);
    parameterBuffer.push(...parameters);
    appendOvateLeaf(builder, transform, color, roughness, parameters, leaf);
  }
}

function finishMesh(packet, suffix, objectId, builder) {
  const meanRoughness = builder.roughness.reduce((sum, value) => sum + value, 0)
    / builder.roughness.length;
  return Object.freeze({
    type: 'field_mesh',
    id: `${packet.id}:${suffix}`,
    object_id: objectId,
    mode3d: true,
    topology: 'triangle-list',
    static_vertices: true,
    static_indices: true,
    receives_lighting: true,
    casts_shadow: true,
    receives_shadow: true,
    specular_strength: Math.max(0.02, 0.12 * (1 - meanRoughness)),
    vertices: new Float32Array(builder.vertices),
    uvs: new Float32Array(builder.uvs),
    indices: new Uint32Array(builder.indices),
  });
}

export function adaptTreeRenderPacketToWebGpuMeshesReference(
  packet,
  { vertexBudget, indexBudget },
) {
  const sourceCounts = requirePacket(packet);
  requireBudgets(vertexBudget, indexBudget);
  const usage = { vertices: 0, indices: 0 };
  const wood = meshBuilder(vertexBudget, indexBudget, usage);
  const foliage = meshBuilder(vertexBudget, indexBudget, usage);
  const root = leafRoot(packet);
  const leafParameterValues = [];
  for (let primitive = 0; primitive < packet.primitiveCount; primitive += 1) {
    const kind = packet.primitiveKinds[primitive];
    const transform = packet.transforms.subarray(primitive * 8, primitive * 8 + 8);
    const color = Array.from(packet.baseColors.subarray(primitive * 4, primitive * 4 + 4));
    const roughness = packet.surfaceParams[primitive * 4];
    if (kind === KIND_TRUNK) {
      appendCylinder(wood, transform, color, roughness, TRUNK_SIDES, 0.72, true);
    } else if (kind === KIND_BRANCH) {
      appendCylinder(wood, transform, color, roughness, BRANCH_SIDES, 0.45);
    } else if (kind === KIND_TWIG) {
      appendCylinder(wood, transform, color, roughness, TWIG_SIDES, 0.32);
    } else if (kind === KIND_FOLIAGE) {
      appendLeaves(
        foliage,
        transform,
        color,
        roughness,
        conditionChild(root, {
          segment: packet.primitiveIds[primitive],
          channel: 'leaf-cluster',
        }),
        leafParameterValues,
      );
    }
  }
  const vertexCount = wood.vertices.length / 10 + foliage.vertices.length / 10;
  const indexCount = wood.indices.length + foliage.indices.length;
  if (vertexCount > vertexBudget) {
    throw new RangeError('tree WebGPU vertex budget is exhausted');
  }
  if (indexCount > indexBudget) {
    throw new RangeError('tree WebGPU index budget is exhausted');
  }
  return Object.freeze({
    kind: 'tree-webgpu-mesh-state:v1',
    source: packet,
    meshes: Object.freeze([
      finishMesh(packet, 'wood', packet.treeIndex * 2 + 1, wood),
      finishMesh(packet, 'foliage', packet.treeIndex * 2 + 2, foliage),
    ]),
    counts: Object.freeze({
      trunks: sourceCounts.trunks,
      crowns: 0,
      branches: sourceCounts.branches,
      twigs: sourceCounts.twigs,
      foliageClusters: sourceCounts.foliageClusters,
      leaves: sourceCounts.foliageClusters * LEAVES_PER_CLUSTER,
    }),
    leafParameterStride: LEAF_PARAMETER_STRIDE,
    leafParameters: new Float32Array(leafParameterValues),
    vertexCount,
    indexCount,
    vertexBudget,
    indexBudget,
  });
}
import {
  conditionChild,
  createConditionedRoot,
  sampleNormalReference,
} from './vf-conditioned-distribution.mjs';
