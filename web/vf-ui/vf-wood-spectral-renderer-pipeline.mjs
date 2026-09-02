import {
  createWoodSpectralRendererGpuArenaReference,
} from "./vf-wood-spectral-renderer-gpu.mjs";

const MAX_PACKETS = 1024;

function requirePacketBudget(packetBudget) {
  if (
    !Number.isSafeInteger(packetBudget)
    || packetBudget < 1
    || packetBudget > MAX_PACKETS
  ) {
    throw new RangeError("wood spectral packetBudget must be 1 through 1024");
  }
}

export function createWoodSpectralRendererDrawPipelineReference(
  device,
  { resourceBudget, packetBudget },
) {
  requirePacketBudget(packetBudget);
  const arena = createWoodSpectralRendererGpuArenaReference(device, {
    resourceBudget,
  });
  const retained = new Map();
  const bufferReferences = new Map();
  const bindingCaches = new Map();
  let lastFrame = -1;
  let frames = 0;
  let draws = 0;
  let bindingCreations = 0;
  let bindingReuses = 0;
  let liveBindings = 0;
  let destroyed = false;

  function requireAlive() {
    if (destroyed) {
      throw new RangeError("wood spectral draw pipeline is destroyed");
    }
  }

  function retainPacket(packet) {
    let state = retained.get(packet);
    if (state) return state;
    if (retained.size >= packetBudget) {
      throw new RangeError("wood spectral retained packet budget is exhausted");
    }
    const acquisition = arena.acquire(packet);
    state = { packet, acquisition };
    retained.set(packet, state);
    const materialBuffer = acquisition.materialBuffer;
    bufferReferences.set(
      materialBuffer,
      (bufferReferences.get(materialBuffer) ?? 0) + 1,
    );
    return state;
  }

  function bindingFor(state, pipeline, outputBuffer) {
    const materialBuffer = state.acquisition.materialBuffer;
    let bufferCache = bindingCaches.get(materialBuffer);
    if (!bufferCache) {
      bufferCache = { pipelines: new Map(), count: 0 };
      bindingCaches.set(materialBuffer, bufferCache);
    }
    let pipelineCache = bufferCache.pipelines.get(pipeline);
    if (!pipelineCache) {
      pipelineCache = new Map();
      bufferCache.pipelines.set(pipeline, pipelineCache);
    }
    const retainedBinding = pipelineCache.get(outputBuffer);
    if (retainedBinding) {
      bindingReuses += 1;
      return { bindGroup: retainedBinding, reusedBinding: true };
    }
    if (liveBindings >= packetBudget) {
      throw new RangeError("wood spectral draw binding budget is exhausted");
    }
    const bindGroup = arena.createDrawBinding(
      state.acquisition,
      pipeline,
      outputBuffer,
    );
    pipelineCache.set(outputBuffer, bindGroup);
    bufferCache.count += 1;
    liveBindings += 1;
    bindingCreations += 1;
    return { bindGroup, reusedBinding: false };
  }

  function draw({ frame, packet, pipeline, outputBuffer }) {
    requireAlive();
    if (!Number.isSafeInteger(frame) || frame < 0 || frame < lastFrame) {
      throw new RangeError(
        "wood spectral frame must be a non-decreasing non-negative integer",
      );
    }
    if (frame !== lastFrame) {
      frames += 1;
      lastFrame = frame;
    }
    const state = retainPacket(packet);
    const binding = bindingFor(state, pipeline, outputBuffer);
    draws += 1;
    return Object.freeze({
      kind: "wood-spectral-renderer-draw:v1",
      frame,
      packet,
      acquisition: state.acquisition,
      bindGroup: binding.bindGroup,
      reusedBinding: binding.reusedBinding,
    });
  }

  function releasePacket(packet) {
    const state = retained.get(packet);
    if (!state) return false;
    retained.delete(packet);
    const materialBuffer = state.acquisition.materialBuffer;
    const references = bufferReferences.get(materialBuffer) - 1;
    if (references === 0) {
      bufferReferences.delete(materialBuffer);
      const bufferCache = bindingCaches.get(materialBuffer);
      if (bufferCache) {
        liveBindings -= bufferCache.count;
        bindingCaches.delete(materialBuffer);
      }
    } else {
      bufferReferences.set(materialBuffer, references);
    }
    arena.release(state.acquisition);
    return true;
  }

  function destroy() {
    if (destroyed) return;
    for (const packet of Array.from(retained.keys())) {
      releasePacket(packet);
    }
    bindingCaches.clear();
    bufferReferences.clear();
    liveBindings = 0;
    destroyed = true;
  }

  function snapshot() {
    return Object.freeze({
      packetBudget,
      retainedPackets: retained.size,
      liveBindings,
      frames,
      draws,
      bindingCreations,
      bindingReuses,
      destroyed,
      arena: arena.snapshot(),
    });
  }

  return Object.freeze({
    kind: "wood-spectral-renderer-draw-pipeline:v1",
    packetBudget,
    draw,
    releasePacket,
    destroy,
    snapshot,
  });
}
