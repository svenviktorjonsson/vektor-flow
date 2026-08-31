const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const U64_MASK = 0xffffffffffffffffn;

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new TypeError(`${label} must be finite`);
  }
  return number;
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalId(value, label) {
  const id = String(value ?? '').trim();
  if (!id) throw new TypeError(`${label} must be non-empty`);
  return id;
}

function canonicalPlane(plane, facetId) {
  if (!plane || !Array.isArray(plane.normal) || plane.normal.length !== 3) {
    throw new TypeError(`reflection facet "${facetId}" requires a three-component plane normal`);
  }
  const raw = plane.normal.map((value, index) => finiteNumber(value, `reflection facet "${facetId}" plane.normal[${index}]`));
  const length = Math.hypot(raw[0], raw[1], raw[2]);
  if (length <= Number.EPSILON) {
    throw new RangeError(`reflection facet "${facetId}" plane normal must be non-zero`);
  }
  let normal = raw.map(value => value / length);
  let offset = finiteNumber(plane.offset ?? 0, `reflection facet "${facetId}" plane.offset`) / length;
  const firstSignificant = normal.find(value => Math.abs(value) > Number.EPSILON) ?? 1;
  if (firstSignificant < 0) {
    normal = normal.map(value => -value);
    offset = -offset;
  }
  return { normal, offset };
}

function canonicalBounds(bounds, facetId) {
  if (!bounds) return null;
  if (!Array.isArray(bounds.min) || bounds.min.length !== 3 || !Array.isArray(bounds.max) || bounds.max.length !== 3) {
    throw new TypeError(`reflection facet "${facetId}" bounds require three-component min and max`);
  }
  const min = bounds.min.map((value, index) => finiteNumber(value, `reflection facet "${facetId}" bounds.min[${index}]`));
  const max = bounds.max.map((value, index) => finiteNumber(value, `reflection facet "${facetId}" bounds.max[${index}]`));
  for (let index = 0; index < 3; index += 1) {
    if (min[index] > max[index]) {
      throw new RangeError(`reflection facet "${facetId}" bounds min exceeds max on axis ${index}`);
    }
  }
  return { min, max };
}

function canonicalFacet(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('reflection facet must be an object');
  }
  const id = canonicalId(input.id, 'reflection facet id');
  const projectedPixels = Math.max(0, Math.ceil(finiteNumber(input.projectedPixels ?? 0, `reflection facet "${id}" projectedPixels`)));
  return {
    id,
    plane: canonicalPlane(input.plane, id),
    neighbors: [...new Set((input.neighbors ?? []).map(value => canonicalId(value, `reflection facet "${id}" neighbor id`)))].sort(compareCodeUnits),
    bounds: canonicalBounds(input.bounds, id),
    projectedPixels,
    schedulable: input.visible !== false && input.frontFacing !== false && projectedPixels > 0
  };
}

function planesAreCoplanar(left, right, tolerance) {
  return Math.abs(left.normal[0] - right.normal[0]) <= tolerance
    && Math.abs(left.normal[1] - right.normal[1]) <= tolerance
    && Math.abs(left.normal[2] - right.normal[2]) <= tolerance
    && Math.abs(left.offset - right.offset) <= tolerance;
}

function stableHash(parts) {
  let hash = FNV_OFFSET_64;
  const text = parts.map(part => `${part.length}:${part}`).join('');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = (hash * FNV_PRIME_64) & U64_MASK;
  }
  return hash.toString(16).padStart(16, '0');
}

function mergeBounds(facets) {
  const bounded = facets.filter(facet => facet.bounds);
  if (bounded.length !== facets.length) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const facet of bounded) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], facet.bounds.min[axis]);
      max[axis] = Math.max(max[axis], facet.bounds.max[axis]);
    }
  }
  return { min, max };
}

