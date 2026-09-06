import {
  conditionChild,
  createConditionedRoot,
  sampleBoundedUniform,
  sampleNormalReference,
} from './vf-conditioned-distribution.mjs';
import { treeSpeciesProfileReference } from './vf-tree-species-profile.mjs';

const plannerState = new WeakMap();
const floatBitsBuffer = new ArrayBuffer(8);
const floatBitsView = new DataView(floatBitsBuffer);
const MAX_DEMANDED_TREES = 4096;
const MAX_PRIMITIVE_BUDGET = 65536;
const MAX_CACHED_TREES = MAX_DEMANDED_TREES * 2;
const SPLIT_DEPTH = 5;
const KIND_TRUNK = 0;
const KIND_CROWN = 1;
const KIND_BRANCH = 2;
const KIND_FOLIAGE = 3;
const KIND_TWIG = 4;

function float64Key(value) {
  floatBitsView.setFloat64(0, value, true);
  return `${floatBitsView.getUint32(4, true).toString(16)}:${floatBitsView.getUint32(0, true).toString(16)}`;
}

function requireForestWorkingSet(forest) {
  if (
    !forest
    || forest.kind !== 'forest-patch-working-set:v1'
    || !Array.isArray(forest.treeIds)
    || !(forest.positions instanceof Float32Array)
    || !(forest.growth instanceof Float32Array)
    || !(forest.rotations instanceof Float32Array)
    || !(forest.speciesIndices instanceof Uint32Array)
    || forest.positions.length !== forest.treeIds.length * 3
    || forest.growth.length !== forest.treeIds.length * 4
    || forest.rotations.length !== forest.treeIds.length
    || forest.speciesIndices.length !== forest.treeIds.length
  ) {
    throw new TypeError('forest patch working set is required');
  }
}

function requireDemand(forest, treeIndices, detailLevels, primitiveBudget) {
  const indicesTyped = ArrayBuffer.isView(treeIndices) && !(treeIndices instanceof DataView);
  const levelsTyped = ArrayBuffer.isView(detailLevels) && !(detailLevels instanceof DataView);
  if ((!Array.isArray(treeIndices) && !indicesTyped) || treeIndices.length > MAX_DEMANDED_TREES) {
    throw new RangeError(`tree geometry demand must contain at most ${MAX_DEMANDED_TREES} indices`);
  }
  if ((!Array.isArray(detailLevels) && !levelsTyped) || detailLevels.length !== treeIndices.length) {
    throw new TypeError('tree geometry detail levels must parallel tree indices');
  }
  const canonical = new Map();
  for (let demandIndex = 0; demandIndex < treeIndices.length; demandIndex += 1) {
    const treeIndex = treeIndices[demandIndex];
    const detailLevel = detailLevels[demandIndex];
    if (!Number.isSafeInteger(treeIndex) || treeIndex < 0 || treeIndex >= forest.treeCount) {
      throw new RangeError(`tree geometry index[${demandIndex}] is outside the forest working set`);
    }
    if (!Number.isSafeInteger(detailLevel) || detailLevel < 0 || detailLevel > 2) {
      throw new RangeError(`tree geometry detailLevel[${demandIndex}] must be in [0, 2]`);
    }
    canonical.set(treeIndex, Math.max(detailLevel, canonical.get(treeIndex) ?? 0));
  }
  if (!Number.isSafeInteger(primitiveBudget) || primitiveBudget < 0) {
    throw new RangeError('tree primitive budget must be a non-negative safe integer');
  }
  if (primitiveBudget > MAX_PRIMITIVE_BUDGET) {
    throw new RangeError(`tree primitive budget exceeds ${MAX_PRIMITIVE_BUDGET}`);
  }
  return [...canonical]
    .sort(([first], [second]) => first - second)
    .map(([treeIndex, detailLevel]) => ({ treeIndex, detailLevel }));
}

