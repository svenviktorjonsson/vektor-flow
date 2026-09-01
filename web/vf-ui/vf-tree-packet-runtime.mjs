function requireByteBudget(byteBudget) {
  if (!Number.isSafeInteger(byteBudget) || byteBudget < 0) {
    throw new RangeError('tree packet byteBudget must be a non-negative safe integer');
  }
}

function requirePacket(packet) {
  if (
    !packet
    || packet.kind !== 'tree-render-packet:v1'
    || typeof packet.id !== 'string'
    || packet.id.length === 0
    || !Number.isSafeInteger(packet.treeIndex)
    || packet.treeIndex < 0
    || !Number.isSafeInteger(packet.primitiveCount)
    || packet.primitiveCount < 0
    || !Number.isSafeInteger(packet.vectorBytes)
    || packet.vectorBytes < 0
  ) {
    throw new TypeError('tree render packet is required');
  }
}

function requireDelta(delta) {
  if (
    !delta
    || typeof delta !== 'object'
    || !Array.isArray(delta.upsert)
    || !Array.isArray(delta.remove)
    || !Array.isArray(delta.unchanged)
    || !delta.upload
    || typeof delta.upload !== 'object'
  ) {
    throw new TypeError('tree render packet delta is required');
  }
}

function stablePacketOrder(first, second) {
  return first.treeIndex - second.treeIndex
    || first.id.localeCompare(second.id);
}

function summarize(byId, byteBudget) {
  const packets = [...byId.values()].sort(stablePacketOrder);
  return {
    packets,
    status: Object.freeze({
      packetCount: packets.length,
      primitiveCount: packets.reduce(
        (sum, packet) => sum + packet.primitiveCount,
        0,
      ),
      bytes: packets.reduce((sum, packet) => sum + packet.vectorBytes, 0),
      byteBudget,
    }),
  };
}

export function createTreePacketRuntimeCacheReference({
  byteBudget,
  requestRender = () => {},
}) {
  requireByteBudget(byteBudget);
  if (typeof requestRender !== 'function') {
    throw new TypeError('tree packet requestRender must be a function');
  }
  let byId = new Map();

  function packets() {
    return Object.freeze(summarize(byId, byteBudget).packets);
  }

  function status() {
    return summarize(byId, byteBudget).status;
  }

  function applyDelta(delta) {
    requireDelta(delta);
    const next = new Map(byId);
    let changed = false;
    const removed = delta.remove.map(String);
    for (const id of removed) {
      changed = next.delete(id) || changed;
    }
    for (const packet of delta.upsert) {
      requirePacket(packet);
      if (next.get(packet.id) !== packet) {
        next.set(packet.id, packet);
        changed = true;
      }
    }
    const summary = summarize(next, byteBudget);
    if (summary.status.bytes > byteBudget) {
      throw new RangeError(
        `tree packet cache requires ${summary.status.bytes} bytes; budget is ${byteBudget}`,
      );
    }
    byId = next;
    const receipt = Object.freeze({
      changed,
      upserted: Object.freeze(delta.upsert.map(({ id }) => String(id))),
      removed: Object.freeze(removed),
      packetCount: summary.status.packetCount,
      primitiveCount: summary.status.primitiveCount,
      bytes: summary.status.bytes,
      upload: delta.upload,
    });
    if (changed) {
      requestRender(Object.freeze(summary.packets), receipt);
    }
    return receipt;
  }

  return Object.freeze({ applyDelta, packets, status });
}
