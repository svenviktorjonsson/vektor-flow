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
const LEAVES_PER_CLUSTER = 1;
const LEAF_PARAMETER_STRIDE = 9;
const LEAF_VERTEX_COUNT = 16;
const LEAF_INDEX_COUNT = 72;
const WOOD_RING_SIDES = 8;

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
    || counts.branches !== 14
    || counts.twigs < 48
    || counts.twigs > 93
    || counts.foliageClusters < counts.twigs * 9
    || counts.foliageClusters > counts.twigs * 17
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
      && (packet.primitiveKinds[parent] === KIND_BRANCH
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
    if (packet.primitiveKinds[index] === KIND_TWIG
      && ((leafParents.get(index) ?? 0) < 9 || leafParents.get(index) > 17)) {
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

function hullTriangles(points) {
  const position = (index) => points[index].position;
  const squaredDistance = (left, right) => dot(subtract(position(left), position(right)), subtract(position(left), position(right)));
  const first = 0;
  let second = 1;
  for (let index = 2; index < points.length; index += 1) {
    if (squaredDistance(first, index) > squaredDistance(first, second)) second = index;
  }
  const line = subtract(position(second), position(first));
  let third = -1;
  let thirdDistance = -1;
  for (let index = 0; index < points.length; index += 1) {
    if (index === first || index === second) continue;
    const area = Math.hypot(...cross(line, subtract(position(index), position(first))));
    if (area > thirdDistance) {
      thirdDistance = area;
      third = index;
    }
  }
  const planeNormal = cross(subtract(position(second), position(first)), subtract(position(third), position(first)));
  let fourth = -1;
  let fourthDistance = -1;
  for (let index = 0; index < points.length; index += 1) {
    if ([first, second, third].includes(index)) continue;
    const planeDistance = Math.abs(dot(planeNormal, subtract(position(index), position(first))));
    if (planeDistance > fourthDistance) {
      fourthDistance = planeDistance;
      fourth = index;
    }
  }
  if (third < 0 || fourth < 0 || !(thirdDistance > 1e-12) || !(fourthDistance > 1e-12)) {
    throw new RangeError('tree WebGPU junction ports must span a volume');
  }
  const inside = [first, second, third, fourth]
    .reduce((sum, index) => add(sum, position(index)), [0, 0, 0])
    .map((value) => value / 4);
  function face(a, b, c) {
    let vertices = [a, b, c];
    let normal = cross(subtract(position(b), position(a)), subtract(position(c), position(a)));
    if (dot(normal, subtract(inside, position(a))) > 0) {
      vertices = [a, c, b];
      normal = scale(normal, -1);
    }
    return { vertices, normal };
  }
  let faces = [
    face(first, second, third),
    face(first, fourth, second),
    face(second, fourth, third),
    face(third, fourth, first),
  ];
  const initial = new Set([first, second, third, fourth]);
  for (let candidate = 0; candidate < points.length; candidate += 1) {
    if (initial.has(candidate)) continue;
    const visible = faces.filter(({ vertices, normal }) => (
      dot(normal, subtract(position(candidate), position(vertices[0]))) > 1e-11
    ));
    if (visible.length === 0) continue;
    const visibleSet = new Set(visible);
    const horizon = new Map();
    for (const { vertices } of visible) {
      for (let edge = 0; edge < 3; edge += 1) {
        const a = vertices[edge];
        const b = vertices[(edge + 1) % 3];
        const key = [a, b].sort((left, right) => left - right).join(':');
        if (horizon.has(key)) horizon.delete(key);
        else horizon.set(key, [a, b]);
      }
    }
    faces = faces.filter((existing) => !visibleSet.has(existing));
    for (const [a, b] of horizon.values()) faces.push(face(b, a, candidate));
  }
  const openFaces = faces
    .map(({ vertices }) => vertices)
    .filter((vertices) => !(
      points[vertices[0]].port === points[vertices[1]].port
      && points[vertices[0]].port === points[vertices[2]].port
    ));
  const usedPortEdges = new Set();
  const kept = [];
  for (const vertices of openFaces) {
    const portEdges = [];
    for (let edge = 0; edge < 3; edge += 1) {
      const left = points[vertices[edge]];
      const right = points[vertices[(edge + 1) % 3]];
      const sideDelta = Math.abs(left.side - right.side);
      if (left.port === right.port && (sideDelta === 1 || sideDelta === WOOD_RING_SIDES - 1)) {
        portEdges.push([left.vertex, right.vertex].sort((a, b) => a - b).join(':'));
      }
    }
    if (portEdges.some((key) => usedPortEdges.has(key))) continue;
    kept.push(vertices);
    portEdges.forEach((key) => usedPortEdges.add(key));
  }
  return kept;
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
      const half = Math.min(parentRadius * 1.35, available);
      const parentStart = Math.max(0, group.along - half);
      const parentEnd = isTerminalSplit ? group.along : Math.min(group.parent.path.length, group.along + half);
      group.parent.exclusions.push([parentStart, parentEnd]);
      const childStarts = group.children.map((child) => {
        const cut = Math.min(Math.max(half, child.transform[7] * 1.5), child.path.length * 0.24);
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
  function ring(record, along, port = -1) {
    const key = `${record.primitive}:${along.toFixed(10)}`;
    if (ringCache.has(key)) return ringCache.get(key);
    const state = samplePath(record.path, along);
    const [first, second] = basis(state.tangent);
    const radius = radiusAt(record, along);
    const indices = [];
    const positions = [];
    builder.reserve(WOOD_RING_SIDES, 0);
    for (let side = 0; side < WOOD_RING_SIDES; side += 1) {
      const angle = Math.PI * 2 * side / WOOD_RING_SIDES;
      const radial = add(scale(first, Math.cos(angle)), scale(second, Math.sin(angle)));
      const barkAlong = record.baseBarkV + along / packet.targetPathLength;
      const ridge = Math.sin(bark.ridgeCount * angle + bark.phase + barkAlong * bark.grainTurns)
        + 0.35 * Math.sin((bark.ridgeCount + 3) * angle - bark.phase * 0.7 + barkAlong * 9);
      const noise = ridge / 1.35;
      const ringRadius = radius * (1 + bark.ridgeAmplitude * noise);
      const axialOffset = 0;
      const position = add(
        add(state.point, scale(radial, ringRadius)),
        scale(state.tangent, axialOffset),
      );
      const vertexColor = record.color.map((value, channel) => (
        channel === 3 ? value : clamp(value + bark.colorVariation * noise, 0, 1)
      ));
      indices.push(builder.vertex(
        position,
        radial,
        vertexColor,
        clamp(record.roughness + bark.roughnessVariation * noise, 0.42, 0.98),
        [side / WOOD_RING_SIDES, barkAlong],
      ));
      positions.push(position);
    }
    const created = { indices, positions, state, radius, barkV: record.baseBarkV + along / packet.targetPathLength };
    ringCache.set(key, created);
    return created;
  }
  function connectRings(first, second) {
    builder.reserve(0, WOOD_RING_SIDES * 6);
    for (let side = 0; side < WOOD_RING_SIDES; side += 1) {
      const next = (side + 1) % WOOD_RING_SIDES;
      builder.indices.push(
        first.indices[side], first.indices[next], second.indices[side],
        first.indices[next], second.indices[next], second.indices[side],
      );
    }
  }
  function capRing(target, direction) {
    builder.reserve(1, WOOD_RING_SIDES * 3);
    const center = target.state.point;
    const centerIndex = builder.vertex(center, direction, [0.25, 0.13, 0.055, 1], 0.82, [0.5, target.barkV]);
    for (let side = 0; side < WOOD_RING_SIDES; side += 1) {
      const next = (side + 1) % WOOD_RING_SIDES;
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
      const stations = [start, ...record.path.distances.filter((value) => (
        value > start + 1e-8 && value < end - 1e-8
      )), end];
      let prior = ring(record, stations[0]);
      for (const station of stations.slice(1)) {
        const next = ring(record, station);
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
      const target = ring(port.record, port.along, junctionIndex * 8 + portIndex);
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
    const icoVertices = [
      [-1, 1.618, 0], [1, 1.618, 0], [-1, -1.618, 0], [1, -1.618, 0],
      [0, -1, 1.618], [0, 1, 1.618], [0, -1, -1.618], [0, 1, -1.618],
      [1.618, 0, -1], [1.618, 0, 1], [-1.618, 0, -1], [-1.618, 0, 1],
    ];
    const icoFaces = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    const sphereVertices = icoVertices.map((vertex) => normalize(vertex));
    const midpointCache = new Map();
    function midpoint(left, right) {
      const key = [left, right].sort((a, b) => a - b).join(':');
      if (midpointCache.has(key)) return midpointCache.get(key);
      const index = sphereVertices.length;
      sphereVertices.push(normalize(add(sphereVertices[left], sphereVertices[right])));
      midpointCache.set(key, index);
      return index;
    }
    const sphereFaces = [];
    icoFaces.forEach(([first, second, third]) => {
      const firstSecond = midpoint(first, second);
      const secondThird = midpoint(second, third);
      const thirdFirst = midpoint(third, first);
      sphereFaces.push(
        [first, firstSecond, thirdFirst],
        [second, secondThird, firstSecond],
        [third, thirdFirst, secondThird],
        [firstSecond, secondThird, thirdFirst],
      );
    });
    const nodePoint = samplePath(plan.parent.path, plan.along).point;
    const coreRadius = Math.max(...portTargets.map(({ radius }) => radius));
    const portFrames = portTargets.map((target) => {
      const center = target.positions.reduce((sum, point) => add(sum, point), [0, 0, 0])
        .map((value) => value / WOOD_RING_SIDES);
      return { center, outward: normalize(subtract(center, nodePoint)) };
    });
    const faceDirections = sphereFaces.map((face) => normalize(face.reduce(
      (sum, vertex) => add(sum, sphereVertices[vertex]),
      [0, 0, 0],
    )));
    const candidatesByPort = portFrames.map(({ outward }) => (
      faceDirections.map((direction, faceIndex) => ({
        faceIndex,
        score: dot(direction, outward),
      })).sort((left, right) => right.score - left.score).slice(0, 14)
    ));
    let selectedFaces = null;
    let selectedScore = Number.NEGATIVE_INFINITY;
    for (const { faceIndex: firstFace } of candidatesByPort[0]) {
      for (const { faceIndex: secondFace } of candidatesByPort[1]) {
        if (sphereFaces[firstFace].some((vertex) => sphereFaces[secondFace].includes(vertex))) continue;
        for (const { faceIndex: thirdFace } of candidatesByPort[2]) {
          const used = [...sphereFaces[firstFace], ...sphereFaces[secondFace]];
          if (sphereFaces[thirdFace].some((vertex) => used.includes(vertex))) continue;
          const candidates = [firstFace, secondFace, thirdFace];
          const score = candidates.reduce((sum, faceIndex, portIndex) => (
            sum + dot(faceDirections[faceIndex], portFrames[portIndex].outward)
          ), 0);
          if (score > selectedScore) {
            selectedScore = score;
            selectedFaces = candidates;
          }
        }
      }
    }
    if (!selectedFaces) throw new RangeError('tree WebGPU junction ports cannot select disjoint collar faces');
    const holeFaces = selectedFaces.map((faceIndex) => sphereFaces[faceIndex]);
    const positions = sphereVertices.map((source) => add(
      nodePoint,
      scale(source, coreRadius * 0.72),
    ));
    holeFaces.forEach((face, portIndex) => {
      const target = portTargets[portIndex];
      const { outward } = portFrames[portIndex];
      const [first, second] = basis(target.state.tangent);
      const holeCenter = add(nodePoint, scale(outward, coreRadius * 0.62));
      face.forEach((vertex, corner) => {
        const angle = 2 * Math.PI * corner / 3;
        positions[vertex] = add(holeCenter, add(
          scale(first, target.radius * 0.7 * Math.cos(angle)),
          scale(second, target.radius * 0.7 * Math.sin(angle)),
        ));
      });
    });
    builder.reserve(positions.length, 0);
    const meanBarkV = metadataPorts.reduce((sum, port) => sum + port.barkV, 0) / metadataPorts.length;
    const coreIndices = positions.map((position, index) => {
      const normal = normalize(subtract(position, nodePoint));
      const source = metadataPorts[index % metadataPorts.length];
      const record = byPrimitive.get(source.primitive);
      return builder.vertex(position, normal, record.color, record.roughness, [index / positions.length, meanBarkV]);
    });
    const junctionTriangles = [];
    function queueTriangle(first, second, third) {
      junctionTriangles.push([first, second, third]);
    }
    function triangleOutwardScore([first, second, third]) {
      const point = (vertex) => builder.vertices.slice(vertex * 10, vertex * 10 + 3);
      const points = [point(first), point(second), point(third)];
      const normal = cross(subtract(points[1], points[0]), subtract(points[2], points[0]));
      const centroid = points.reduce((sum, value) => add(sum, value), [0, 0, 0])
        .map((value) => value / 3);
      return dot(normal, subtract(centroid, nodePoint));
    }
    const holeKeys = new Set(holeFaces.map((face) => [...face].sort((a, b) => a - b).join(':')));
    const coreFaces = sphereFaces.filter((face) => !holeKeys.has([...face].sort((a, b) => a - b).join(':')));
    builder.reserve(0, coreFaces.length * 3);
    coreFaces.forEach((face) => queueTriangle(...face.map((vertex) => coreIndices[vertex])));
    function stitchCycles(outer, inner) {
      let outerIndex = 0;
      let innerIndex = 0;
      builder.reserve(0, (outer.length + inner.length) * 3);
      while (outerIndex < outer.length || innerIndex < inner.length) {
        const outerNext = (outerIndex + 1) / outer.length;
        const innerNext = (innerIndex + 1) / inner.length;
        if (outerIndex < outer.length && (innerIndex >= inner.length || outerNext <= innerNext)) {
          queueTriangle(
            outer[outerIndex % outer.length],
            outer[(outerIndex + 1) % outer.length],
            inner[innerIndex % inner.length],
          );
          outerIndex += 1;
        } else {
          queueTriangle(
            outer[outerIndex % outer.length],
            inner[(innerIndex + 1) % inner.length],
            inner[innerIndex % inner.length],
          );
          innerIndex += 1;
        }
      }
    }
    holeFaces.forEach((face, portIndex) => {
      const outer = portTargets[portIndex].indices;
      const inner = face.map((vertex) => coreIndices[vertex]);
      const point = (vertex) => builder.vertices.slice(vertex * 10, vertex * 10 + 3);
      const candidates = [];
      for (const source of [inner, [...inner].reverse()]) {
        for (let rotation = 0; rotation < source.length; rotation += 1) {
          candidates.push([...source.slice(rotation), ...source.slice(0, rotation)]);
        }
      }
      const aligned = candidates.reduce((best, candidate) => {
        const score = outer.reduce((sum, vertex, side) => (
          sum + distance(point(vertex), point(candidate[Math.floor(side * candidate.length / outer.length)]))
        ), 0);
        return score < best.score ? { candidate, score } : best;
      }, { candidate: inner, score: Number.POSITIVE_INFINITY }).candidate;
      stitchCycles(outer, aligned);
    });
    const edgeTriangles = new Map();
    junctionTriangles.forEach((triangle, triangleIndex) => {
      for (let edge = 0; edge < 3; edge += 1) {
        const left = triangle[edge];
        const right = triangle[(edge + 1) % 3];
        const key = [left, right].sort((a, b) => a - b).join(':');
        if (!edgeTriangles.has(key)) edgeTriangles.set(key, []);
        edgeTriangles.get(key).push({ triangleIndex, left, right });
      }
    });
    const flips = new Array(junctionTriangles.length).fill(null);
    flips[0] = false;
    const pending = [0];
    while (pending.length > 0) {
      const triangleIndex = pending.pop();
      const triangle = junctionTriangles[triangleIndex];
      for (let edge = 0; edge < 3; edge += 1) {
        const left = triangle[edge];
        const right = triangle[(edge + 1) % 3];
        const key = [left, right].sort((a, b) => a - b).join(':');
        for (const neighbor of edgeTriangles.get(key)) {
          if (neighbor.triangleIndex === triangleIndex || flips[neighbor.triangleIndex] !== null) continue;
          const currentLeft = flips[triangleIndex] ? right : left;
          const currentRight = flips[triangleIndex] ? left : right;
          const sameDirection = neighbor.left === currentLeft && neighbor.right === currentRight;
          flips[neighbor.triangleIndex] = sameDirection;
          pending.push(neighbor.triangleIndex);
        }
      }
    }
    const oriented = junctionTriangles.map((triangle, index) => (
      flips[index] ? [triangle[0], triangle[2], triangle[1]] : triangle
    ));
    if (oriented.reduce((sum, triangle) => sum + triangleOutwardScore(triangle), 0) < 0) {
      oriented.forEach((triangle) => triangle.splice(1, 2, triangle[2], triangle[1]));
    }
    builder.indices.push(...oriented.flat());
    const triangleCount = coreFaces.length
      + portTargets.reduce((sum, target) => sum + target.indices.length + 3, 0);
    const incomingTangent = metadataPorts.find((port) => port.role === 'incoming').tangent;
    const maximumTangentTurn = Math.max(...metadataPorts
      .filter((port) => port.role !== 'incoming')
      .map((port) => angleBetween(incomingTangent, port.tangent)));
    junctions.push(Object.freeze({
      point: Object.freeze([...nodePoint]),
      ports: Object.freeze(metadataPorts),
      triangles: triangleCount,
      barkV: meanBarkV,
      maximumTangentTurn,
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
      boundaryEdges: [...edgeUse.values()].filter((count) => count === 1).length,
      nonManifoldEdges: [...edgeUse.values()].filter((count) => count > 2).length,
      internalCaps: 0,
      endpointCaps: terminalPrimitives.size + 1,
      taperedSegments: woody.length,
      minimumTaper: Math.min(...woody.map((record) => record.endRadius / record.transform[7])),
      maximumTaper: Math.max(...woody.map((record) => record.endRadius / record.transform[7])),
    }),
  };
}

function appendCylinder(
  builder, transform, color, roughness, sides, taper, bark, axialRings, centered = false,
  curve = null,
) {
  let origin = Array.from(transform.slice(0, 3));
  const direction = normalize(Array.from(transform.slice(3, 6)));
  const length = transform[6];
  const radius = transform[7];
  if (!(length > 0) || !(radius > 0)) {
    throw new RangeError('tree WebGPU cylinder dimensions must be positive');
  }
  if (centered) origin = add(origin, scale(direction, length * -0.5));
  const centers = curve?.points ?? Array.from({ length: axialRings }, (_, ring) => (
    add(origin, scale(direction, length * ring / (axialRings - 1)))
  ));
  const ringCount = centers.length;
  const segmentTangents = curve?.tangents ?? Array.from({ length: ringCount - 1 }, () => direction);
  const ringTangents = centers.map((_, ring) => {
    if (ring === 0) return segmentTangents[0];
    if (ring === ringCount - 1) return segmentTangents.at(-1);
    return normalize(add(segmentTangents[ring - 1], segmentTangents[ring]));
  });
  builder.reserve(sides * ringCount + 2, sides * ringCount * 6);
  const base = builder.vertices.length / 10;
  for (let ring = 0; ring < ringCount; ring += 1) {
    const along = ring / (ringCount - 1);
    const center = centers[ring];
    const [first, second] = basis(ringTangents[ring]);
    const nominalRadius = radius * (1 + (taper - 1) * along);
    for (let side = 0; side < sides; side += 1) {
      const angle = 2 * Math.PI * side / sides;
      const normal = add(scale(first, Math.cos(angle)), scale(second, Math.sin(angle)));
      const ridge = Math.sin(bark.ridgeCount * angle + bark.phase + along * bark.grainTurns)
        + 0.35 * Math.sin((bark.ridgeCount + 3) * angle - bark.phase * 0.7 + along * 9);
      const noise = ridge / 1.35;
      const ringRadius = nominalRadius * (1 + bark.ridgeAmplitude * noise);
      const vertexColor = color.map((value, channel) => (
        channel === 3 ? value : clamp(value + bark.colorVariation * noise, 0, 1)
      ));
      builder.vertex(
        add(center, scale(normal, ringRadius)),
        normal,
        vertexColor,
        clamp(roughness + bark.roughnessVariation * noise, 0.42, 0.98),
        [side / sides, along],
      );
    }
  }
  const end = centers.at(-1);
  const bottom = builder.vertex(centers[0], scale(ringTangents[0], -1), color, roughness, [0.5, 0.5]);
  const top = builder.vertex(end, ringTangents.at(-1), color, roughness, [0.5, 0.5]);
  for (let ring = 0; ring < ringCount - 1; ring += 1) {
    for (let side = 0; side < sides; side += 1) {
      const next = (side + 1) % sides;
      const lower = base + ring * sides + side;
      const lowerNext = base + ring * sides + next;
      const upper = lower + sides;
      const upperNext = lowerNext + sides;
      builder.indices.push(lower, lowerNext, upper, lowerNext, upperNext, upper);
    }
  }
  for (let side = 0; side < sides; side += 1) {
    const next = (side + 1) % sides;
    builder.indices.push(bottom, base + next, base + side);
    const upper = base + (ringCount - 1) * sides;
    builder.indices.push(top, upper + side, upper + next);
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