function sample(node, sampleIndex, lane, minimum, maximum) {
  return sampleBoundedUniform(node, [sampleIndex, lane], {
    min: minimum,
    max: maximum,
  });
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalize(vector) {
  const length = Math.hypot(...vector);
  if (!(length > 1.0e-12)) throw new RangeError('tree branch direction must be non-zero');
  return vector.map((value) => value / length);
}

function branchNode(tree, path) {
  return conditionChild(tree.node, {
    segment: `branch:${path.join('.')}`,
    channel: 'branch-geometry',
  });
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function directionBasis(direction) {
  const axis = Math.abs(direction[2]) < 0.92 ? [0, 0, 1] : [1, 0, 0];
  const first = normalize(cross(axis, direction));
  return [first, normalize(cross(direction, first))];
}

function rotateFrom(direction, angle, azimuth) {
  const [first, second] = directionBasis(direction);
  const radial = first.map((value, axis) => (
    value * Math.cos(azimuth) + second[axis] * Math.sin(azimuth)
  ));
  return normalize(direction.map((value, axis) => (
    value * Math.cos(angle) + radial[axis] * Math.sin(angle)
  )));
}

function boundedNormal(node, lane, mean, standardDeviation, minimum, maximum) {
  return clamp(
    sampleNormalReference(node, [0, lane], { mean, standardDeviation }),
    minimum,
    maximum,
  );
}

function ellipsoidCoordinates(envelope, point) {
  const dx = point[0] - envelope.center[0];
  const dy = point[1] - envelope.center[1];
  const cosine = Math.cos(envelope.orientation);
  const sine = Math.sin(envelope.orientation);
  return [
    dx * cosine + dy * sine,
    -dx * sine + dy * cosine,
    point[2] - envelope.center[2],
  ];
}

function ellipsoidDirection(envelope, direction) {
  const cosine = Math.cos(envelope.orientation);
  const sine = Math.sin(envelope.orientation);
  return [
    direction[0] * cosine + direction[1] * sine,
    -direction[0] * sine + direction[1] * cosine,
    direction[2],
  ];
}

function maximumEnvelopeRay(envelope, origin, direction, margin) {
  const localOrigin = ellipsoidCoordinates(envelope, origin);
  const localDirection = ellipsoidDirection(envelope, direction);
  const axes = envelope.axes.map((axis) => Math.max(axis - margin, axis * 0.35));
  let a = 0;
  let b = 0;
  let c = -1;
  for (let axis = 0; axis < 3; axis += 1) {
    const inverseAxis2 = 1 / (axes[axis] * axes[axis]);
    a += localDirection[axis] * localDirection[axis] * inverseAxis2;
    b += 2 * localOrigin[axis] * localDirection[axis] * inverseAxis2;
    c += localOrigin[axis] * localOrigin[axis] * inverseAxis2;
  }
  const discriminant = Math.max(0, b * b - 4 * a * c);
  return Math.max(0, (-b + Math.sqrt(discriminant)) / (2 * a));
}

function constrainToEnvelope(tree, node, origin, direction, desiredLength, radius) {
  const maximumLength = maximumEnvelopeRay(tree.envelope, origin, direction, radius * 1.2);
  const attraction = sample(
    node, 0, 9,
    tree.profile.crownEnvelope.localAttractionBounds[0],
    tree.profile.crownEnvelope.localAttractionBounds[1],
  );
  return {
    direction,
    length: Math.min(desiredLength, maximumLength * (0.9 + attraction * 0.08)),
    attraction,
    envelopeLimited: maximumLength < desiredLength,
  };
}

function distance(left, right) {
  return Math.hypot(...left.map((value, axis) => value - right[axis]));
}

function angleBetween(left, right) {
  return Math.acos(clamp(
    left.reduce((sum, value, axis) => sum + value * right[axis], 0), -1, 1,
  ));
}

function insideEnvelope(tree, point, radius) {
  const local = ellipsoidCoordinates(tree.envelope, point);
  return local.reduce((sum, value, axis) => {
    const safeAxis = Math.max(tree.envelope.axes[axis] - radius * 1.2,
      tree.envelope.axes[axis] * 0.35);
    return sum + (value / safeAxis) ** 2;
  }, 0) <= 1;
}

function curvedPath(tree, node, origin, direction, maximumArcLength, radius, kind) {
  const profile = tree.profile.curvature;
  const relativeRadius = clamp(radius / tree.growth[0], 0, 1);
  const turnDeviation = profile.trunkDeviation
    + profile.radiusDeviationRise * Math.pow(1 - relativeRadius, profile.radiusExponent);
  const stepKey = kind === KIND_TRUNK ? 'trunk' : kind === KIND_TWIG ? 'twig' : 'branch';
  const stepCount = profile.steps[stepKey];
  const [first, second] = directionBasis(direction);
  const innovations = [];
  let yaw = 0;
  let pitch = 0;
  const innovationScale = Math.sqrt(1 - profile.correlation ** 2);
  for (let step = 1; step < stepCount; step += 1) {
    yaw = profile.correlation * yaw + innovationScale * sampleNormalReference(
      node, [step, 20], { mean: profile.meanTurn, standardDeviation: turnDeviation },
    );
    pitch = profile.correlation * pitch + innovationScale * sampleNormalReference(
      node, [step, 21], { mean: profile.meanTurn, standardDeviation: turnDeviation },
    );
    innovations.push([yaw, pitch]);
  }
  function realize(deviationScale) {
    const points = [origin];
    for (let step = 1; step < stepCount; step += 1) {
      const along = step / stepCount;
      const envelope = Math.sin(Math.PI * along);
      const [stepYaw, stepPitch] = innovations[step - 1];
      points.push(origin.map((value, axis) => (
        value
        + direction[axis] * maximumArcLength * along
        + first[axis] * maximumArcLength * stepYaw * envelope * deviationScale
        + second[axis] * maximumArcLength * stepPitch * envelope * deviationScale
      )));
    }
    points.push(origin.map((value, axis) => value + direction[axis] * maximumArcLength));
    return points;
  }
  let deviationScale = 1;
  let points = realize(deviationScale);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const tangents = points.slice(1).map((point, index) => normalize(
      point.map((value, axis) => value - points[index][axis]),
    ));
    const turns = tangents.slice(1).map((tangent, index) => angleBetween(tangents[index], tangent));
    const maximumTurn = Math.max(0, ...turns);
    const contained = points.every((point) => insideEnvelope(tree, point, radius));
    if (maximumTurn <= profile.maximumTurn && contained) break;
    deviationScale *= Math.min(0.72, profile.maximumTurn / Math.max(maximumTurn, 1e-9) * 0.88);
    points = realize(deviationScale);
  }
  let arcLength = points.slice(1).reduce((sum, point, index) => (
    sum + distance(points[index], point)
  ), 0);
  if (arcLength > maximumArcLength) {
    const scaleDown = maximumArcLength / arcLength;
    points = points.map((point) => origin.map((value, axis) => (
      value + (point[axis] - value) * scaleDown
    )));
    arcLength = maximumArcLength;
  }
  const tangents = points.slice(1).map((point, index) => normalize(
    point.map((value, axis) => value - points[index][axis]),
  ));
  const turns = tangents.slice(1).map((tangent, index) => angleBetween(tangents[index], tangent));
  return Object.freeze({
    points: Object.freeze(points.map((point) => Object.freeze(point))),
    tangents: Object.freeze(tangents.map((tangent) => Object.freeze(tangent))),
    turns: Object.freeze(turns),
    turnSignals: Object.freeze(innovations.map((turn) => Object.freeze(turn))),
    turnDeviation,
    correlation: profile.correlation,
    maximumTurn: profile.maximumTurn,
    arcLength,
    chordLength: distance(points[0], points.at(-1)),
  });
}

function primitiveEndpoint(primitive) {
  if (primitive.curve) return primitive.curve.points.at(-1);
  return pointAlong(primitive.transform, 1, primitive.kind === KIND_TRUNK);
}

function pointAlongPrimitive(primitive, along) {
  if (!primitive.curve) {
    return { point: pointAlong(primitive.transform, along, primitive.kind === KIND_TRUNK),
      tangent: primitive.transform.slice(3, 6) };
  }
  const target = primitive.curve.arcLength * along;
  let consumed = 0;
  for (let segment = 0; segment < primitive.curve.tangents.length; segment += 1) {
    const start = primitive.curve.points[segment];
    const end = primitive.curve.points[segment + 1];
    const segmentLength = distance(start, end);
    if (consumed + segmentLength >= target || segment === primitive.curve.tangents.length - 1) {
      const fraction = clamp((target - consumed) / segmentLength, 0, 1);
      return {
        point: start.map((value, axis) => value + (end[axis] - value) * fraction),
        tangent: primitive.curve.tangents[segment],
      };
    }
    consumed += segmentLength;
  }
  throw new RangeError('tree curve must contain at least one segment');
}

function pointAlong(transform, along, centered = false) {
  const start = centered
    ? transform.slice(0, 3).map((value, axis) => (
      value - transform[axis + 3] * transform[6] * 0.5
    ))
    : transform.slice(0, 3);
  return start.map((value, axis) => value + transform[axis + 3] * transform[6] * along);
}

function primitive(id, kind, level, parentId, transform, metadata = {}) {
  return Object.freeze({
    id,
    kind,
    level,
    parentId,
    transform: Object.freeze(transform),
    ...metadata,
  });
}

function treeCacheKey(forest, treeIndex) {
  const growthOffset = treeIndex * 4;
  return [
    forest.treeIds[treeIndex],
    ...Array.from(forest.positions.subarray(treeIndex * 3, treeIndex * 3 + 3), float64Key),
    ...Array.from(forest.growth.subarray(growthOffset, growthOffset + 4), float64Key),
    forest.speciesIndices[treeIndex],
  ].join('/');
}

function treeRealization(state, forest, treeIndex) {
  const cacheKey = treeCacheKey(forest, treeIndex);
  const cached = state.treeCache.get(cacheKey);
  if (cached) {
    state.treeCache.delete(cacheKey);
    state.treeCache.set(cacheKey, cached);
    return cached;
  }
  const treeId = forest.treeIds[treeIndex];
  const speciesIndex = forest.speciesIndices[treeIndex];
  const profile = treeSpeciesProfileReference(speciesIndex);
  const position = Array.from(forest.positions.subarray(treeIndex * 3, treeIndex * 3 + 3));
  const growth = Array.from(forest.growth.subarray(treeIndex * 4, treeIndex * 4 + 4));
  const node = conditionChild(state.geometryNode, {
    segment: `geometry:${treeId}`,
    channel: 'tree-geometry',
  });
  const traitsNode = conditionChild(node, { segment: 'species-traits', channel: 'tree-traits' });
  const targetPathLength = growth[1] * boundedNormal(
    traitsNode, 0, profile.pathLength.scaleMean, profile.pathLength.scaleDeviation,
    ...profile.pathLength.scaleBounds,
  );
  const axes = profile.crownEnvelope.axisScaleMean.map((mean, axis) => (
    (axis === 2 ? growth[1] : growth[2]) * boundedNormal(
      traitsNode, axis + 1, mean, profile.crownEnvelope.axisScaleDeviation[axis],
      mean * 0.78, mean * 1.22,
    )
  ));
  const centerHeight = boundedNormal(
    traitsNode, 4, profile.crownEnvelope.centerHeightMean,
    profile.crownEnvelope.centerHeightDeviation, 0.42, 0.62,
  );
  const horizontalBias = profile.crownEnvelope.centerHorizontalDeviation * growth[2];
  axes[0] = Math.max(axes[0], horizontalBias + growth[0] * 1.4);
  axes[1] = Math.max(axes[1], horizontalBias + growth[0] * 1.4);
  axes[2] = Math.max(axes[2], growth[1] * centerHeight + growth[0] * 1.4);
  const centerAzimuth = sample(traitsNode, 0, 5, 0, Math.PI * 2);
  const tree = {
    id: treeId,
    treeIndex,
    speciesIndex,
    profile,
    node,
    position,
    growth,
    targetPathLength,
    terminalRadius: growth[0] * 0.001,
    envelope: Object.freeze({
      center: Object.freeze([
        position[0] + Math.cos(centerAzimuth) * horizontalBias,
        position[1] + Math.sin(centerAzimuth) * horizontalBias,
        position[2] + growth[1] * centerHeight,
      ]),
      axes: Object.freeze(axes),
      orientation: forest.rotations[treeIndex] + boundedNormal(
        traitsNode, 6, 0, profile.crownEnvelope.orientationDeviation, -0.85, 0.85,
      ),
    }),
    levels: new Map(),
  };
  state.treeCache.set(cacheKey, tree);
  if (state.treeCache.size > MAX_CACHED_TREES) {
    state.treeCache.delete(state.treeCache.keys().next().value);
  }
  return tree;
}

function realizeCoarse(tree) {
  const [x, y, z] = tree.position;
  const [trunkRadius, height, crownRadius, crownHeight] = tree.growth;
  const trunkNode = branchNode(tree, ['root']);
  const trunkLength = tree.targetPathLength * boundedNormal(
    trunkNode, 0,
    tree.profile.pathLength.rootConsumptionMean,
    tree.profile.pathLength.rootConsumptionDeviation,
    0.24, 0.38,
  );
  const trunkCurve = curvedPath(tree, trunkNode, [x, y, z], [0, 0, 1],
    trunkLength, trunkRadius, KIND_TRUNK);
  const trunkEnd = trunkCurve.points.at(-1);
  const trunkDirection = normalize(trunkEnd.map((value, axis) => value - tree.position[axis]));
  const remaining = tree.targetPathLength - trunkCurve.arcLength;
  return Object.freeze([
    primitive(
      `${tree.id}:trunk`,
      KIND_TRUNK,
      0,
      null,
      [
        (x + trunkEnd[0]) * 0.5,
        (y + trunkEnd[1]) * 0.5,
        (z + trunkEnd[2]) * 0.5,
        ...trunkDirection,
        trunkCurve.chordLength,
        trunkRadius,
      ],
      {
        generation: 0,
        curve: trunkCurve,
        arcLength: trunkCurve.arcLength,
        pathTarget: tree.targetPathLength,
        pathRemainingBefore: tree.targetPathLength,
        pathRemainingAfter: remaining,
      },
    ),
    primitive(
      `${tree.id}:crown`,
      KIND_CROWN,
      0,
      null,
      [x, y, z + height - crownHeight * 0.5, 0, 0, 1, crownHeight, crownRadius],
    ),
  ]);
}

function splitChildren(tree, parent, path, generation) {
  const node = branchNode(tree, ['split', ...path]);
  const parentDirection = parent.curve?.tangents.at(-1) ?? parent.transform.slice(3, 6);
  const profile = tree.profile;
  const mainAngle = boundedNormal(
    node, 1, profile.split.mainAngleMean, profile.split.mainAngleDeviation,
    ...profile.split.mainAngleBounds,
  );
  const lateralAngle = boundedNormal(
    node, 2, profile.split.lateralAngleMean, profile.split.lateralAngleDeviation,
    ...profile.split.lateralAngleBounds,
  );
  const azimuth = sample(node, 0, 3, 0, Math.PI * 2);
  const loss = boundedNormal(
    node, 4, profile.split.areaLossMean, profile.split.areaLossDeviation,
    ...profile.split.areaLossBounds,
  );
  const mainShare = boundedNormal(
    node, 5, profile.split.mainAreaShareMean, profile.split.mainAreaShareDeviation,
    ...profile.split.mainAreaShareBounds,
  );
  const parentRadius = parent.transform[7];
  const origin = primitiveEndpoint(parent);
  const childKind = generation >= SPLIT_DEPTH - 1 ? KIND_TWIG : KIND_BRANCH;
  const childLevel = generation === 1 ? 1 : 2;
  const roles = [
    ['main', mainAngle, azimuth, mainShare, profile.split.mainBudgetRatio, 6],
    ['lateral', lateralAngle, azimuth + Math.PI, 1 - mainShare,
      profile.split.lateralBudgetRatio, 7],
  ];
  return Object.freeze(roles.map(([role, angle, childAzimuth, share, budgetBounds, lane]) => {
    const pathBefore = parent.pathRemainingAfter * sample(node, 0, lane, ...budgetBounds);
    const terminal = generation === SPLIT_DEPTH;
    const desiredLength = pathBefore * boundedNormal(
      node, lane + 10, terminal ? 0.91 : 0.39 + generation * 0.065, 0.045,
      terminal ? 0.82 : 0.34, terminal ? 0.98 : 0.66,
    );
    const allocatedRadius = parentRadius * Math.sqrt(loss * share);
    const constrained = constrainToEnvelope(
      tree, node, origin, rotateFrom(parentDirection, angle, childAzimuth),
      desiredLength, allocatedRadius,
    );
    const curve = curvedPath(tree, node, origin, constrained.direction,
      constrained.length, allocatedRadius, childKind);
    const pathAfter = Math.max(0, pathBefore - curve.arcLength);
    const radiusFactor = clamp(Math.sqrt(pathAfter / tree.targetPathLength) * 1.55, 0, 1);
    const radius = Math.max(tree.terminalRadius, allocatedRadius * Math.max(0.04, radiusFactor));
    const splitAngle = Math.acos(clamp(
      parentDirection.reduce((sum, value, axis) => sum + value * constrained.direction[axis], 0),
      -1, 1,
    ));
    return primitive(
      `${tree.id}:branch:g${generation}:${path.join('.')}:${role}`,
      childKind,
      childLevel,
      parent.id,
      [...origin, ...constrained.direction, curve.chordLength, radius],
      {
        generation,
        curve,
        arcLength: curve.arcLength,
        splitRole: role,
        splitAngle,
        splitLoss: loss,
        localAttraction: constrained.attraction,
        envelopeLimited: constrained.envelopeLimited,
        pathTarget: tree.targetPathLength,
        pathRemainingBefore: pathBefore,
        pathRemainingAfter: pathAfter,
      },
    );
  }));
}

function realizeBranches(tree) {
  return splitChildren(tree, realizeLevel(tree, 0)[0], [0], 1);
}

function lateralTwigShoots(tree, parent, parentIndex) {
  const shoots = [];
  const profile = tree.profile.twig;
  const relativeRadius = clamp(parent.transform[7] / tree.growth[0], 0, 1);
  const probability = profile.shootProbabilityFloor
    + profile.shootProbabilityRise * Math.pow(1 - relativeRadius, profile.shootProbabilityExponent);
  for (let slot = 0; slot < profile.shootSlots; slot += 1) {
    const node = branchNode(tree, ['shoot', parentIndex, slot]);
    if (sample(node, 0, 0, 0, 1) >= probability) continue;
    const attachmentMinimum = parent.kind === KIND_TRUNK ? 0.55 : 0.12;
    const attachment = sample(node, 0, 1, attachmentMinimum, 0.9);
    const attachmentFrame = pointAlongPrimitive(parent, attachment);
    const origin = attachmentFrame.point;
    const angle = boundedNormal(
      node, 2, profile.shootAngleMean, profile.shootAngleDeviation,
      ...profile.shootAngleBounds,
    );
    const azimuth = sample(node, 0, 3, 0, Math.PI * 2);
    const pathBefore = parent.pathRemainingAfter * sample(node, 0, 4, 0.14, 0.22);
    const radius = Math.max(
      tree.terminalRadius,
      parent.transform[7] * sample(node, 0, 5, ...profile.shootRadiusRatioBounds),
    );
    const constrained = constrainToEnvelope(
      tree,
      node,
      origin,
      rotateFrom(attachmentFrame.tangent, angle, azimuth),
      pathBefore * sample(node, 0, 6, ...profile.shootLengthRatioBounds),
      radius,
    );
    if (!(constrained.length > tree.targetPathLength * 1e-5)) continue;
    const curve = curvedPath(tree, node, origin, constrained.direction,
      constrained.length, radius, KIND_TWIG);
    shoots.push(primitive(
      `${tree.id}:branch:shoot:${parentIndex}:${slot}`,
      KIND_TWIG,
      2,
      parent.id,
      [...origin, ...constrained.direction, curve.chordLength, radius],
      {
        generation: parent.generation + 1,
        curve,
        arcLength: curve.arcLength,
        twigClass: 'lateral-shoot',
        emergenceProbability: probability,
        normalizedParentPosition: attachment,
        localAttraction: constrained.attraction,
        envelopeLimited: constrained.envelopeLimited,
        pathTarget: tree.targetPathLength,
        pathRemainingBefore: pathBefore,
        pathRemainingAfter: Math.max(0, pathBefore - curve.arcLength),
      },
    ));
  }
  return shoots;
}

function realizeFine(tree, firstGeneration) {
  const [, , , crownHeight] = tree.growth;
  const branches = [];
  const twigs = [];
  const foliage = [];
  let frontier = firstGeneration;
  for (let generation = 2; generation <= SPLIT_DEPTH; generation += 1) {
    const next = [];
    frontier.forEach((parent, parentIndex) => {
      next.push(...splitChildren(tree, parent, [generation, parentIndex], generation));
    });
    if (generation >= SPLIT_DEPTH - 1) twigs.push(...next);
    else branches.push(...next);
    frontier = next;
  }
  const structuralParents = [realizeLevel(tree, 0)[0], ...firstGeneration, ...branches];
  structuralParents.forEach((parent, parentIndex) => {
    twigs.push(...lateralTwigShoots(tree, parent, parentIndex));
  });
  twigs.forEach((twig, twigIndex) => {
    const node = branchNode(tree, ['foliage', twigIndex]);
    const foliageCount = Math.round(boundedNormal(
      node, 0,
      tree.profile.twig.leafCountMean,
      tree.profile.twig.leafCountDeviation,
      ...tree.profile.twig.leafCountBounds,
    ));
    const radius = crownHeight * sample(node, 0, 5, ...tree.profile.twig.leafScaleBounds);
    for (let foliageIndex = 0; foliageIndex < foliageCount; foliageIndex += 1) {
      const foliageNode = branchNode(tree, ['foliage', twigIndex, foliageIndex]);
      const attachment = tree.profile.twig.attachmentBounds[0]
        + (tree.profile.twig.attachmentBounds[1] - tree.profile.twig.attachmentBounds[0])
          * (foliageIndex + sample(foliageNode, 0, 1, 0.16, 0.84)) / foliageCount;
      const attachmentFrame = pointAlongPrimitive(twig, attachment);
      foliage.push(primitive(
        `${twig.id}:foliage:${foliageIndex}`,
        KIND_FOLIAGE,
        2,
        twig.id,
        [
          ...attachmentFrame.point,
          ...attachmentFrame.tangent,
          twig.transform[6] * sample(foliageNode, 0, 2, 0.12, 0.24),
          radius,
        ],
        { normalizedTwigPosition: attachment },
      ));
    }
  });
  return Object.freeze([...branches, ...twigs, ...foliage]);
}

function realizeLevel(tree, level) {
  const cached = tree.levels.get(level);
  if (cached) return cached;
  let records;
  if (level === 0) records = realizeCoarse(tree);
  else if (level === 1) records = realizeBranches(tree);
  else records = realizeFine(tree, realizeLevel(tree, 1));
  tree.levels.set(level, records);
  return records;
}

export function createTreeGeometryPlannerReference(identity) {
  const root = createConditionedRoot(identity);
  const planner = Object.freeze({
    kind: 'tree-geometry-planner:v1',
    identity: root,
    maxDetailLevel: 2,
  });
  plannerState.set(planner, {
    geometryNode: conditionChild(root, {
      segment: 'forest:tree-geometry:v1',
      channel: 'geometry-plan',
    }),
    treeCache: new Map(),
  });
  return planner;
}

export function planTreeGeometryReference(
  planner,
  forest,
  { treeIndices, detailLevels, primitiveBudget },
) {
  const state = plannerState.get(planner);
  if (!state) throw new TypeError('tree geometry planner is required');
  requireForestWorkingSet(forest);
  const demands = requireDemand(forest, treeIndices, detailLevels, primitiveBudget);
  const selected = [];
  const selectedIds = new Map();
  const treePrimitives = new Map();
  for (let level = 0; level <= 2 && selected.length < primitiveBudget; level += 1) {
    for (const demand of demands) {
      if (demand.detailLevel < level || selected.length >= primitiveBudget) continue;
      const tree = treeRealization(state, forest, demand.treeIndex);
      for (const record of realizeLevel(tree, level)) {
        if (selected.length >= primitiveBudget) break;
        if (record.parentId != null && !selectedIds.has(record.parentId)) continue;
        selectedIds.set(record.id, selected.length);
        selected.push({ record, treeIndex: demand.treeIndex });
        if (!treePrimitives.has(demand.treeIndex)) treePrimitives.set(demand.treeIndex, []);
        treePrimitives.get(demand.treeIndex).push(record);
      }
    }
  }
  const primitiveCount = selected.length;
  const primitiveIds = [];
  const kinds = new Uint8Array(primitiveCount);
  const levels = new Uint8Array(primitiveCount);
  const owners = new Uint32Array(primitiveCount);
  const parents = new Int32Array(primitiveCount);
  const transforms = new Float32Array(primitiveCount * 8);
  selected.forEach(({ record, treeIndex }, index) => {
    primitiveIds.push(record.id);
    kinds[index] = record.kind;
    levels[index] = record.level;
    owners[index] = treeIndex;
    parents[index] = record.parentId == null ? -1 : selectedIds.get(record.parentId);
    transforms.set(record.transform, index * 8);
  });
  const trees = demands
    .filter(({ treeIndex }) => treePrimitives.has(treeIndex))
    .map(({ treeIndex, detailLevel }) => {
      const tree = treeRealization(state, forest, treeIndex);
      return Object.freeze({
        id: tree.id,
        treeIndex,
        detailLevel,
        speciesIndex: tree.speciesIndex,
        profile: tree.profile,
        envelope: tree.envelope,
        targetPathLength: tree.targetPathLength,
        terminalRadius: tree.terminalRadius,
        primitives: Object.freeze(treePrimitives.get(treeIndex)),
      });
    });
  return Object.freeze({
    kind: 'tree-geometry-plan:v1',
    trees: Object.freeze(trees),
    demandedTreeCount: demands.length,
    primitiveCount,
    primitiveIds: Object.freeze(primitiveIds),
    kinds,
    levels,
    owners,
    parents,
    transforms,
    vectorBytes: kinds.byteLength + levels.byteLength + owners.byteLength
      + parents.byteLength + transforms.byteLength,
    budget: primitiveBudget,
  });
}
