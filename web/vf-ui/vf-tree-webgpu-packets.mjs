const MAX_VERTEX_BUDGET = 65_536;
const MAX_INDEX_BUDGET = 393_216;
const KIND_TRUNK = 0;
const KIND_CROWN = 1;
const KIND_BRANCH = 2;
const KIND_FOLIAGE = 3;
const KIND_TWIG = 4;
const LEAVES_PER_CLUSTER = 2;
const LEAF_PARAMETER_STRIDE = 9;
const LEAF_VERTEX_COUNT = 12;
const LEAF_INDEX_COUNT = 66;
const WOOD_RING_SIDES = 12;
const TRUNK_BARK_RING_SIDES = 30;
const TRUNK_BARK_STEPS = 64;
const BRANCH_RING_SIDES = 10;
const TWIG_RING_SIDES = 8;

function add(left, right) {
  return left.map((value, axis) => value + right[axis]);
}

function scale(vector, amount) {
  return vector.map((value) => value * amount);
}

function subtract(left, right) {
  return left.map((value, axis) => value - right[axis]);
}

function dot(left, right) {
  return left.reduce((sum, value, axis) => sum + value * right[axis], 0);
}

function distance(left, right) {
  return Math.hypot(...subtract(left, right));
}

function angleBetween(left, right) {
  return Math.acos(clamp(dot(normalize(left), normalize(right)), -1, 1));
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
    || !Array.isArray(packet.curves)
    || !(packet.primitiveKinds instanceof Uint8Array)
    || !(packet.detailLevels instanceof Uint8Array)
    || !(packet.parents instanceof Int32Array)
    || !(packet.transforms instanceof Float32Array)
    || !(packet.baseColors instanceof Float32Array)
    || !(packet.surfaceParams instanceof Float32Array)
    || packet.primitiveIds.length !== packet.primitiveCount
    || packet.curves.length !== packet.primitiveCount
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
    || counts.branches !== 62
    || counts.twigs < 220
    || counts.twigs > 420
    || counts.foliageClusters < counts.twigs * 3
    || counts.foliageClusters > counts.twigs * 9
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
      && (packet.primitiveKinds[parent] === KIND_TRUNK
        || packet.primitiveKinds[parent] === KIND_BRANCH
        || packet.primitiveKinds[parent] === KIND_TWIG)
    )) throw new RangeError('complete tree detail packet is required');
  }
  const leafParents = new Map();
  for (let index = 0; index < packet.primitiveCount; index += 1) {
    if (packet.primitiveKinds[index] === KIND_FOLIAGE) {
      const parent = packet.parents[index];
      leafParents.set(parent, (leafParents.get(parent) ?? 0) + 1);
    }
  }
  for (let index = 0; index < packet.primitiveCount; index += 1) {
    if (packet.primitiveKinds[index] === KIND_TWIG) {
      const leafCount = leafParents.get(index) ?? 0;
      const isLateralShoot = packet.primitiveIds[index].includes(':branch:shoot:');
      const bounds = isLateralShoot
        ? packet.profile.twig.shootLeafCountBounds
        : packet.profile.twig.terminalLeafCountBounds;
      if (leafCount < bounds[0] || leafCount > bounds[1]) {
        throw new RangeError('complete tree detail packet is required');
      }
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

function woodTaper(kind) {
  if (kind === KIND_TRUNK) return 0.72;
  if (kind === KIND_BRANCH) return 0.58;
  if (kind === KIND_TWIG) return 0.42;
  throw new RangeError('tree WebGPU wood kind is unsupported');
}

function pathState(curve) {
  const distances = [0];
  for (let index = 1; index < curve.points.length; index += 1) {
    distances.push(distances.at(-1) + distance(curve.points[index - 1], curve.points[index]));
  }
  return { curve, distances, length: distances.at(-1) };
}

function samplePath(path, along) {
  const bounded = clamp(along, 0, path.length);
  let segment = path.distances.length - 2;
  for (let index = 0; index < path.distances.length - 1; index += 1) {
    if (bounded <= path.distances[index + 1] + 1e-12) {
      segment = index;
      break;
    }
  }
  const start = path.distances[segment];
  const span = Math.max(path.distances[segment + 1] - start, 1e-12);
  const fraction = clamp((bounded - start) / span, 0, 1);
  return {
    point: add(
      scale(path.curve.points[segment], 1 - fraction),
      scale(path.curve.points[segment + 1], fraction),
    ),
    tangent: normalize(add(
      scale(path.curve.tangents[Math.max(0, segment - 1)] ?? path.curve.tangents[segment], 1 - fraction),
      scale(path.curve.tangents[segment] ?? path.curve.tangents.at(-1), fraction),
    )),
  };
}

function closestPathDistance(path, point) {
  let best = { squared: Number.POSITIVE_INFINITY, along: 0 };
  for (let segment = 0; segment < path.curve.points.length - 1; segment += 1) {
    const start = path.curve.points[segment];
    const delta = subtract(path.curve.points[segment + 1], start);
    const squaredLength = dot(delta, delta);
    const fraction = clamp(dot(subtract(point, start), delta) / squaredLength, 0, 1);
    const candidate = add(start, scale(delta, fraction));
    const squared = dot(subtract(point, candidate), subtract(point, candidate));
    if (squared < best.squared) {
      best = {
        squared,
        along: path.distances[segment] + Math.sqrt(squaredLength) * fraction,
      };
    }
  }
  return best.along;
}

function parallelTransportBasis(path, along) {
  let tangent = samplePath(path, 0).tangent;
  let [first] = basis(tangent);
  const stations = [...path.distances.filter((value) => value > 0 && value < along), along];
  for (const station of stations) {
    tangent = samplePath(path, station).tangent;
    const projected = subtract(first, scale(tangent, dot(first, tangent)));
    first = Math.hypot(...projected) > 1e-9 ? normalize(projected) : basis(tangent)[0];
  }
  return [first, normalize(cross(tangent, first))];
}

function appendPartitionedFork(builder, ports, nodePoint) {
  const ringSides = Array.from({ length: WOOD_RING_SIDES }, (_, side) => side);
  const innerLoops = ports.map(({ target, record }) => {
    const center = target.positions.reduce((sum, point) => add(sum, point), [0, 0, 0])
      .map((value) => value / WOOD_RING_SIDES);
    const innerCenter = add(scale(nodePoint, 0.72), scale(center, 0.28));
    builder.reserve(WOOD_RING_SIDES, 0);
    return ringSides.map((side) => {
      const radial = subtract(target.positions[side], center);
      const position = add(innerCenter, scale(radial, 0.96));
      return builder.vertex(
        position,
        normalize(radial),
        record.color,
        record.roughness,
        [side / WOOD_RING_SIDES, target.barkV],
      );
    });
  });
  const continuationIndex = ports[1].target.radius >= ports[2].target.radius ? 1 : 2;
  const lateralIndex = continuationIndex === 1 ? 2 : 1;
  const incoming = innerLoops[0];
  const vertexPoint = (vertex) => builder.vertices.slice(vertex * 10, vertex * 10 + 3);
  function alignCycle(outer, inner) {
    const candidates = [];
    for (const source of [inner, [...inner].reverse()]) {
      for (let rotation = 0; rotation < source.length; rotation += 1) {
        candidates.push([...source.slice(rotation), ...source.slice(0, rotation)]);
      }
    }
    return candidates.reduce((best, candidate) => {
      const score = outer.reduce((sum, vertex, side) => (
        sum + distance(
          vertexPoint(vertex),
          vertexPoint(candidate[Math.floor(side * candidate.length / outer.length)]),
        )
      ), 0);
      return score < best.score ? { value: candidate, score } : best;
    }, { value: inner, score: Number.POSITIVE_INFINITY }).value;
  }
  const continuation = alignCycle(incoming, innerLoops[continuationIndex]);
  const lateral = innerLoops[lateralIndex];
  const triangles = [];
  const lateralCenter = lateral.reduce((sum, vertex) => add(sum, vertexPoint(vertex)), [0, 0, 0])
    .map((value) => value / WOOD_RING_SIDES);
  let graftStart = 0;
  let graftDistance = Number.POSITIVE_INFINITY;
  for (let start = 0; start < WOOD_RING_SIDES; start += 1) {
    const patchVertices = [];
    for (let offset = 0; offset <= 1; offset += 1) {
      patchVertices.push(incoming[(start + offset) % WOOD_RING_SIDES]);
      patchVertices.push(continuation[(start + offset) % WOOD_RING_SIDES]);
    }
    const center = patchVertices.reduce((sum, vertex) => add(sum, vertexPoint(vertex)), [0, 0, 0])
      .map((value) => value / patchVertices.length);
    const candidate = distance(center, lateralCenter);
    if (candidate < graftDistance) {
      graftDistance = candidate;
      graftStart = start;
    }
  }
  const omitted = new Set([graftStart]);
  for (let side = 0; side < WOOD_RING_SIDES; side += 1) {
    if (omitted.has(side)) continue;
    const next = (side + 1) % WOOD_RING_SIDES;
    triangles.push(
      [incoming[side], incoming[next], continuation[side]],
      [incoming[next], continuation[next], continuation[side]],
    );
  }
  const graftBoundary = [
    ...Array.from({ length: 2 }, (_, offset) => incoming[(graftStart + offset) % WOOD_RING_SIDES]),
    ...Array.from({ length: 2 }, (_, offset) => (
      continuation[(graftStart + 1 - offset) % WOOD_RING_SIDES]
    )),
  ];
  function stitch(outer, inner) {
    const alignedInner = alignCycle(outer, inner);
    let outerIndex = 0;
    let innerIndex = 0;
    while (outerIndex < outer.length || innerIndex < inner.length) {
      const outerNext = (outerIndex + 1) / outer.length;
      const innerNext = (innerIndex + 1) / inner.length;
      if (outerIndex < outer.length && (innerIndex >= inner.length || outerNext <= innerNext)) {
        triangles.push([
          outer[outerIndex % outer.length],
          outer[(outerIndex + 1) % outer.length],
          alignedInner[innerIndex % alignedInner.length],
        ]);
        outerIndex += 1;
      } else {
        triangles.push([
          outer[outerIndex % outer.length],
          alignedInner[(innerIndex + 1) % alignedInner.length],
          alignedInner[innerIndex % alignedInner.length],
        ]);
        innerIndex += 1;
      }
    }
  }
  stitch(graftBoundary, lateral);
  ports.forEach(({ target }, portIndex) => stitch(target.indices, innerLoops[portIndex]));
  const edgeTriangles = new Map();
  triangles.forEach((triangle, triangleIndex) => {
    for (let edge = 0; edge < 3; edge += 1) {
      const left = triangle[edge];
      const right = triangle[(edge + 1) % 3];
      const key = [left, right].sort((a, b) => a - b).join(':');
      if (!edgeTriangles.has(key)) edgeTriangles.set(key, []);
      edgeTriangles.get(key).push({ triangleIndex, left, right });
    }
  });
  const flips = new Array(triangles.length).fill(null);
  flips[0] = false;
  const pending = [0];
  while (pending.length > 0) {
    const triangleIndex = pending.pop();
    const triangle = triangles[triangleIndex];
    for (let edge = 0; edge < 3; edge += 1) {
      const left = triangle[edge];
      const right = triangle[(edge + 1) % 3];
      const key = [left, right].sort((a, b) => a - b).join(':');
      for (const neighbor of edgeTriangles.get(key)) {
        if (neighbor.triangleIndex === triangleIndex || flips[neighbor.triangleIndex] !== null) continue;
        const currentLeft = flips[triangleIndex] ? right : left;
        const currentRight = flips[triangleIndex] ? left : right;
        flips[neighbor.triangleIndex] = neighbor.left === currentLeft && neighbor.right === currentRight;
        pending.push(neighbor.triangleIndex);
      }
    }
  }
  const oriented = triangles.map((triangle, index) => (
    flips[index] ? [triangle[0], triangle[2], triangle[1]] : triangle
  ));
  const outwardScore = oriented.reduce((sum, triangle) => {
    const points = triangle.map(vertexPoint);
    const normal = cross(subtract(points[1], points[0]), subtract(points[2], points[0]));
    const center = points.reduce((total, point) => add(total, point), [0, 0, 0])
      .map((value) => value / 3);
    return sum + dot(normal, subtract(center, nodePoint));
  }, 0);
  if (outwardScore < 0) oriented.forEach((triangle) => triangle.splice(1, 2, triangle[2], triangle[1]));
  builder.reserve(0, oriented.length * 3);
  builder.indices.push(...oriented.flat());
  return Object.freeze({
    triangleCount: oriented.length,
    minimumRadialScale: 0.96,
    maximumRadialScale: 1,
    connectorComponents: 0,
  });
}

function appendWoodyNetwork(builder, packet, bark) {
  const woody = [];
  for (let primitive = 0; primitive < packet.primitiveCount; primitive += 1) {
    const kind = packet.primitiveKinds[primitive];
    if (![KIND_TRUNK, KIND_BRANCH, KIND_TWIG].includes(kind)) continue;
    const transform = packet.transforms.subarray(primitive * 8, primitive * 8 + 8);
    const path = pathState(packet.curves[primitive]);
    woody.push({
      primitive,
      kind,
      parent: packet.parents[primitive],
      transform,
      path,
      taper: woodTaper(kind),
      endRadius: transform[7] * woodTaper(kind),
      color: Array.from(packet.baseColors.subarray(primitive * 4, primitive * 4 + 4)),
      roughness: packet.surfaceParams[primitive * 4],
      exclusions: [],
      baseBarkV: 0,
    });
  }
  const byPrimitive = new Map(woody.map((record) => [record.primitive, record]));
  const groupsByParent = new Map();
  for (const child of woody) {
    const parent = byPrimitive.get(child.parent);
    if (!parent) continue;
    const attachment = closestPathDistance(parent.path, child.path.curve.points[0]);
    child.attachment = attachment;
    child.baseBarkV = parent.baseBarkV + attachment / packet.targetPathLength;
    if (!groupsByParent.has(parent.primitive)) groupsByParent.set(parent.primitive, []);
    const groups = groupsByParent.get(parent.primitive);
    let group = groups.find((candidate) => Math.abs(candidate.along - attachment) < 1e-5);
    if (!group) {
      group = { parent, along: attachment, children: [] };
      groups.push(group);
    }
    group.children.push(child);
  }
  const junctionPlans = [];
  for (const groups of groupsByParent.values()) {
    groups.sort((left, right) => left.along - right.along);
    groups.forEach((group, index) => {
      const parentRadius = group.parent.transform[7] * (
        1 + (group.parent.taper - 1) * group.along / group.parent.path.length
      );
      const before = index === 0 ? group.along : group.along - groups[index - 1].along;
      const after = index === groups.length - 1
        ? group.parent.path.length - group.along
        : groups[index + 1].along - group.along;
      const isTerminalSplit = after < 1e-5;
      const available = Math.min(
        Math.max(before * 0.28, 1e-5),
        isTerminalSplit ? Number.POSITIVE_INFINITY : Math.max(after * 0.28, 1e-5),
      );
      const half = Math.min(parentRadius * 1.35, available, group.parent.path.length * 0.08);
      const parentStart = Math.max(0, group.along - half);
      const parentEnd = isTerminalSplit ? group.along : Math.min(group.parent.path.length, group.along + half);
      group.parent.exclusions.push([parentStart, parentEnd]);
      const childStarts = group.children.map((child) => {
        const cut = Math.min(Math.max(half * 0.5, child.transform[7] * 0.75), child.path.length * 0.04);
        child.exclusions.push([0, cut]);
        return { child, cut };
      });
      junctionPlans.push({ ...group, parentStart, parentEnd, isTerminalSplit, childStarts });
    });
  }
  for (const record of woody) {
    const endpointChildren = (groupsByParent.get(record.primitive) ?? [])
      .filter((group) => record.path.length - group.along < 1e-5)
      .flatMap((group) => group.children);
    if (endpointChildren.length > 0) {
      const largestChild = Math.max(...endpointChildren.map((child) => child.transform[7]));
      record.endRadius = Math.min(
        record.transform[7] * 0.96,
        Math.max(record.endRadius, largestChild * 1.05),
      );
    }
  }
  const ringCache = new Map();
  function radiusAt(record, along) {
    return record.transform[7]
      + (record.endRadius - record.transform[7]) * along / record.path.length;
  }
  function barkSample(angle, barkAlong) {
    const detail = bark.detailProfile;
    const ridge = Math.sin(bark.ridgeCount * angle + bark.phase + barkAlong * bark.grainTurns)
      + 0.35 * Math.sin((bark.ridgeCount + 3) * angle - bark.phase * 0.7 + barkAlong * 9);
    const ridgeNoise = ridge / 1.35;
    const fissure = Math.pow(Math.max(0, Math.cos(
      (bark.ridgeCount - 1) * angle - bark.phase * 0.43
        + barkAlong * detail.fissureAxialFrequency,
    )), detail.fissureSharpness);
    const grain = Math.sin(barkAlong * detail.grainAxialFrequency + angle * 2 + bark.phase * 1.7);
    const microRidge = Math.sin(
      (bark.ridgeCount + 5) * angle + barkAlong * detail.microRidgeAxialFrequency
        - bark.phase * 0.35,
    );
    return {
      ridgeNoise,
      fissure,
      materialNoise: clamp(
        ridgeNoise * 0.44 + grain * 0.16 + microRidge * detail.microRidgeWeight
          - fissure * 1.18,
        -1,
        1,
      ),
      displacement: bark.ridgeAmplitude * (
        ridgeNoise + microRidge * detail.microRidgeWeight - fissure * 0.38
      ),
    };
  }
  function ring(record, along, sides = WOOD_RING_SIDES) {
    const key = `${record.primitive}:${along.toFixed(10)}:${sides}`;
    if (ringCache.has(key)) return ringCache.get(key);
    const state = samplePath(record.path, along);
    const [first, second] = parallelTransportBasis(record.path, along);
    const radius = radiusAt(record, along);
    const indices = [];
    const positions = [];
    builder.reserve(sides, 0);
    for (let side = 0; side < sides; side += 1) {
      const angle = Math.PI * 2 * side / sides;
      const radial = add(scale(first, Math.cos(angle)), scale(second, Math.sin(angle)));
      const barkAlong = record.baseBarkV + along / packet.targetPathLength;
      const field = barkSample(angle, barkAlong);
      const angleStep = 0.018;
      const alongStep = 0.0015;
      const angularSlope = (
        barkSample(angle + angleStep, barkAlong).displacement
        - barkSample(angle - angleStep, barkAlong).displacement
      ) / (2 * angleStep);
      const axialSlope = (
        barkSample(angle, barkAlong + alongStep).displacement
        - barkSample(angle, barkAlong - alongStep).displacement
      ) / (2 * alongStep) * radius / packet.targetPathLength;
      const circumferential = normalize(cross(state.tangent, radial));
      const surfaceNormal = normalize(add(
        add(radial, scale(circumferential, -angularSlope * bark.normalStrength)),
        scale(state.tangent, -axialSlope * bark.normalStrength),
      ));
      const ringRadius = radius * (1 + field.displacement);
      const axialOffset = 0;
      const position = add(
        add(state.point, scale(radial, ringRadius)),
        scale(state.tangent, axialOffset),
      );
      const vertexColor = record.color.map((value, channel) => (
        channel === 3 ? value : clamp(value + bark.colorVariation * field.materialNoise, 0, 1)
      ));
      indices.push(builder.vertex(
        position,
        surfaceNormal,
        vertexColor,
        clamp(record.roughness + bark.roughnessVariation
          * (field.fissure - field.ridgeNoise * 0.32), 0.42, 0.98),
        [side / sides, barkAlong],
      ));
      positions.push(position);
    }
    const created = { indices, positions, state, radius, barkV: record.baseBarkV + along / packet.targetPathLength };
    ringCache.set(key, created);
    return created;
  }
  function connectRings(first, second) {
    const firstCount = first.indices.length;
    const secondCount = second.indices.length;
    builder.reserve(0, (firstCount + secondCount) * 3);
    let firstSide = 0;
    let secondSide = 0;
    while (firstSide < firstCount || secondSide < secondCount) {
      const firstNext = (firstSide + 1) / firstCount;
      const secondNext = (secondSide + 1) / secondCount;
      const firstIndex = first.indices[firstSide % firstCount];
      const secondIndex = second.indices[secondSide % secondCount];
      if (Math.abs(firstNext - secondNext) < 1e-10) {
        const firstNextIndex = first.indices[(firstSide + 1) % firstCount];
        const secondNextIndex = second.indices[(secondSide + 1) % secondCount];
        builder.indices.push(
          firstIndex, firstNextIndex, secondIndex,
          firstNextIndex, secondNextIndex, secondIndex,
        );
        firstSide += 1;
        secondSide += 1;
      } else if (firstNext < secondNext) {
        builder.indices.push(firstIndex, first.indices[(firstSide + 1) % firstCount], secondIndex);
        firstSide += 1;
      } else {
        builder.indices.push(firstIndex, second.indices[(secondSide + 1) % secondCount], secondIndex);
        secondSide += 1;
      }
    }
  }
  function capRing(target, direction) {
    builder.reserve(1, target.indices.length * 3);
    const center = target.state.point;
    const centerIndex = builder.vertex(center, direction, [0.25, 0.13, 0.055, 1], 0.82, [0.5, target.barkV]);
    for (let side = 0; side < target.indices.length; side += 1) {
      const next = (side + 1) % target.indices.length;
      if (dot(direction, target.state.tangent) < 0) {
        builder.indices.push(centerIndex, target.indices[next], target.indices[side]);
      } else {
        builder.indices.push(centerIndex, target.indices[side], target.indices[next]);
      }
    }
  }
  const terminalPrimitives = new Set(woody.map(({ primitive }) => primitive));
  for (const child of woody) terminalPrimitives.delete(child.parent);
  for (const record of woody) {
    const exclusions = record.exclusions
      .sort((left, right) => left[0] - right[0]);
    const spans = [];
    let cursor = 0;
    for (const [start, end] of exclusions) {
      if (start > cursor + 1e-8) spans.push([cursor, start]);
      cursor = Math.max(cursor, end);
    }
    if (cursor < record.path.length - 1e-8) spans.push([cursor, record.path.length]);
    for (const [start, end] of spans) {
      const barkSteps = record.kind === KIND_TRUNK ? TRUNK_BARK_STEPS
        : record.kind === KIND_BRANCH ? 2 : 1;
      const uniformStations = Array.from({ length: barkSteps - 1 }, (_, step) => (
        start + (end - start) * (step + 1) / barkSteps
      ));
      const stations = [start, ...record.path.distances.filter((value) => (
        value > start + 1e-8 && value < end - 1e-8
      )), ...uniformStations, end].sort((left, right) => left - right)
        .filter((value, index, values) => index === 0 || value - values[index - 1] > 1e-8);
      let prior = ring(record, stations[0]);
      for (let stationIndex = 1; stationIndex < stations.length; stationIndex += 1) {
        const station = stations[stationIndex];
        const sides = stationIndex === stations.length - 1 ? WOOD_RING_SIDES
          : record.kind === KIND_TRUNK ? TRUNK_BARK_RING_SIDES
            : record.kind === KIND_BRANCH ? BRANCH_RING_SIDES : TWIG_RING_SIDES;
        const next = ring(record, station, sides);
        connectRings(prior, next);
        prior = next;
      }
    }
    if (record.kind === KIND_TRUNK) capRing(ring(record, 0), scale(samplePath(record.path, 0).tangent, -1));
    if (terminalPrimitives.has(record.primitive)) {
      capRing(ring(record, record.path.length), samplePath(record.path, record.path.length).tangent);
    }
  }
  const junctions = [];
  junctionPlans.forEach((plan, junctionIndex) => {
    const ports = [];
    ports.push({ role: 'incoming', record: plan.parent, along: plan.parentStart });
    if (!plan.isTerminalSplit) {
      ports.push({ role: 'continuation', record: plan.parent, along: plan.parentEnd });
    }
    for (const { child, cut } of plan.childStarts) {
      ports.push({ role: 'child', record: child, along: cut });
    }
    const portTargets = [];
    const metadataPorts = ports.map((port, portIndex) => {
      const target = ring(port.record, port.along);
      portTargets.push(target);
      return Object.freeze({
        role: port.role,
        primitive: port.record.primitive,
        radius: target.radius,
        tangent: Object.freeze([...target.state.tangent]),
        barkV: target.barkV,
        ringVertices: Object.freeze([...target.indices]),
      });
    });
    if (portTargets.length !== 3) {
      throw new RangeError('tree WebGPU junction must have three connected ports');
    }
    const forkSkin = appendPartitionedFork(
      builder,
      ports.map((port, index) => ({ target: portTargets[index], record: port.record })),
      samplePath(plan.parent.path, plan.along).point,
    );
    const partitionedBarkV = metadataPorts.reduce((sum, port) => sum + port.barkV, 0)
      / metadataPorts.length;
    const partitionedIncoming = metadataPorts.find((port) => port.role === 'incoming').tangent;
    junctions.push(Object.freeze({
      point: Object.freeze([...samplePath(plan.parent.path, plan.along).point]),
      ports: Object.freeze(metadataPorts),
      triangles: forkSkin.triangleCount,
      minimumRadialScale: forkSkin.minimumRadialScale,
      maximumRadialScale: forkSkin.maximumRadialScale,
      connectorComponents: forkSkin.connectorComponents,
      barkV: partitionedBarkV,
      maximumTangentTurn: Math.max(...metadataPorts
        .filter((port) => port.role !== 'incoming')
        .map((port) => angleBetween(partitionedIncoming, port.tangent))),
      maximumNormalSeamAngle: 0,
    }));
  });
  const edgeUse = new Map();
  for (let offset = 0; offset < builder.indices.length; offset += 3) {
    const triangle = builder.indices.slice(offset, offset + 3);
    for (let edge = 0; edge < 3; edge += 1) {
      const key = [triangle[edge], triangle[(edge + 1) % 3]].sort((a, b) => a - b).join(':');
      edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
    }
  }
  return {
    junctions: Object.freeze(junctions),
    topology: Object.freeze({
      ringSides: WOOD_RING_SIDES,
      trunkBarkSides: TRUNK_BARK_RING_SIDES,
      trunkBarkSteps: TRUNK_BARK_STEPS,
      branchSides: BRANCH_RING_SIDES,
      twigSides: TWIG_RING_SIDES,
      boundaryEdges: [...edgeUse.values()].filter((count) => count === 1).length,
      nonManifoldEdges: [...edgeUse.values()].filter((count) => count > 2).length,
      internalCaps: 0,
      endpointCaps: terminalPrimitives.size + 1,
      taperedSegments: woody.length,
      minimumTaper: Math.min(...woody.map((record) => record.endRadius / record.transform[7])),
      maximumTaper: Math.max(...woody.map((record) => record.endRadius / record.transform[7])),
      frameTransport: 'parallel-transport',
    }),
  };
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
  const veinColor = leafColor.map((value, channel) => (
    channel === 3 ? value : clamp(value + (channel === 1 ? 0.065 : -0.025), 0, 1)
  ));
  const petioleHalfWidth = Math.max(bladeWidth * 0.025, bladeLength * 0.008);
  const bladeBase = add(attachment, scale(longAxis, petioleLength));
  const base = builder.vertices.length / 10;
  builder.vertex(add(attachment, scale(wideAxis, -petioleHalfWidth)), normal, veinColor, roughness - 0.04, [0.48, 0]);
  builder.vertex(add(attachment, scale(wideAxis, petioleHalfWidth)), normal, veinColor, roughness - 0.04, [0.52, 0]);
  builder.vertex(add(bladeBase, scale(wideAxis, -petioleHalfWidth)), normal, veinColor, roughness - 0.04, [0.48, 0.16]);
  builder.vertex(add(bladeBase, scale(wideAxis, petioleHalfWidth)), normal, veinColor, roughness - 0.04, [0.52, 0.16]);
  builder.vertex(bladeBase, normal, veinColor, roughness - 0.08, [0.5, 0.16]);
  const stations = [0.42, 0.76];
  stations.forEach((station, stationIndex) => {
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
    const secondaryVein = (stationIndex % 2 === 0 ? 1 : -1) * 0.035;
    const edgeColor = leafColor.map((value, channel) => (
      channel === 3 ? value : clamp(value + (channel === 1 ? secondaryVein : secondaryVein * 0.35), 0, 1)
    ));
    const veinNormal = normalize(add(normal, scale(wideAxis, secondaryVein * 2.4)));
    builder.vertex(add(center, scale(wideAxis, -halfWidth)), normal, edgeColor, roughness + secondaryVein, [0, 0.18 + station * 0.82]);
    builder.vertex(center, veinNormal, veinColor, roughness - 0.08, [0.5, 0.18 + station * 0.82]);
    builder.vertex(add(center, scale(wideAxis, halfWidth)), normal, edgeColor, roughness - secondaryVein, [1, 0.18 + station * 0.82]);
  });
  const apex = add(
    add(bladeBase, scale(longAxis, bladeLength)),
    scale(normal, camber * 0.18),
  );
  builder.vertex(apex, normal, veinColor, roughness - 0.06, [0.5, 1]);
  addDoubleSidedQuad(builder.indices, base, base + 1, base + 3, base + 2);
  addDoubleSidedTriangle(builder.indices, base + 4, base + 5, base + 7);
  addDoubleSidedTriangle(builder.indices, base + 2, base + 5, base + 4);
  addDoubleSidedTriangle(builder.indices, base + 3, base + 4, base + 7);
  for (let station = 0; station < stations.length - 1; station += 1) {
    const first = base + 5 + station * 3;
    const next = first + 3;
    addDoubleSidedQuad(builder.indices, first, next, next + 1, first + 1);
    addDoubleSidedQuad(builder.indices, first + 1, next + 1, next + 2, first + 2);
  }
  const lastPair = base + 5 + (stations.length - 1) * 3;
  const apexIndex = base + LEAF_VERTEX_COUNT - 1;
  addDoubleSidedTriangle(builder.indices, lastPair, apexIndex, lastPair + 1);
  addDoubleSidedTriangle(builder.indices, lastPair + 1, apexIndex, lastPair + 2);
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
    roughness: new Float32Array(builder.roughness),
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
  const barkNode = conditionChild(root, { segment: 'bark', channel: 'bark-material' });
  const barkProfile = packet.profile?.bark;
  if (!barkProfile) throw new RangeError('tree species bark profile is required');
  const variantTotal = barkProfile.textureVariantWeights.reduce((sum, value) => sum + value, 0);
  let variantMark = hashString(packet.treeId, 0x85ebca6b) % variantTotal;
  let textureVariant = 0;
  while (variantMark >= barkProfile.textureVariantWeights[textureVariant]) {
    variantMark -= barkProfile.textureVariantWeights[textureVariant];
    textureVariant += 1;
  }
  const bark = Object.freeze({
    materialChannels: 'albedo+roughness+normal+radial-displacement',
    features: barkProfile.featureGrammar,
    textureVariant,
    ridgeCount: Math.round(boundedNormal(
      barkNode, 0, barkProfile.ridgeCountMean, barkProfile.ridgeCountDeviation,
      ...barkProfile.ridgeCountBounds,
    )),
    ridgeAmplitude: boundedNormal(
      barkNode, 1, barkProfile.ridgeAmplitudeMean, barkProfile.ridgeAmplitudeDeviation,
      ...barkProfile.ridgeAmplitudeBounds,
    ),
    phase: boundedNormal(barkNode, 2, Math.PI, 1.4, 0, Math.PI * 2),
    grainTurns: boundedNormal(barkNode, 3, 4.5, 0.8, 2.5, 6.5),
    roughnessVariation: barkProfile.roughnessVariation,
    colorVariation: barkProfile.colorVariation,
    normalStrength: barkProfile.normalStrength,
    detailProfile: Object.freeze({
      fissureSharpness: barkProfile.fissureSharpness,
      fissureAxialFrequency: barkProfile.fissureAxialFrequency,
      grainAxialFrequency: barkProfile.grainAxialFrequency,
      microRidgeWeight: barkProfile.microRidgeWeight,
      microRidgeAxialFrequency: barkProfile.microRidgeAxialFrequency,
    }),
  });
  const woodNetwork = appendWoodyNetwork(wood, packet, bark);
  const leafParameterValues = [];
  for (let primitive = 0; primitive < packet.primitiveCount; primitive += 1) {
    const kind = packet.primitiveKinds[primitive];
    const transform = packet.transforms.subarray(primitive * 8, primitive * 8 + 8);
    const color = Array.from(packet.baseColors.subarray(primitive * 4, primitive * 4 + 4));
    const roughness = packet.surfaceParams[primitive * 4];
    if (kind === KIND_FOLIAGE) {
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
    bark,
    leafMaterial: Object.freeze({
      channels: 'albedo+roughness+normal',
      features: Object.freeze(['central-vein', 'secondary-veins', 'multiscale-green']),
      translucency: 'unsupported-double-sided',
    }),
    junctions: woodNetwork.junctions,
    woodTopology: woodNetwork.topology,
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
