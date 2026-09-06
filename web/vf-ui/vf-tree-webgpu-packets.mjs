const MAX_VERTEX_BUDGET = 65_536;
const MAX_INDEX_BUDGET = 393_216;
const KIND_TRUNK = 0;
const KIND_CROWN = 1;
const KIND_BRANCH = 2;
const KIND_FOLIAGE = 3;
const TRUNK_SIDES = 10;
const BRANCH_SIDES = 7;
const LEAVES_PER_CLUSTER = 12;
const CROWN_LEAVES = 768;

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

function requirePacket(packet) {
  if (
    packet?.kind !== 'tree-render-packet:v1'
    || !Number.isSafeInteger(packet.primitiveCount)
    || packet.primitiveCount < 1
    || !Array.isArray(packet.primitiveIds)
    || !(packet.primitiveKinds instanceof Uint8Array)
    || !(packet.transforms instanceof Float32Array)
    || !(packet.baseColors instanceof Float32Array)
    || !(packet.surfaceParams instanceof Float32Array)
    || packet.primitiveIds.length !== packet.primitiveCount
    || packet.primitiveKinds.length !== packet.primitiveCount
    || packet.transforms.length !== packet.primitiveCount * 8
    || packet.baseColors.length !== packet.primitiveCount * 4
    || packet.surfaceParams.length !== packet.primitiveCount * 4
  ) {
    throw new TypeError('tree render packet is required');
  }
  const counts = { trunks: 0, crowns: 0, branches: 0, foliageClusters: 0 };
  for (const kind of packet.primitiveKinds) {
    if (kind === KIND_TRUNK) counts.trunks += 1;
    else if (kind === KIND_CROWN) counts.crowns += 1;
    else if (kind === KIND_BRANCH) counts.branches += 1;
    else if (kind === KIND_FOLIAGE) counts.foliageClusters += 1;
    else throw new RangeError('tree WebGPU primitive kind is unsupported');
  }
  if (
    counts.trunks !== 1
    || counts.crowns !== 1
    || counts.branches !== 4
    || counts.foliageClusters !== 16
  ) {
    throw new RangeError('complete tree detail packet is required');
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
  function vertex(position, normal, color, surfaceRoughness) {
    const index = vertices.length / 10;
    vertices.push(...position, ...normal, ...color);
    roughness.push(surfaceRoughness);
    return index;
  }
  return { vertices, indices, roughness, reserve, vertex };
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
      builder.vertex(add(center, scale(normal, ringRadius)), normal, color, roughness);
    }
  }
  const bottom = builder.vertex(origin, scale(direction, -1), color, roughness);
  const top = builder.vertex(end, direction, color, roughness);
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

function appendLeaves(builder, transform, color, roughness) {
  const origin = Array.from(transform.slice(0, 3));
  const direction = normalize(Array.from(transform.slice(3, 6)));
  const length = transform[6];
  const width = transform[7];
  if (!(length > 0) || !(width > 0)) {
    throw new RangeError('tree WebGPU leaf dimensions must be positive');
  }
  builder.reserve(LEAVES_PER_CLUSTER * 4, LEAVES_PER_CLUSTER * 12);
  const [first, second] = basis(direction);
  for (let leaf = 0; leaf < LEAVES_PER_CLUSTER; leaf += 1) {
    const angle = 2 * Math.PI * leaf / LEAVES_PER_CLUSTER + 0.31;
    const radial = add(scale(first, Math.cos(angle)), scale(second, Math.sin(angle)));
    const longAxis = normalize(add(radial, scale(direction, 0.38 + 0.08 * (leaf % 2))));
    const wideAxis = normalize(cross(direction, radial));
    const normal = normalize(cross(longAxis, wideAxis));
    const center = add(
      add(origin, scale(direction, length * (0.08 * (leaf - 2.5)))),
      scale(radial, width * 0.35),
    );
    const halfLength = length * (0.18 + 0.012 * (leaf % 3));
    const halfWidth = width * (0.24 + 0.02 * (leaf % 2));
    const base = builder.vertices.length / 10;
    builder.vertex(add(center, scale(longAxis, halfLength)), normal, color, roughness);
    builder.vertex(add(center, scale(wideAxis, halfWidth)), normal, color, roughness);
    builder.vertex(add(center, scale(longAxis, -halfLength)), normal, color, roughness);
    builder.vertex(add(center, scale(wideAxis, -halfWidth)), normal, color, roughness);
    builder.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    builder.indices.push(base + 2, base + 1, base, base + 3, base + 2, base);
  }
}

