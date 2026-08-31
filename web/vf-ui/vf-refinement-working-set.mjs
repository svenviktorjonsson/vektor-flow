import {
  refineEllipsoidFaceReference,
} from './vf-demand-refined-geometry.mjs';

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
  return Object.freeze({
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
}
