import {
  createProceduralStoneAdaptiveSceneReference,
} from './vf-procedural-stone-adaptive-scene.mjs';
import {
  createStoneFamilyPopulationReference,
  realizeStoneFamilyPatchesReference,
} from './vf-stone-family-population.mjs';

const MAX_STONE_BUDGET = 65_536;
const MAX_RAM_BUDGET_BYTES = 256 * 1024 * 1024;
const POPULATION_VECTOR_BYTES_PER_STONE = 32;
const COARSE_VECTOR_BYTES_PER_STONE = 504;
const DETAIL_VECTOR_BYTES_PER_STONE = 308;
const COORDINATOR_VECTOR_BYTES_PER_STONE = 5;
const BASE_VECTOR_BYTES_PER_STONE =
  POPULATION_VECTOR_BYTES_PER_STONE
  + COARSE_VECTOR_BYTES_PER_STONE
  + COORDINATOR_VECTOR_BYTES_PER_STONE;

function requireOptions(options) {
  for (const field of ['stoneBudget', 'detailVertexBudget']) {
    if (
      !Number.isSafeInteger(options[field])
      || options[field] < 0
      || options[field] > MAX_STONE_BUDGET
    ) {
      throw new RangeError(
        `stone population ${field} must be from 0 through ${MAX_STONE_BUDGET}`,
      );
    }
  }
  if (
    !Number.isSafeInteger(options.ramBudgetBytes)
    || options.ramBudgetBytes < 0
    || options.ramBudgetBytes > MAX_RAM_BUDGET_BYTES
  ) {
    throw new RangeError(
      'stone population ramBudgetBytes cannot exceed 256 MiB',
    );
  }
  if (
    !Number.isSafeInteger(options.materialDetailLevel)
    || options.materialDetailLevel < 0
  ) {
    throw new RangeError(
      'stone population materialDetailLevel must be non-negative',
    );
  }
  if (!Number.isFinite(options.footprint) || options.footprint < 0) {
    throw new RangeError(
      'stone population footprint must be finite and non-negative',
    );
  }
}

function stoneRadii(population, stone) {
  return population.radii.subarray(stone * 3, stone * 3 + 3);
}

function stonePosition(population, stone) {
  return population.positions.subarray(stone * 3, stone * 3 + 3);
}

function localCamera(camera, position, rotation) {
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const localPoint = (point) => {
    const x = point[0] - position[0];
    const y = point[1] - position[1];
    return Object.freeze([
      cosine * x + sine * y,
      -sine * x + cosine * y,
      point[2] - position[2],
    ]);
  };
  return Object.freeze({
    eye: localPoint(camera.eye),
    target: localPoint(camera.target),
    up: Object.freeze([0, 0, 1]),
    verticalFovRadians: camera.verticalFovRadians,
    viewportHeight: camera.viewportHeight,
  });
}

function projectedPriority(camera, position, radii) {
  const dx = camera.eye[0] - position[0];
  const dy = camera.eye[1] - position[1];
  const dz = camera.eye[2] - position[2];
  const distance = Math.max(Math.hypot(dx, dy, dz), Number.EPSILON);
  return Math.max(radii[0], radii[1], radii[2])
    * camera.viewportHeight / distance;
}

function snapshot({
  frame,
  population,
  active,
  changes,
  effectiveDetailVertexBudget,
  ramBudgetBytes,
}) {
  const materialPackets = Object.freeze(active.map(({ scene }) => (
    scene.snapshot().materialPackets
  )));
  const refinementVertices = new Uint8Array(active.length);
  const materialVectorBytes = new Uint32Array(active.length);
  active.forEach(({ scene }, stone) => {
    const stoneSnapshot = scene.snapshot();
    refinementVertices[stone] = stoneSnapshot.detailUsage.vertices;
    materialVectorBytes[stone] = stoneSnapshot.vectorBytes;
  });
  const vectorBytes = population.vectorBytes
    + refinementVertices.byteLength
    + materialVectorBytes.byteLength
    + materialVectorBytes.reduce((sum, bytes) => sum + bytes, 0);
  if (vectorBytes > ramBudgetBytes) {
    throw new RangeError(
      'stone population materialization exceeded RAM budget',
    );
  }
  return Object.freeze({
    kind: 'procedural-stone-population-scene:v1',
    frame,
    population,
    stoneIds: population.stoneIds,
    positions: population.positions,
    radii: population.radii,
    rotations: population.rotations,
    familyIndices: population.familyIndices,
    materialPackets,
    refinementVertices,
    materialVectorBytes,
    changes,
    effectiveDetailVertexBudget,
    vectorBytes,
    ramBudgetBytes,
  });
}

