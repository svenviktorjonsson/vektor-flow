const IDENTITY_AFFINE = Object.freeze([1, 0, 0, 1, 0, 0]);
const EPSILON = 1e-12;

export function createSurfaceContextRegistry({
  rootId = 'root',
  timeHandle = null,
  contexts = []
} = {}) {
  const normalizedRootId = normalizeId(rootId, 'root id');
  if (!Array.isArray(contexts)) throw new TypeError('surface contexts must be an array');

  const records = new Map();
  records.set(normalizedRootId, freezeRecord({
    id: normalizedRootId,
    parentId: null,
    faceId: null,
    frame: IDENTITY_AFFINE,
    clipPolygon: null,
    clipHoles: []
  }));

  for (const context of contexts) {
    const record = normalizeChildRecord(context, normalizedRootId);
    if (records.has(record.id)) throw new Error(`duplicate surface context id: ${record.id}`);
    records.set(record.id, record);
  }
  validateHierarchy(records, normalizedRootId);
  return createRegistry(records, Object.freeze([normalizedRootId]), normalizedRootId, timeHandle);
}

function createRegistry(records, stack, rootId, timeHandle) {
  const api = {
    rootId,
    activeId: stack[stack.length - 1],
    size: records.size,
    stack,

    has(id) {
      return records.has(normalizeId(id, 'surface context id'));
    },

    get(id) {
      return publicRecord(requireRecord(records, id));
    },

    createChild(specification) {
      const record = normalizeChildRecord(specification, rootId);
      if (records.has(record.id)) throw new Error(`duplicate surface context id: ${record.id}`);
      requireRecord(records, record.parentId);
      const next = new Map(records);
      next.set(record.id, record);
      validateHierarchy(next, rootId);
      return createRegistry(next, stack, rootId, timeHandle);
    },

    updateClip(id, clipPolygon) {
      const record = requireNonRootRecord(records, id, rootId);
      return replaceRecord(records, stack, rootId, timeHandle, freezeRecord({
        ...record,
        clipPolygon: normalizePolygon(clipPolygon)
      }));
    },

    updateClipHoles(id, clipHoles) {
      const record = requireNonRootRecord(records, id, rootId);
      return replaceRecord(records, stack, rootId, timeHandle, freezeRecord({
        ...record,
        clipHoles: normalizeHolePolygons(clipHoles)
      }));
    },

    translate(id, delta) {
      const [dx, dy] = normalizePoint(delta, 'translation');
      return transformFrame(records, stack, rootId, timeHandle, id, [1, 0, 0, 1, dx, dy]);
    },

    rotate(id, radians, origin = [0, 0]) {
      const angle = normalizeFinite(radians, 'rotation');
      const [ox, oy] = normalizePoint(origin, 'rotation origin');
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      return transformFrame(
        records,
        stack,
        rootId,
        timeHandle,
        id,
        aroundOrigin([cosine, sine, -sine, cosine, 0, 0], ox, oy)
      );
    },

    scale(id, factor, origin = [0, 0]) {
      const uniformScale = normalizeFinite(factor, 'uniform scale');
      if (Math.abs(uniformScale) <= EPSILON) throw new RangeError('uniform scale must be non-zero');
      const [ox, oy] = normalizePoint(origin, 'scale origin');
      return transformFrame(
        records,
        stack,
        rootId,
        timeHandle,
        id,
        aroundOrigin([uniformScale, 0, 0, uniformScale, 0, 0], ox, oy)
      );
    },

    localToParent(id, point) {
      return applyAffine(requireRecord(records, id).frame, point);
    },

    parentToLocal(id, point) {
      return applyAffine(invertAffine(requireRecord(records, id).frame), point);
    },

    localToWorld(id, point) {
      return applyAffine(worldAffine(records, requireRecord(records, id).id), point);
    },

    worldToLocal(id, point) {
      return applyAffine(invertAffine(worldAffine(records, requireRecord(records, id).id)), point);
    },

    worldAffine(id) {
      return freezeAffine(worldAffine(records, requireRecord(records, id).id));
    },

    enter(id) {
      const record = requireNonRootRecord(records, id, rootId);
      if (record.parentId !== api.activeId) {
        throw new Error(`surface context ${record.id} is not a child of active context ${api.activeId}`);
      }
      return createRegistry(records, Object.freeze([...stack, record.id]), rootId, timeHandle);
    },

    exit() {
      if (stack.length === 1) return api;
      return createRegistry(records, Object.freeze(stack.slice(0, -1)), rootId, timeHandle);
    },

    renderDescriptor(id) {
      return renderDescriptor(records, requireRecord(records, id), api.activeId, rootId, timeHandle);
    },

    renderDescriptors() {
      return Object.freeze([...records.values()].map((record) => (
        renderDescriptor(records, record, api.activeId, rootId, timeHandle)
      )));
    }
  };
  return Object.freeze(api);
}

