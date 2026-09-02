const MAX_RESOURCES = 256;
const STORAGE_USAGE = globalThis.GPUBufferUsage?.STORAGE ?? 0x0080;
const COPY_DST_USAGE = globalThis.GPUBufferUsage?.COPY_DST ?? 0x0008;

function requireDevice(device) {
  if (
    typeof device?.createBuffer !== "function"
    || typeof device?.createBindGroup !== "function"
    || typeof device?.queue?.writeBuffer !== "function"
  ) {
    throw new TypeError("WebGPU device with queue is required");
  }
}

function requireBudget(resourceBudget) {
  if (
    !Number.isSafeInteger(resourceBudget)
    || resourceBudget < 1
    || resourceBudget > MAX_RESOURCES
  ) {
    throw new RangeError("wood spectral resourceBudget must be 1 through 256");
  }
}

function requirePacket(packet) {
  const descriptor = packet?.wood_spectral_presentation_gpu;
  if (
    packet?.kind !== "wood-cut-material-triangle-packet:v1"
    || descriptor?.kind !== "wood-spectral-presentation-gpu:v1"
    || descriptor.version !== 1
    || !(descriptor.floats instanceof Float32Array)
    || descriptor.floats.length === 0
    || descriptor.byteLength !== descriptor.floats.byteLength
    || descriptor.byteLength % 16 !== 0
  ) {
    throw new TypeError(
      "wood renderer packet with spectral presentation is required",
    );
  }
  return descriptor;
}

export function createWoodSpectralRendererGpuArenaReference(
  device,
  { resourceBudget },
) {
  requireDevice(device);
  requireBudget(resourceBudget);
  const resources = new Map();
  const handleResources = new WeakMap();
  const releasedHandles = new WeakSet();
  let liveAcquisitions = 0;
  let createdBuffers = 0;
  let destroyedBuffers = 0;
  let uploadedBytes = 0;
  let drawBindings = 0;

  function acquire(packet) {
    const descriptor = requirePacket(packet);
    let resource = resources.get(descriptor);
    if (!resource) {
      if (resources.size >= resourceBudget) {
        throw new RangeError("wood spectral GPU resource budget is exhausted");
      }
      const materialBuffer = device.createBuffer({
        label: "VKF wood spectral presentation material",
        size: descriptor.byteLength,
        usage: STORAGE_USAGE | COPY_DST_USAGE,
      });
      device.queue.writeBuffer(materialBuffer, 0, descriptor.floats);
      resource = {
        descriptor,
        materialBuffer,
        referenceCount: 0,
      };
      resources.set(descriptor, resource);
      createdBuffers += 1;
      uploadedBytes += descriptor.byteLength;
    }
    resource.referenceCount += 1;
    liveAcquisitions += 1;
    const handle = Object.freeze({
      kind: "wood-spectral-renderer-gpu-acquisition:v1",
      packet,
      descriptor,
      materialBuffer: resource.materialBuffer,
      byteLength: descriptor.byteLength,
    });
    handleResources.set(handle, resource);
    return handle;
  }

  function requireLiveHandle(handle) {
    const resource = handleResources.get(handle);
    if (!resource) {
      throw new TypeError("wood spectral GPU acquisition is required");
    }
    if (releasedHandles.has(handle)) {
      throw new RangeError("wood spectral GPU acquisition is already released");
    }
    return resource;
  }

  function createDrawBinding(handle, pipeline, outputBuffer) {
    const resource = requireLiveHandle(handle);
    if (
      typeof pipeline?.getBindGroupLayout !== "function"
      || !outputBuffer
    ) {
      throw new TypeError(
        "wood spectral pipeline and output buffer are required",
      );
    }
    const binding = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: resource.materialBuffer } },
        { binding: 1, resource: { buffer: outputBuffer } },
      ],
    });
    drawBindings += 1;
    return binding;
  }

  function release(handle) {
    const resource = requireLiveHandle(handle);
    releasedHandles.add(handle);
    resource.referenceCount -= 1;
    liveAcquisitions -= 1;
    if (resource.referenceCount === 0) {
      resource.materialBuffer.destroy();
      resources.delete(resource.descriptor);
      destroyedBuffers += 1;
    }
  }

  function snapshot() {
    return Object.freeze({
      resourceBudget,
      liveResources: resources.size,
      liveAcquisitions,
      createdBuffers,
      destroyedBuffers,
      uploadedBytes,
      drawBindings,
    });
  }

  return Object.freeze({
    kind: "wood-spectral-renderer-gpu-arena:v1",
    resourceBudget,
    acquire,
    createDrawBinding,
    release,
    snapshot,
  });
}
