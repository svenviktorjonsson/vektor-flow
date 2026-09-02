import {
  createCoarseEllipsoidReference,
} from "./vf-demand-refined-geometry.mjs";
import {
  selectEllipsoidViewDemandReference,
} from "./vf-ellipsoid-view-demand.mjs";
import {
  adaptRockMaterialToRendererPacketReference,
  createRockMaterialFieldReference,
} from "./vf-rock-material-field.mjs";
import {
  adaptEllipsoidWorkingSetToRetainedGeometryPacketsReference,
} from "./vf-rock-renderer-packets.mjs";
import {
  updateEllipsoidRefinementWorkingSetReference,
} from "./vf-refinement-working-set.mjs";

const MAX_DETAIL_VERTEX_BUDGET = 64;
const MAX_RAM_BUDGET_BYTES = 256 * 1024 * 1024;
const COARSE_VECTOR_BYTES = 504;
const DETAIL_VECTOR_BYTES = 308;

function requireOptions({
  detailVertexBudget,
  ramBudgetBytes,
  materialDetailLevel,
  footprint,
}) {
  if (
    !Number.isSafeInteger(detailVertexBudget)
    || detailVertexBudget < 0
    || detailVertexBudget > MAX_DETAIL_VERTEX_BUDGET
  ) {
    throw new RangeError("stone detailVertexBudget must be from 0 through 64");
  }
  if (
    !Number.isSafeInteger(ramBudgetBytes)
    || ramBudgetBytes < COARSE_VECTOR_BYTES
    || ramBudgetBytes > MAX_RAM_BUDGET_BYTES
  ) {
    throw new RangeError("stone ramBudgetBytes cannot exceed 256 MiB");
  }
  if (!Number.isSafeInteger(materialDetailLevel) || materialDetailLevel < 0) {
    throw new RangeError("stone materialDetailLevel must be non-negative");
  }
  if (!Number.isFinite(footprint) || footprint < 0.0) {
    throw new RangeError("stone footprint must be finite and non-negative");
  }
}

function vectorBytes(packet) {
  const channels = packet.material_channels;
  return packet.vertices.byteLength
    + packet.indices.byteLength
    + channels.roughness.byteLength
    + channels.displacement.byteLength
    + channels.surfaceCoordinates.byteLength
    + channels.baseNormals.byteLength;
}

function materializePackets(packets, field, options, radii) {
  return Object.freeze(packets.map((packet) => (
    adaptRockMaterialToRendererPacketReference(packet, field, {
      radii,
      detailLevel: options.materialDetailLevel,
      footprint: options.footprint,
    })
  )));
}

function sceneSnapshot({
  frame,
  materialPackets,
  workingSet,
  selection,
  effectiveDetailVertexBudget,
  ramBudgetBytes,
}) {
  const bytes = materialPackets.reduce(
    (sum, packet) => sum + vectorBytes(packet),
    0,
  );
  if (bytes > ramBudgetBytes) {
    throw new RangeError("stone adaptive materialization exceeded RAM budget");
  }
  return Object.freeze({
    kind: "procedural-stone-adaptive-scene:v1",
    frame,
    materialPackets,
    selection,
    detailUsage: workingSet.usage,
    changes: workingSet.changes,
    effectiveDetailVertexBudget,
    vectorBytes: bytes,
    ramBudgetBytes,
  });
}

export function createProceduralStoneAdaptiveSceneReference(options) {
  const {
    identity,
    radii,
    detailVertexBudget,
    ramBudgetBytes,
  } = options;
  requireOptions(options);
  const coarse = createCoarseEllipsoidReference({ radii });
  const field = options.materialField
    ?? createRockMaterialFieldReference(identity);
  const materialOptions = Object.freeze({
    materialDetailLevel: options.materialDetailLevel,
    footprint: options.footprint,
  });
  const memoryCapacity = Math.floor(
    (ramBudgetBytes - COARSE_VECTOR_BYTES) / DETAIL_VECTOR_BYTES,
  );
  const effectiveDetailVertexBudget = Math.min(
    detailVertexBudget,
    memoryCapacity,
  );
  let workingSet = updateEllipsoidRefinementWorkingSetReference(
    coarse,
    null,
    { demands: [], vertexBudget: 0, faceBudget: 0 },
  );
  let geometry = adaptEllipsoidWorkingSetToRetainedGeometryPacketsReference(
    workingSet,
    null,
  );
  let materialPackets = materializePackets(
    geometry.packets,
    field,
    materialOptions,
    coarse.radii,
  );
  let frame = 0;
  let snapshot = sceneSnapshot({
    frame,
    materialPackets,
    workingSet,
    selection: null,
    effectiveDetailVertexBudget,
    ramBudgetBytes,
  });

  return Object.freeze({
    snapshot() {
      return snapshot;
    },
    updateProjectedDemand({ camera, maxErrorPixels }) {
      const selection = selectEllipsoidViewDemandReference(coarse, {
        camera,
        maxErrorPixels,
        budget: effectiveDetailVertexBudget,
      });
      const selected = new Set(selection.demands);
      const demands = selection.candidates.filter(({ face }) => (
        selected.has(face)
      ));
      const nextWorkingSet = updateEllipsoidRefinementWorkingSetReference(
        coarse,
        workingSet,
        {
          demands,
          vertexBudget: effectiveDetailVertexBudget,
          faceBudget: effectiveDetailVertexBudget * 3,
        },
      );
      const nextGeometry =
        adaptEllipsoidWorkingSetToRetainedGeometryPacketsReference(
          nextWorkingSet,
          geometry,
        );
      const nextMaterialPackets = materializePackets(
        nextGeometry.packets,
        field,
        materialOptions,
        coarse.radii,
      );
      frame += 1;
      workingSet = nextWorkingSet;
      geometry = nextGeometry;
      materialPackets = nextMaterialPackets;
      snapshot = sceneSnapshot({
        frame,
        materialPackets,
        workingSet,
        selection,
        effectiveDetailVertexBudget,
        ramBudgetBytes,
      });
      return snapshot;
    },
  });
}
