import {
  selectEllipsoidViewDemandReference,
} from './vf-ellipsoid-view-demand.mjs';
import {
  updateEllipsoidRefinementWorkingSetReference,
} from './vf-refinement-working-set.mjs';
import {
  adaptEllipsoidWorkingSetToRetainedGeometryPacketsReference,
} from './vf-rock-renderer-packets.mjs';

function stablePacketOrder(first, second) {
  return Number(first.object_id) - Number(second.object_id)
    || String(first.id).localeCompare(String(second.id));
}

export function createRetainedGeometryPacketRuntimeReference({
  requestRender = () => {},
} = {}) {
  if (typeof requestRender !== 'function') {
    throw new TypeError('retained geometry requestRender must be a function');
  }
  const byId = new Map();

  function packets() {
    return Object.freeze([...byId.values()].sort(stablePacketOrder));
  }

  function applyDelta(delta) {
    if (!delta || typeof delta !== 'object') {
      throw new TypeError('retained geometry packet delta is required');
    }
    let changed = false;
    for (const id of delta.remove ?? []) {
      changed = byId.delete(String(id)) || changed;
    }
    for (const packet of delta.upsert ?? []) {
      if (!packet || typeof packet !== 'object' || !packet.id) {
        throw new TypeError('retained geometry upsert packet requires an id');
      }
      const id = String(packet.id);
      if (byId.get(id) !== packet) {
        byId.set(id, packet);
        changed = true;
      }
    }
    const current = packets();
    const receipt = Object.freeze({
      changed,
      upserted: Object.freeze((delta.upsert ?? []).map(({ id }) => String(id))),
      removed: Object.freeze((delta.remove ?? []).map(String)),
      packetCount: current.length,
      upload: delta.upload,
    });
    if (changed) {
      requestRender(current, receipt);
    }
    return receipt;
  }

  return Object.freeze({ applyDelta, packets });
}

export function createEllipsoidCameraDemandControllerReference({
  coarse,
  runtime,
  schedule = (job) => setTimeout(job, 0),
  maxErrorPixels,
  refinementBudget,
  vertexBudget,
  faceBudget,
}) {
  if (!runtime || typeof runtime.applyDelta !== 'function' || typeof runtime.packets !== 'function') {
    throw new TypeError('retained geometry packet runtime is required');
  }
  if (typeof schedule !== 'function') {
    throw new TypeError('camera demand schedule must be a function');
  }
  let pending = null;
  let scheduled = false;
  let committedRevision = 0;
  let workingSet = null;
  let packetState = null;

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
      const selection = selectEllipsoidViewDemandReference(coarse, {
        camera: active.camera,
        maxErrorPixels,
        budget: refinementBudget,
      });
      const demanded = new Set(selection.demands);
      const demands = selection.candidates.filter(({ face }) => demanded.has(face));
      workingSet = updateEllipsoidRefinementWorkingSetReference(coarse, workingSet, {
        demands,
        vertexBudget,
        faceBudget,
      });
      packetState = adaptEllipsoidWorkingSetToRetainedGeometryPacketsReference(
        workingSet,
        packetState,
      );
      const runtimeReceipt = runtime.applyDelta(packetState.delta);
      committedRevision = active.revision;
      active.resolve(Object.freeze({
        status: 'applied',
        revision: active.revision,
        demandFaces: Object.freeze(workingSet.entries.map(({ face }) => face)),
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
        'camera demand revision must be a positive safe integer',
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
