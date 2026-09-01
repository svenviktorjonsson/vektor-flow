const fieldState = new WeakMap();
const MAX_SEGMENT_BUDGET = 65536;
const KIND_TRUNK = 0;
const KIND_BRANCH = 2;

function requirePlan(plan) {
  if (
    !plan
    || plan.kind !== 'tree-geometry-plan:v1'
    || !Array.isArray(plan.trees)
    || !Array.isArray(plan.primitiveIds)
    || !(plan.kinds instanceof Uint8Array)
    || !(plan.parents instanceof Int32Array)
    || !(plan.transforms instanceof Float32Array)
    || plan.primitiveIds.length !== plan.primitiveCount
    || plan.kinds.length !== plan.primitiveCount
    || plan.parents.length !== plan.primitiveCount
    || plan.transforms.length !== plan.primitiveCount * 8
  ) {
    throw new TypeError('tree geometry plan is required');
  }
}

function requireBudget(segmentBudget) {
  if (
    !Number.isSafeInteger(segmentBudget)
    || segmentBudget < 0
    || segmentBudget > MAX_SEGMENT_BUDGET
  ) {
    throw new RangeError(`wood segmentBudget must be an integer from 0 to ${MAX_SEGMENT_BUDGET}`);
  }
}

function dot(left, right) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function normalize(vector, name) {
  const length = Math.hypot(...vector);
  if (!(length > 1e-12)) throw new RangeError(`${name} must be non-zero`);
  return vector.map((value) => value / length);
}

function projectOntoNormalPlane(vector, axis) {
  const along = dot(vector, axis);
  return vector.map((value, component) => value - axis[component] * along);
}

function trunkFrame(axis) {
  const reference = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const radialU = normalize(projectOntoNormalPlane(reference, axis), 'wood radial frame');
  return { radialU, radialV: normalize(cross(axis, radialU), 'wood radial frame') };
}

function childFrame(axis, parent) {
  let projected = projectOntoNormalPlane(parent.radialU, axis);
  if (Math.hypot(...projected) <= 1e-8) {
    projected = projectOntoNormalPlane(parent.radialV, axis);
  }
  const radialU = normalize(projected, 'wood child radial frame');
  return { radialU, radialV: normalize(cross(axis, radialU), 'wood child radial frame') };
}

function createSegment(primitive, kind, parent) {
  const [x, y, z, dx, dy, dz, length, radius] = primitive.transform;
  const axis = normalize([dx, dy, dz], 'wood growth axis');
  const origin = kind === KIND_TRUNK
    ? [
      x - axis[0] * length * 0.5,
      y - axis[1] * length * 0.5,
      z - axis[2] * length * 0.5,
    ]
    : [x, y, z];
  const frame = parent ? childFrame(axis, parent) : trunkFrame(axis);
  const pathOffset = parent
    ? parent.pathOffset + dot(
      origin.map((value, component) => value - parent.origin[component]),
      parent.axis,
    )
    : 0;
  return Object.freeze({
    primitiveId: primitive.id,
    origin: Object.freeze(origin),
    axis: Object.freeze(axis),
    radialU: Object.freeze(frame.radialU),
    radialV: Object.freeze(frame.radialV),
    pathOffset,
    length,
    radius,
  });
}

function primitiveRecords(plan) {
  return new Map(plan.trees.flatMap((tree) => (
    tree.primitives.map((primitive) => [primitive.id, primitive])
  )));
}

export function createWoodGrowthCoordinateFieldReference() {
  const field = Object.freeze({ kind: 'wood-growth-coordinate-field:v1' });
  fieldState.set(field, { segmentByPrimitive: new WeakMap() });
  return field;
}

export function realizeWoodGrowthCoordinatesReference(
  field,
  plan,
  { segmentBudget },
) {
  const state = fieldState.get(field);
  if (!state) throw new TypeError('wood growth coordinate field is required');
  requirePlan(plan);
  requireBudget(segmentBudget);
  const records = primitiveRecords(plan);
  const woodySourceIndices = [];
  for (let index = 0; index < plan.primitiveCount; index += 1) {
    if (plan.kinds[index] === KIND_TRUNK || plan.kinds[index] === KIND_BRANCH) {
      woodySourceIndices.push(index);
    }
  }
  const selected = woodySourceIndices.slice(0, segmentBudget);
  const segmentCount = selected.length;
  const localIndexBySource = new Map(
    selected.map((sourceIndex, localIndex) => [sourceIndex, localIndex]),
  );
  const primitiveIds = [];
  const segments = [];
  const sourceIndices = new Uint32Array(segmentCount);
  const parents = new Int32Array(segmentCount);
  const origins = new Float32Array(segmentCount * 3);
  const axes = new Float32Array(segmentCount * 3);
  const radialU = new Float32Array(segmentCount * 3);
  const radialV = new Float32Array(segmentCount * 3);
  const pathOffsets = new Float32Array(segmentCount);
  const lengths = new Float32Array(segmentCount);
  const radii = new Float32Array(segmentCount);

  selected.forEach((sourceIndex, localIndex) => {
    const primitive = records.get(plan.primitiveIds[sourceIndex]);
    if (!primitive) throw new RangeError('wood primitive record must be present');
    const sourceParent = plan.parents[sourceIndex];
    const localParent = sourceParent < 0 ? -1 : localIndexBySource.get(sourceParent);
    if (plan.kinds[sourceIndex] === KIND_BRANCH && localParent === undefined) {
      throw new RangeError('wood branch parent must be present in the working set');
    }
    const parent = localParent === undefined || localParent < 0
      ? null
      : segments[localParent];
    let segment = state.segmentByPrimitive.get(primitive);
    if (!segment) {
      segment = createSegment(primitive, plan.kinds[sourceIndex], parent);
      state.segmentByPrimitive.set(primitive, segment);
    }
    primitiveIds.push(primitive.id);
    segments.push(segment);
    sourceIndices[localIndex] = sourceIndex;
    parents[localIndex] = localParent ?? -1;
    origins.set(segment.origin, localIndex * 3);
    axes.set(segment.axis, localIndex * 3);
    radialU.set(segment.radialU, localIndex * 3);
    radialV.set(segment.radialV, localIndex * 3);
    pathOffsets[localIndex] = segment.pathOffset;
    lengths[localIndex] = segment.length;
    radii[localIndex] = segment.radius;
  });

  return Object.freeze({
    kind: 'wood-growth-coordinate-working-set:v1',
    primitiveIds: Object.freeze(primitiveIds),
    segments: Object.freeze(segments),
    segmentCount,
    sourceIndices,
    parents,
    origins,
    axes,
    radialU,
    radialV,
    pathOffsets,
    lengths,
    radii,
    vectorBytes: sourceIndices.byteLength + parents.byteLength
      + origins.byteLength + axes.byteLength + radialU.byteLength + radialV.byteLength
      + pathOffsets.byteLength + lengths.byteLength + radii.byteLength,
    budget: segmentBudget,
    truncated: segmentCount < woodySourceIndices.length,
  });
}