function transformFrame(records, stack, rootId, timeHandle, id, parentTransform) {
  const record = requireNonRootRecord(records, id, rootId);
  const transform = normalizeAffine(parentTransform);
  return replaceRecord(records, stack, rootId, timeHandle, freezeRecord({
    ...record,
    frame: composeAffine(transform, record.frame)
  }));
}

function replaceRecord(records, stack, rootId, timeHandle, record) {
  const next = new Map(records);
  next.set(record.id, record);
  return createRegistry(next, stack, rootId, timeHandle);
}

function renderDescriptor(records, record, activeId, rootId, timeHandle) {
  const affine = worldAffine(records, record.id);
  const focused = record.id === activeId;
  return Object.freeze({
    id: record.id,
    parentId: record.parentId,
    faceId: record.faceId,
    worldAffine: freezeAffine(affine),
    worldClipPolygon: record.clipPolygon === null
      ? null
      : freezePolygon(record.clipPolygon.map((point) => applyAffine(affine, point))),
    worldClipHoles: freezePolygons(record.clipHoles.map((polygon) => (
      polygon.map((point) => applyAffine(affine, point))
    ))),
    focused,
    gridVisible: focused,
    dimOutside: focused && record.id !== rootId,
    timeHandle
  });
}

function worldAffine(records, id, visiting = new Set()) {
  if (visiting.has(id)) throw new Error(`surface context cycle detected at ${id}`);
  const record = requireRecord(records, id);
  if (record.parentId === null) return [...record.frame];
  visiting.add(id);
  const parentWorld = worldAffine(records, record.parentId, visiting);
  visiting.delete(id);
  return composeAffine(parentWorld, record.frame);
}

function validateHierarchy(records, rootId) {
  const states = new Map();
  function visit(id) {
    const state = states.get(id);
    if (state === 'visiting') throw new Error(`surface context cycle detected at ${id}`);
    if (state === 'visited') return;
    states.set(id, 'visiting');
    const record = requireRecord(records, id);
    if (id === rootId) {
      if (record.parentId !== null) throw new Error('root surface context cannot have a parent');
    } else {
      if (record.parentId === id) throw new Error(`surface context cycle detected at ${id}`);
      if (!records.has(record.parentId)) {
        throw new Error(`unknown parent surface context: ${record.parentId}`);
      }
      visit(record.parentId);
    }
    states.set(id, 'visited');
  }
  for (const id of records.keys()) visit(id);
}

function normalizeChildRecord(value, rootId) {
  requireObject(value, 'surface context');
  const id = normalizeId(value.id, 'surface context id');
  if (id === rootId) throw new Error('child surface context cannot use root id');
  return freezeRecord({
    id,
    parentId: normalizeId(value.parentId, 'parent surface context id'),
    faceId: normalizeId(value.faceId, 'face id'),
    frame: normalizeAffine(value.frame),
    clipPolygon: normalizePolygon(value.clipPolygon),
    clipHoles: normalizeHolePolygons(value.clipHoles)
  });
}

function freezeRecord(record) {
  return Object.freeze({
    id: record.id,
    parentId: record.parentId,
    faceId: record.faceId,
    frame: freezeAffine(record.frame),
    clipPolygon: record.clipPolygon === null ? null : freezePolygon(record.clipPolygon),
    clipHoles: freezePolygons(record.clipHoles)
  });
}

function publicRecord(record) {
  return Object.freeze({
    id: record.id,
    parentId: record.parentId,
    faceId: record.faceId,
    frame: record.frame,
    clipPolygon: record.clipPolygon,
    clipHoles: record.clipHoles
  });
}

function normalizeAffine(value) {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
    throw new TypeError('surface frame must contain six affine values');
  }
  if (value.length !== 6) throw new TypeError('surface frame must contain six affine values');
  const affine = [...value].map((entry) => normalizeFinite(entry, 'surface frame value'));
  const determinant = affine[0] * affine[3] - affine[1] * affine[2];
  if (Math.abs(determinant) <= EPSILON) throw new RangeError('surface frame must be invertible');
  return affine;
}

