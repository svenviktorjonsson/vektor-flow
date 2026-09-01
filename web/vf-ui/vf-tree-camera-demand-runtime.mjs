import {
  createTreeGeometryPlannerReference,
  planTreeGeometryReference,
} from './vf-tree-geometry-plan.mjs';
import {
  createTreeMaterialFieldReference,
  realizeTreeMaterialsReference,
} from './vf-tree-material-field.mjs';
import {
  adaptTreeWorkingSetsToRetainedPacketsReference,
} from './vf-tree-renderer-packets.mjs';
import {
  selectTreeViewDemandReference,
} from './vf-tree-view-demand.mjs';

export function createTreeCameraDemandControllerReference({
  identity,
  forest,
  runtime,
  schedule = (job) => setTimeout(job, 0),
  treeBudget,
  primitiveBudget,
}) {
  if (
    !runtime
    || typeof runtime.applyDelta !== 'function'
    || typeof runtime.packets !== 'function'
    || typeof runtime.status !== 'function'
  ) {
    throw new TypeError('tree packet runtime cache is required');
  }
  if (typeof schedule !== 'function') {
    throw new TypeError('tree camera demand schedule must be a function');
  }
  const planner = createTreeGeometryPlannerReference(identity);
  const materialField = createTreeMaterialFieldReference(identity);
  let pending = null;
  let scheduled = false;
  let committedRevision = 0;
  let packetState = null;

  function status() {
    const cache = runtime.status();
    return Object.freeze({
      scheduled,
      pendingRevision: pending?.revision ?? null,
      committedRevision,
      packetCount: cache.packetCount,
      primitiveCount: cache.primitiveCount,
      bytes: cache.bytes,
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
      const demand = selectTreeViewDemandReference({
        camera: active.camera,
        forest,
        treeBudget,
        primitiveBudget,
      });
      const geometry = planTreeGeometryReference(planner, forest, demand);
      const materials = realizeTreeMaterialsReference(
        materialField,
        forest,
        geometry,
        { materialBudget: primitiveBudget },
      );
      const nextPacketState = adaptTreeWorkingSetsToRetainedPacketsReference(
        geometry,
        materials,
        packetState,
      );
      const runtimeReceipt = runtime.applyDelta(nextPacketState.delta);
      packetState = nextPacketState;
      committedRevision = active.revision;
      active.resolve(Object.freeze({
        status: 'applied',
        revision: active.revision,
        demandTreeCount: demand.treeIndices.length,
        plannedPrimitiveCount: demand.plannedPrimitiveCount,
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
        'tree camera demand revision must be a positive safe integer',
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
