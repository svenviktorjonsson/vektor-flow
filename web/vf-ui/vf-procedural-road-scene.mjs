import {
  createProceduralMaterialSceneFrameSchedulerReference,
} from './vf-procedural-material-scene-frame.mjs';
import {
  adaptRoadRefinementToConstructionPacketsReference,
} from './vf-road-construction-renderer-packets.mjs';
import {
  updateRoadRefinementWorkingSetReference,
} from './vf-road-refinement-working-set.mjs';
import {
  adaptRoadConstructionToWearPacketsReference,
} from './vf-road-wear-renderer-packets.mjs';

function scenePacket(wearPackets) {
  return Object.freeze({
    kind: 'procedural-road-renderer-packet:v1',
    packets: wearPackets.packets,
    delta: wearPackets.delta,
  });
}

function requireFrameRequest({ pipeline, outputBuffer, submit }) {
  if (!pipeline || !outputBuffer || typeof submit !== 'function') {
    throw new TypeError('procedural material scene-frame request is required');
  }
}

export function createProceduralRoadSceneReference({
  coordinateField,
  constructionField,
  wearField,
  drawPipeline,
  scheduleFrame,
  frameBudget,
}) {
  const scheduler = createProceduralMaterialSceneFrameSchedulerReference({
    drawPipeline,
    scheduleFrame,
    frameBudget,
  });
  let refinement = null;
  let constructionPackets = null;
  let wearPackets = null;

  function requestFrame({
    demands,
    cellBudget,
    pipeline,
    outputBuffer,
    submit,
  }) {
    try {
      requireFrameRequest({ pipeline, outputBuffer, submit });
    } catch (error) {
      return Promise.reject(error);
    }
    refinement = updateRoadRefinementWorkingSetReference(
      coordinateField,
      refinement,
      { demands, cellBudget },
    );
    constructionPackets = adaptRoadRefinementToConstructionPacketsReference(
      refinement,
      coordinateField,
      constructionField,
      constructionPackets,
    );
    wearPackets = adaptRoadConstructionToWearPacketsReference(
      constructionPackets,
      refinement,
      wearField,
      wearPackets,
    );
    return scheduler.requestFrame({
      packet: scenePacket(wearPackets),
      pipeline,
      outputBuffer,
      submit,
    });
  }

  function snapshot() {
    return Object.freeze({
      kind: 'procedural-road-scene:v1',
      refinement,
      constructionPackets,
      wearPackets,
      vectorBytes: wearPackets?.packets.reduce(
        (sum, packet) => sum + packet.vectorBytes,
        0,
      ) ?? 0,
      scheduler: scheduler.snapshot(),
    });
  }

  return Object.freeze({
    kind: 'procedural-road-scene:v1',
    requestFrame,
    destroy: scheduler.destroy,
    snapshot,
  });
}