function appendCrownLeaves(builder, transform, color, roughness) {
  const center = Array.from(transform.slice(0, 3));
  const direction = normalize(Array.from(transform.slice(3, 6)));
  const height = transform[6];
  const radius = transform[7];
  if (!(height > 0) || !(radius > 0)) {
    throw new RangeError('tree WebGPU crown dimensions must be positive');
  }
  builder.reserve(CROWN_LEAVES * 4, CROWN_LEAVES * 12);
  const [first, second] = basis(direction);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let leaf = 0; leaf < CROWN_LEAVES; leaf += 1) {
    const vertical = 1 - 2 * ((leaf + 0.5) / CROWN_LEAVES);
    const angle = leaf * goldenAngle;
    const shell = Math.sqrt(Math.max(0, 1 - vertical * vertical));
    const radial = add(scale(first, Math.cos(angle)), scale(second, Math.sin(angle)));
    const tangent = add(scale(first, -Math.sin(angle)), scale(second, Math.cos(angle)));
    const tilt = ((leaf % 5) - 2) * 0.34;
    const longAxis = normalize(add(radial, scale(direction, tilt)));
    const wideAxis = tangent;
    const normal = normalize(cross(longAxis, wideAxis));
    const leafCenter = add(
      add(center, scale(radial, radius * shell * 0.72)),
      scale(direction, height * vertical * 0.38),
    );
    const halfLength = Math.min(height * 0.04, radius * 0.055);
    const halfWidth = radius * 0.038;
    const base = builder.vertices.length / 10;
    builder.vertex(add(leafCenter, scale(longAxis, halfLength)), normal, color, roughness);
    builder.vertex(add(leafCenter, scale(wideAxis, halfWidth)), normal, color, roughness);
    builder.vertex(add(leafCenter, scale(longAxis, -halfLength)), normal, color, roughness);
    builder.vertex(add(leafCenter, scale(wideAxis, -halfWidth)), normal, color, roughness);
    builder.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    builder.indices.push(base + 2, base + 1, base, base + 3, base + 2, base);
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
  for (let primitive = 0; primitive < packet.primitiveCount; primitive += 1) {
    const kind = packet.primitiveKinds[primitive];
    const transform = packet.transforms.subarray(primitive * 8, primitive * 8 + 8);
    const color = Array.from(packet.baseColors.subarray(primitive * 4, primitive * 4 + 4));
    const roughness = packet.surfaceParams[primitive * 4];
    if (kind === KIND_TRUNK) {
      appendCylinder(wood, transform, color, roughness, TRUNK_SIDES, 0.72, true);
    } else if (kind === KIND_CROWN) {
      appendCrownLeaves(foliage, transform, color, roughness);
    } else if (kind === KIND_BRANCH) {
      appendCylinder(wood, transform, color, roughness, BRANCH_SIDES, 0.45);
    } else if (kind === KIND_FOLIAGE) {
      appendLeaves(foliage, transform, color, roughness);
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
      crowns: sourceCounts.crowns,
      branches: sourceCounts.branches,
      foliageClusters: sourceCounts.foliageClusters,
      leaves: CROWN_LEAVES + sourceCounts.foliageClusters * LEAVES_PER_CLUSTER,
    }),
    vertexCount,
    indexCount,
    vertexBudget,
    indexBudget,
  });
}
