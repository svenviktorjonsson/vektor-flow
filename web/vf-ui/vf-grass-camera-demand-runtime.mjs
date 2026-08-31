import {
  createGrassRendererGpuBatchPacketsReference,
} from './vf-grass-material-field.mjs';
import {
  selectGrassViewDemandReference,
} from './vf-grass-view-demand.mjs';

function emptyUpload() {
  return Object.freeze({
    packets: 0,
    blades: 0,
    vertexBytes: 0,
    indexBytes: 0,
    bytes: 0,
  });
}

function demandSignature(demand) {
  return `${demand.detailLevel}|${demand.bladeBudget}|${demand.cells
    .map(([x, y]) => `${x}:${y}`)
    .join(',')}`;
}

function adaptWorkingSet(workingSet, previousById) {
  const nextById = new Map();
  const upsert = [];
  let blades = 0;
  let vertexBytes = 0;
  let indexBytes = 0;
  for (const generated of workingSet.packets) {
    const previous = previousById.get(generated.id);
    const compatible = previous && (
      generated.retained_signature != null
        ? previous.retained_signature === generated.retained_signature
        : previous.blade_count === generated.blade_count
    );
    const packet = compatible
      ? previous
      : generated;
    nextById.set(packet.id, packet);
    if (packet !== previous) {
      upsert.push(packet);
      blades += packet.blade_count;
      const reusesVertexTemplate = previous?.vertices === packet.vertices;
      const reusesIndexTemplate = previous?.indices === packet.indices;
      const grassGpuBytes = packet.grass_gpu
        ? packet.grass_gpu.cell_records.byteLength + 16
        : 0;
      vertexBytes += (reusesVertexTemplate ? 0 : packet.vertices.byteLength)
        + (packet.instances?.byteLength ?? 0)
        + grassGpuBytes;
      indexBytes += reusesIndexTemplate ? 0 : packet.indices.byteLength;
    }
  }
  const remove = [];
  for (const id of previousById.keys()) {
    if (!nextById.has(id)) remove.push(id);
  }
  return Object.freeze({
    byId: nextById,
    delta: Object.freeze({
      upsert: Object.freeze(upsert),
      remove: Object.freeze(remove),
      upload: Object.freeze({
        packets: upsert.length,
        blades,
        vertexBytes,
        indexBytes,
        bytes: vertexBytes + indexBytes,
      }),
    }),
  });
}

export function createGrassCameraDemandControllerReference({
  field,
  runtime,
  schedule = (job) => setTimeout(job, 0),
  planeZ,
  maximumDistance,
  cellBudget,
  bladeBudget,
}) {
  if (!runtime || typeof runtime.applyDelta !== 'function' || typeof runtime.packets !== 'function') {
    throw new TypeError('retained geometry packet runtime is required');
  }
  if (typeof schedule !== 'function') {
    throw new TypeError('grass camera demand schedule must be a function');
  }
  if (typeof maximumDistance !== 'number' || !Number.isFinite(maximumDistance) || !(maximumDistance > 0)) {
    throw new RangeError('grass camera demand maximumDistance must be finite and positive');
  }
  let pending = null;
  let scheduled = false;
  let committedRevision = 0;
  let lastSignature = null;
  let packetById = new Map();

  function status() {
    return Object.freeze({
      scheduled,
      pendingRevision: pending?.revision ?? null,
      committedRevision,
      packetCount: runtime.packets().length,
    });
  }

  function ensureScheduled() {
    if (scheduled) return;
    scheduled = true;
    schedule(runLatest);
  }

  function runLatest() {
    scheduled = false;
    const active = pending;
    pending = null;
    if (!active) return;
    try {
      const requestedMaximum = active.camera?.maximumDistance;
      const boundedCamera = {
        ...active.camera,
        maximumDistance: requestedMaximum == null
          ? maximumDistance
          : Math.min(requestedMaximum, maximumDistance),
      };
      const demand = selectGrassViewDemandReference({
        camera: boundedCamera,
        planeZ,
        cellBudget,
        bladeBudget,
      });
      const signature = demandSignature(demand);
      let delta;
      if (signature === lastSignature) {
        delta = Object.freeze({
          upsert: Object.freeze([]),
          remove: Object.freeze([]),
          upload: emptyUpload(),
        });
      } else {
        const workingSet = createGrassRendererGpuBatchPacketsReference(field, demand);
        const adapted = adaptWorkingSet(workingSet, packetById);
        packetById = adapted.byId;
        delta = adapted.delta;
        lastSignature = signature;
      }
      const runtimeReceipt = runtime.applyDelta(delta);
      committedRevision = active.revision;
      active.resolve(Object.freeze({
        status: 'applied',
        revision: active.revision,
        cells: demand.cells,
        detailLevel: demand.detailLevel,
        farClipped: demand.farClipped,
        runtime: runtimeReceipt,
      }));
    } catch (error) {
      active.reject(error);
    }
    if (pending) ensureScheduled();
  }

  function request({ revision, camera } = {}) {
    if (!Number.isSafeInteger(revision) || revision <= 0) {
      return Promise.reject(new RangeError(
        'grass camera demand revision must be a positive safe integer',
      ));
    }
    if (revision <= committedRevision || (pending && revision <= pending.revision)) {
      return Promise.resolve(Object.freeze({
        status: 'stale',
        revision,
        committedRevision,
        pendingRevision: pending?.revision ?? null,
      }));
    }
    if (pending) {
      pending.resolve(Object.freeze({
        status: 'superseded',
        revision: pending.revision,
        byRevision: revision,
      }));
    }
    const completion = new Promise((resolve, reject) => {
      pending = { revision, camera, resolve, reject };
    });
    ensureScheduled();
    return completion;
  }

  return Object.freeze({ request, status });
}