function frozenChanges({ retained = [], created = [], evicted = [] }) {
  return Object.freeze({
    retained: Object.freeze(retained),
    created: Object.freeze(created),
    evicted: Object.freeze(evicted),
  });
}

export function createProceduralStonePopulationSceneReference(options) {
  requireOptions(options);
  const populationReference = createStoneFamilyPopulationReference(
    options.identity,
  );
  const effectiveStoneBudget = Math.min(
    options.stoneBudget,
    Math.floor(options.ramBudgetBytes / BASE_VECTOR_BYTES_PER_STONE),
  );
  let population = realizeStoneFamilyPatchesReference(populationReference, {
    patches: [],
    stoneBudget: effectiveStoneBudget,
  });
  let active = [];
  let activeById = new Map();
  let frame = 0;
  let effectiveDetailVertexBudget = 0;
  let currentChanges = frozenChanges({});
  let currentSnapshot = snapshot({
    frame,
    population,
    active,
    changes: currentChanges,
    effectiveDetailVertexBudget,
    ramBudgetBytes: options.ramBudgetBytes,
  });

  function updateSnapshot() {
    currentSnapshot = snapshot({
      frame,
      population,
      active,
      changes: currentChanges,
      effectiveDetailVertexBudget,
      ramBudgetBytes: options.ramBudgetBytes,
    });
    return currentSnapshot;
  }

  return Object.freeze({
    snapshot() {
      return currentSnapshot;
    },
    updatePatches({ patches }) {
      const nextPopulation = realizeStoneFamilyPatchesReference(
        populationReference,
        { patches, stoneBudget: effectiveStoneBudget },
      );
      const families = new Map(nextPopulation.families.map((family) => (
        [family.index, family]
      )));
      const nextActive = [];
      const nextById = new Map();
      const retained = [];
      const created = [];
      nextPopulation.stoneIds.forEach((stoneId, stone) => {
        let entry = activeById.get(stoneId);
        if (entry) {
          retained.push(stoneId);
        } else {
          const family = families.get(nextPopulation.familyIndices[stone]);
          const scene = createProceduralStoneAdaptiveSceneReference({
            identity: options.identity,
            materialField: family.materialField,
            radii: stoneRadii(nextPopulation, stone),
            detailVertexBudget: 1,
            ramBudgetBytes:
              COARSE_VECTOR_BYTES_PER_STONE + DETAIL_VECTOR_BYTES_PER_STONE,
            materialDetailLevel: options.materialDetailLevel,
            footprint: options.footprint,
          });
          entry = Object.freeze({ stoneId, scene });
          created.push(stoneId);
        }
        nextActive.push(entry);
        nextById.set(stoneId, entry);
      });
      const evicted = [...activeById.keys()].filter((stoneId) => (
        !nextById.has(stoneId)
      ));
      const remainingBytes = options.ramBudgetBytes
        - nextPopulation.vectorBytes
        - nextPopulation.stoneCount
          * (COARSE_VECTOR_BYTES_PER_STONE
            + COORDINATOR_VECTOR_BYTES_PER_STONE);
      effectiveDetailVertexBudget = Math.min(
        options.detailVertexBudget,
        nextPopulation.stoneCount,
        Math.max(0, Math.floor(remainingBytes / DETAIL_VECTOR_BYTES_PER_STONE)),
      );
      population = nextPopulation;
      active = nextActive;
      activeById = nextById;
      currentChanges = frozenChanges({ retained, created, evicted });
      frame += 1;
      return updateSnapshot();
    },
    updateProjectedDemand({ camera, maxErrorPixels }) {
      const ranked = active.map((entry, stone) => ({
        entry,
        stone,
        priority: projectedPriority(
          camera,
          stonePosition(population, stone),
          stoneRadii(population, stone),
        ),
      })).sort((first, second) => (
        second.priority - first.priority
        || first.entry.stoneId.localeCompare(second.entry.stoneId)
      ));
      const selected = new Set(ranked
        .slice(0, effectiveDetailVertexBudget)
        .map(({ entry }) => entry.stoneId));
      active.forEach(({ stoneId, scene }, stone) => {
        scene.updateProjectedDemand({
          camera: localCamera(
            camera,
            stonePosition(population, stone),
            population.rotations[stone],
          ),
          maxErrorPixels: selected.has(stoneId)
            ? maxErrorPixels
            : Number.MAX_VALUE,
        });
      });
      currentChanges = frozenChanges({
        retained: population.stoneIds.slice(),
      });
      frame += 1;
      return updateSnapshot();
    },
  });
}