function composeAffine(outer, inner) {
  const [a, b, c, d, e, f] = outer;
  const [g, h, i, j, k, l] = inner;
  return [
    a * g + c * h,
    b * g + d * h,
    a * i + c * j,
    b * i + d * j,
    a * k + c * l + e,
    b * k + d * l + f
  ];
}

function invertAffine(affine) {
  const [a, b, c, d, e, f] = affine;
  const determinant = a * d - b * c;
  if (Math.abs(determinant) <= EPSILON) throw new RangeError('surface frame must be invertible');
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant
  ];
}

function aroundOrigin(transform, x, y) {
  return composeAffine(
    [1, 0, 0, 1, x, y],
    composeAffine(transform, [1, 0, 0, 1, -x, -y])
  );
}

function applyAffine(affine, value) {
  const [x, y] = normalizePoint(value, 'point');
  return Object.freeze([
    affine[0] * x + affine[2] * y + affine[4],
    affine[1] * x + affine[3] * y + affine[5]
  ]);
}

function normalizePolygon(value) {
  if (!Array.isArray(value) || value.length < 3) {
    throw new TypeError('surface clip polygon must contain at least three points');
  }
  const polygon = value.map((point) => normalizePoint(point, 'surface clip point'));
  for (let index = 0; index < polygon.length; index += 1) {
    for (let other = index + 1; other < polygon.length; other += 1) {
      if (samePoint(polygon[index], polygon[other])) {
        throw new RangeError('surface clip polygon cannot contain duplicate points');
      }
    }
  }
  if (Math.abs(signedArea(polygon)) <= EPSILON) {
    throw new RangeError('surface clip polygon must have non-zero area');
  }
  assertSimplePolygon(polygon);
  return polygon;
}

function normalizeHolePolygons(value = []) {
  if (!Array.isArray(value)) throw new TypeError('surface clip holes must be an array');
  return value.map((polygon) => normalizePolygon(polygon));
}

function assertSimplePolygon(polygon) {
  for (let first = 0; first < polygon.length; first += 1) {
    const firstNext = (first + 1) % polygon.length;
    for (let second = first + 1; second < polygon.length; second += 1) {
      const secondNext = (second + 1) % polygon.length;
      if (first === second || firstNext === second || secondNext === first) continue;
      if (segmentsIntersect(polygon[first], polygon[firstNext], polygon[second], polygon[secondNext])) {
        throw new RangeError('surface clip polygon cannot self-intersect');
      }
    }
  }
}

function segmentsIntersect(a, b, c, d) {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (Math.abs(abC) <= EPSILON && onSegment(a, b, c)) return true;
  if (Math.abs(abD) <= EPSILON && onSegment(a, b, d)) return true;
  if (Math.abs(cdA) <= EPSILON && onSegment(c, d, a)) return true;
  if (Math.abs(cdB) <= EPSILON && onSegment(c, d, b)) return true;
  return (abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0);
}

function orientation(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a, b, point) {
  return point[0] >= Math.min(a[0], b[0]) - EPSILON
    && point[0] <= Math.max(a[0], b[0]) + EPSILON
    && point[1] >= Math.min(a[1], b[1]) - EPSILON
    && point[1] <= Math.max(a[1], b[1]) + EPSILON;
}

function signedArea(polygon) {
  return polygon.reduce((area, point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return area + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
}

function samePoint(left, right) {
  return Math.abs(left[0] - right[0]) <= EPSILON
    && Math.abs(left[1] - right[1]) <= EPSILON;
}

function normalizePoint(value, label) {
  if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value.length !== 2) {
    throw new TypeError(`${label} must contain two finite values`);
  }
  return [normalizeFinite(value[0], label), normalizeFinite(value[1], label)];
}

function freezeAffine(value) {
  return Object.freeze([...value]);
}

function freezePolygon(value) {
  return Object.freeze(value.map((point) => Object.freeze([...point])));
}

function freezePolygons(value) {
  return Object.freeze(value.map((polygon) => freezePolygon(polygon)));
}

function normalizeId(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function normalizeFinite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
}

function requireRecord(records, id) {
  const normalizedId = normalizeId(id, 'surface context id');
  const record = records.get(normalizedId);
  if (!record) throw new Error(`unknown surface context: ${normalizedId}`);
  return record;
}

function requireNonRootRecord(records, id, rootId) {
  const record = requireRecord(records, id);
  if (record.id === rootId) throw new Error('root surface context cannot be transformed or clipped');
  return record;
}