export function clusterReflectionFacets(inputs, options = {}) {
  if (!Array.isArray(inputs)) throw new TypeError('reflection facets must be an array');
  const tolerance = finiteNumber(options.coplanarTolerance ?? 0, 'coplanar tolerance');
  if (tolerance < 0) throw new RangeError('coplanar tolerance must be non-negative');

  const facets = inputs.map(canonicalFacet).sort((left, right) => compareCodeUnits(left.id, right.id));
  const byId = new Map();
  for (const facet of facets) {
    if (byId.has(facet.id)) throw new RangeError(`duplicate reflection facet id "${facet.id}"`);
    byId.set(facet.id, facet);
  }

  const parent = new Map(facets.map(facet => [facet.id, facet.id]));
  const find = id => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(id) !== id) {
      const next = parent.get(id);
      parent.set(id, root);
      id = next;
    }
    return root;
  };
  const union = (leftId, rightId) => {
    const leftRoot = find(leftId);
    const rightRoot = find(rightId);
    if (leftRoot === rightRoot) return;
    if (compareCodeUnits(leftRoot, rightRoot) < 0) parent.set(rightRoot, leftRoot);
    else parent.set(leftRoot, rightRoot);
  };

  for (const facet of facets) {
    for (const neighborId of facet.neighbors) {
      const neighbor = byId.get(neighborId);
      if (neighbor && planesAreCoplanar(facet.plane, neighbor.plane, tolerance)) {
        union(facet.id, neighbor.id);
      }
    }
  }

  const groups = new Map();
  for (const facet of facets) {
    const root = find(facet.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(facet);
  }

  return [...groups.values()].map(group => {
    const facetIds = group.map(facet => facet.id);
    const schedulableFacetIds = group.filter(facet => facet.schedulable).map(facet => facet.id);
    return {
      id: `reflection-cluster-${stableHash(facetIds)}-${facetIds.length}`,
      exact: true,
      plane: group[0].plane,
      bounds: mergeBounds(group),
      facetIds,
      schedulableFacetIds,
      projectedPixels: group.reduce((sum, facet) => sum + (facet.schedulable ? facet.projectedPixels : 0), 0)
    };
  }).sort((left, right) => compareCodeUnits(left.facetIds[0], right.facetIds[0]));
}

function nonNegativeInteger(value, label) {
  const number = finiteNumber(value, label);
  if (number < 0 || !Number.isInteger(number)) throw new RangeError(`${label} must be a non-negative integer`);
  return number;
}

export function scheduleReflectionCaptures(clusters, budget) {
  if (!Array.isArray(clusters)) throw new TypeError('reflection clusters must be an array');
  if (!budget || typeof budget !== 'object') throw new TypeError('reflection schedule requires a budget');
  const maxCaptures = nonNegativeInteger(budget.maxCaptures, 'reflection maxCaptures');
  const maxPixels = nonNegativeInteger(budget.maxPixels, 'reflection maxPixels');
  const candidates = clusters
    .filter(cluster => Array.isArray(cluster.schedulableFacetIds) && cluster.schedulableFacetIds.length > 0 && cluster.projectedPixels > 0)
    .slice()
    .sort((left, right) => right.projectedPixels - left.projectedPixels || compareCodeUnits(left.id, right.id));

  const jobs = [];
  let allocatedPixels = 0;
  for (const cluster of candidates) {
    if (jobs.length >= maxCaptures || allocatedPixels >= maxPixels) break;
    const allocation = Math.min(Math.ceil(cluster.projectedPixels), maxPixels - allocatedPixels);
    if (allocation <= 0) break;
    jobs.push({
      clusterId: cluster.id,
      facetIds: cluster.schedulableFacetIds.slice(),
      requestedPixels: cluster.projectedPixels,
      allocatedPixels: allocation,
      exact: cluster.exact === true
    });
    allocatedPixels += allocation;
  }

  return {
    jobs,
    budget: { maxCaptures, maxPixels },
    allocatedCaptures: jobs.length,
    allocatedPixels
  };
}
