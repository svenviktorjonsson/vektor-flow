import {
  refineEllipsoidFaceReference,
} from './vf-demand-refined-geometry.mjs';

const workingSetStates = new WeakSet();

function binaryCompare(first, second) {
  return first < second ? -1 : first > second ? 1 : 0;
}

function compareDemandPriority(first, second) {
  return Number(second.silhouette) - Number(first.silhouette)
    || second.silhouetteErrorPixels - first.silhouetteErrorPixels
    || second.projectedErrorPixels - first.projectedErrorPixels
    || second.errorBoundPixels - first.errorBoundPixels
    || binaryCompare(first.face, second.face);
}

function requireUniqueDemands(coarse, demands) {
  if (!Array.isArray(demands)) {
    throw new TypeError('ellipsoid refinement demands must be an array');
  }
  const available = new Set(coarse.faces.map(({ id }) => id));
  const seen = new Set();
  for (const activeDemand of demands) {
    if (!activeDemand || typeof activeDemand !== 'object') {
      throw new TypeError('ellipsoid refinement demand must be an object');
    }
    if (!available.has(activeDemand.face)) {
      throw new RangeError(`ellipsoid coarse face is unavailable: ${activeDemand.face}`);
    }
    if (seen.has(activeDemand.face)) {
      throw new RangeError(`ellipsoid refinement demand is duplicated: ${activeDemand.face}`);
    }
    if (typeof activeDemand.silhouette !== 'boolean') {
      throw new TypeError('ellipsoid refinement silhouette priority must be a boolean');
    }
    for (const field of [
      'silhouetteErrorPixels',
      'projectedErrorPixels',
      'errorBoundPixels',
    ]) {
      if (typeof activeDemand[field] !== 'number') {
        throw new TypeError(`ellipsoid refinement ${field} must be a number`);
      }
      if (!Number.isFinite(activeDemand[field]) || activeDemand[field] < 0) {
        throw new RangeError(
          `ellipsoid refinement ${field} must be finite and non-negative`,
        );
      }
    }
    seen.add(activeDemand.face);
  }
}

function requireBudget(value, name) {
  if (typeof value !== 'number') {
    throw new TypeError(`ellipsoid refinement ${name} budget must be a number`);
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      `ellipsoid refinement ${name} budget must be a non-negative safe integer`,
    );
  }
}

function requireCoarse(coarse) {
  if (
    !coarse
    || typeof coarse !== 'object'
    || coarse.kind !== 'ellipsoid-octahedron:v1'
    || !Array.isArray(coarse.vertices)
    || !Array.isArray(coarse.faces)
  ) {
    throw new TypeError('coarse ellipsoid reference shape is required');
  }
}

function generateEntry(coarse, activeDemand) {
  const refined = refineEllipsoidFaceReference(coarse, activeDemand.face);
  return Object.freeze({
    face: activeDemand.face,
    vertices: Object.freeze(refined.vertices.slice(coarse.vertices.length)),
    faces: Object.freeze(refined.faces.filter(({ id }) => (
      id.startsWith(`${activeDemand.face}/refine:1/`)
    ))),
  });
}

export function updateEllipsoidRefinementWorkingSetReference(coarse, previous, {
  demands,
  vertexBudget,
  faceBudget,
}) {
  requireCoarse(coarse);
  requireBudget(vertexBudget, 'vertex');
  requireBudget(faceBudget, 'face');
  if (previous !== null) {
    if (
      !previous
      || typeof previous !== 'object'
      || !workingSetStates.has(previous)
    ) {
      throw new TypeError('ellipsoid refinement predecessor state is invalid');
    }
    if (previous.coarse !== coarse) {
      throw new RangeError('ellipsoid refinement predecessor owns another coarse shape');
    }
  }
  requireUniqueDemands(coarse, demands);
  const capacity = Math.min(vertexBudget, Math.floor(faceBudget / 3));
  const selected = [...demands].sort(compareDemandPriority).slice(0, capacity);
  const previousByFace = new Map(
    (previous?.coarse === coarse ? previous.entries : []).map((entry) => [entry.face, entry]),
  );
  const entries = Object.freeze(selected.map((activeDemand) => (
    previousByFace.get(activeDemand.face) ?? generateEntry(coarse, activeDemand)
  )));
  const retained = entries
    .map(({ face }) => face)
    .filter((face) => previousByFace.has(face));
  const created = entries
    .map(({ face }) => face)
    .filter((face) => !previousByFace.has(face));
  const selectedFaces = new Set(entries.map(({ face }) => face));
  const evicted = previous === null
    ? []
    : previous.entries
      .map(({ face }) => face)
      .filter((face) => !selectedFaces.has(face));
  const state = Object.freeze({
    coarse,
    entries,
    usage: Object.freeze({
      vertices: entries.reduce((count, entry) => count + entry.vertices.length, 0),
      faces: entries.reduce((count, entry) => count + entry.faces.length, 0),
    }),
    budget: Object.freeze({
      vertices: vertexBudget,
      faces: faceBudget,
    }),
    changes: Object.freeze({
      retained: Object.freeze(retained),
      created: Object.freeze(created),
      evicted: Object.freeze(evicted),
    }),
  });
  workingSetStates.add(state);
  return state;
}
