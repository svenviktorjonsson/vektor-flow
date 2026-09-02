const MAX_PACKETS = 4096;
const COPY_DST = 0x0008;
const INDEX = 0x0010;
const VERTEX = 0x0020;
const STORAGE = 0x0080;

function requireConfiguration(device, packetBudget) {
  if (
    typeof device?.createBuffer !== 'function'
    || typeof device?.queue?.writeBuffer !== 'function'
  ) {
    throw new TypeError('road renderer GPU device is required');
  }
  if (
    !Number.isSafeInteger(packetBudget)
    || packetBudget < 1
    || packetBudget > MAX_PACKETS
  ) {
    throw new RangeError('road renderer packetBudget must be 1 through 4096');
  }
}

function materialFloats(packet) {
  const channels = packet.material_channels;
  return new Float32Array([
    ...channels.albedo,
    channels.roughness[0],
    channels.wetness[0],
    packet.specular_strength,
    channels.wearDisplacement[0],
    0,
  ]);
}

function createUploadedBuffer(device, label, source, usage) {
  const buffer = device.createBuffer({
    label,
    size: source.byteLength,
    usage: usage | COPY_DST,
  });
  device.queue.writeBuffer(buffer, 0, source);
  return buffer;
}

function createResources(device, packet) {
  const material = materialFloats(packet);
  return Object.freeze({
    kind: 'road-renderer-gpu-resources:v1',
    packet,
    vertexBuffer: createUploadedBuffer(
      device,
      `${packet.id}:vertices`,
      packet.vertices,
      VERTEX,
    ),
    indexBuffer: createUploadedBuffer(
      device,
      `${packet.id}:indices`,
      packet.indices,
      INDEX,
    ),
    materialBuffer: createUploadedBuffer(
      device,
      `${packet.id}:material`,
      material,
      STORAGE,
    ),
    uploadedBytes: packet.vertices.byteLength
      + packet.indices.byteLength
      + material.byteLength,
  });
}

function destroyResources(resources) {
  resources.vertexBuffer.destroy();
  resources.indexBuffer.destroy();
  resources.materialBuffer.destroy();
}

function validMesh(packet) {
  const channels = packet?.material_channels;
  return packet?.type === 'field_mesh'
    && typeof packet.id === 'string'
    && packet.id.length > 0
    && packet.vertices instanceof Float32Array
    && packet.vertices.length > 0
    && packet.indices instanceof Uint32Array
    && packet.indices.length > 0
    && channels?.albedo instanceof Float32Array
    && channels.albedo.length === 3
    && channels.roughness instanceof Float32Array
    && channels.roughness.length === 1
    && channels.wetness instanceof Float32Array
    && channels.wetness.length === 1
    && channels.wearDisplacement instanceof Float32Array
    && channels.wearDisplacement.length === 1
    && Number.isFinite(packet.specular_strength);
}

function requirePacket(packet, retained) {
  if (
    packet?.kind !== 'procedural-road-renderer-packet:v1'
    || !Array.isArray(packet.packets)
    || !Array.isArray(packet.delta?.upsert)
    || !Array.isArray(packet.delta?.remove)
    || !Array.isArray(packet.delta?.unchanged)
    || packet.packets.some((mesh) => !validMesh(mesh))
    || packet.delta.upsert.some((mesh) => !validMesh(mesh))
    || packet.delta.remove.some((id) => typeof id !== 'string')
    || packet.delta.unchanged.some((id) => typeof id !== 'string')
  ) {
    throw new TypeError('road renderer packet delta is invalid');
  }
  const finalById = new Map(packet.packets.map((mesh) => [mesh.id, mesh]));
  const upsertById = new Map(packet.delta.upsert.map((mesh) => [mesh.id, mesh]));
  if (
    finalById.size !== packet.packets.length
    || upsertById.size !== packet.delta.upsert.length
    || new Set(packet.delta.remove).size !== packet.delta.remove.length
    || new Set(packet.delta.unchanged).size !== packet.delta.unchanged.length
    || packet.delta.upsert.some((mesh) => finalById.get(mesh.id) !== mesh)
    || packet.delta.remove.some((id) => finalById.has(id))
    || packet.delta.unchanged.some((id) => (
      finalById.get(id) !== retained.get(id)?.packet
    ))
    || packet.packets.some((mesh) => (
      upsertById.get(mesh.id) !== mesh
      && retained.get(mesh.id)?.packet !== mesh
    ))
  ) {
    throw new TypeError('road renderer packet delta is invalid');
  }
}

export function createRoadRendererDrawPipelineReference(
  device,
  { packetBudget },
) {
  requireConfiguration(device, packetBudget);
  const retained = new Map();
  let lastFrame = -1;
  let frames = 0;
  let draws = 0;
  let uploadedBytes = 0;
  let destroyedBuffers = 0;
  let destroyed = false;

  function release(id) {
    const resources = retained.get(id);
    if (!resources) return;
    retained.delete(id);
    destroyResources(resources);
    destroyedBuffers += 3;
  }

  function draw({ frame, packet }) {
    if (destroyed) {
      throw new RangeError('road renderer draw pipeline is destroyed');
    }
    if (!Number.isSafeInteger(frame) || frame < 0 || frame < lastFrame) {
      throw new RangeError(
        'road renderer frame must be a non-decreasing non-negative integer',
      );
    }
    requirePacket(packet, retained);
    if (packet.packets.length > packetBudget) {
      throw new RangeError('road renderer retained packet budget is exhausted');
    }
    for (const id of packet.delta.remove) release(id);
    for (const next of packet.delta.upsert) {
      release(next.id);
      const resources = createResources(device, next);
      retained.set(next.id, resources);
      uploadedBytes += resources.uploadedBytes;
    }
    const resources = Object.freeze(packet.packets.map((next) => (
      retained.get(next.id)
    )));
    if (frame !== lastFrame) {
      frames += 1;
      lastFrame = frame;
    }
    draws += 1;
    return Object.freeze({
      kind: 'road-renderer-draw:v1',
      frame,
      packet,
      resources,
    });
  }

  function destroy() {
    if (destroyed) return;
    for (const id of Array.from(retained.keys())) release(id);
    destroyed = true;
  }

  function snapshot() {
    return Object.freeze({
      packetBudget,
      retainedPackets: retained.size,
      frames,
      draws,
      uploadedBytes,
      destroyedBuffers,
      destroyed,
    });
  }

  return Object.freeze({
    kind: 'road-renderer-draw-pipeline:v1',
    draw,
    destroy,
    snapshot,
  });
}
