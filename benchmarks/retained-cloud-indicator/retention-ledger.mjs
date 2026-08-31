export function createRetentionLedger() {
  let initialized = false;
  const evidence = {
    initialFixtureBufferWrites: 0,
    initialFixtureBufferBytes: 0,
    initialFixtureBufferAllocations: 0,
    fixtureBufferWritesAfterInitialize: 0,
    fixtureBufferBytesAfterInitialize: 0,
    fixtureBufferReallocationsAfterInitialize: 0,
    cameraUniformWritesAfterInitialize: 0,
    cameraUniformBytesAfterInitialize: 0,
  };
  return Object.freeze({
    recordFixtureUpload(bytes, allocated) {
      if (!Number.isSafeInteger(bytes) || bytes < 1) throw new RangeError('fixture upload bytes must be positive');
      if (initialized) {
        evidence.fixtureBufferWritesAfterInitialize += 1;
        evidence.fixtureBufferBytesAfterInitialize += bytes;
        if (allocated) evidence.fixtureBufferReallocationsAfterInitialize += 1;
      } else {
        evidence.initialFixtureBufferWrites += 1;
        evidence.initialFixtureBufferBytes += bytes;
        if (allocated) evidence.initialFixtureBufferAllocations += 1;
      }
    },
    recordCameraUniformWrite(bytes) {
      if (!Number.isSafeInteger(bytes) || bytes < 1) throw new RangeError('uniform bytes must be positive');
      if (!initialized) return;
      evidence.cameraUniformWritesAfterInitialize += 1;
      evidence.cameraUniformBytesAfterInitialize += bytes;
    },
    markInitialized() { initialized = true; },
    evidence() { return { ...evidence }; },
  });
}

function byteLength(value) {
  if (typeof value === 'number') return value;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value.byteLength;
  return 0;
}

export function installWebGpuFixtureTracker(minimumFixtureBytes, globals = globalThis) {
  if (!Number.isSafeInteger(minimumFixtureBytes) || minimumFixtureBytes < 1) {
    throw new RangeError('minimum fixture bytes must be positive');
  }
  const queuePrototype = globals.GPUQueue?.prototype;
  const devicePrototype = globals.GPUDevice?.prototype;
  if (!queuePrototype || !devicePrototype) throw new Error('WebGPU prototypes are required for retention tracking');
  const originalWriteBuffer = queuePrototype.writeBuffer;
  const originalCreateBuffer = devicePrototype.createBuffer;
  const fixtureBuffers = new Set();
  const creationSizes = new Map();
  const writeHistory = [];
  let initialized = false;
  let fixtureBufferWritesAfterInitialize = 0;
  let fixtureBufferBytesAfterInitialize = 0;
  let fixtureBufferReallocationsAfterInitialize = 0;
  queuePrototype.writeBuffer = function(buffer, offset, source, ...rest) {
    const bytes = byteLength(source);
    writeHistory.push({ buffer, bytes, initialized });
    if (initialized && fixtureBuffers.has(buffer)) {
      fixtureBufferWritesAfterInitialize += 1;
      fixtureBufferBytesAfterInitialize += bytes;
    }
    return originalWriteBuffer.call(this, buffer, offset, source, ...rest);
  };
  devicePrototype.createBuffer = function(descriptor) {
    const buffer = originalCreateBuffer.call(this, descriptor);
    const size = Number(descriptor?.size) || 0;
    creationSizes.set(buffer, size);
    if (initialized && size >= minimumFixtureBytes) fixtureBufferReallocationsAfterInitialize += 1;
    return buffer;
  };
  return Object.freeze({
    registerFixtureBuffer(buffer) {
      if (!creationSizes.has(buffer)) throw new Error('fixture buffer was not created under the tracker');
      fixtureBuffers.add(buffer);
    },
    markInitialized() { initialized = true; },
    evidence() {
      let initialFixtureBufferWrites = 0;
      let initialFixtureBufferBytes = 0;
      for (const write of writeHistory) {
        if (!write.initialized && fixtureBuffers.has(write.buffer)) {
          initialFixtureBufferWrites += 1;
          initialFixtureBufferBytes += write.bytes;
        }
      }
      return {
        initialFixtureBufferWrites,
        initialFixtureBufferBytes,
        initialFixtureBufferAllocations: fixtureBuffers.size,
        fixtureBufferWritesAfterInitialize,
        fixtureBufferBytesAfterInitialize,
        fixtureBufferReallocationsAfterInitialize,
      };
    },
    restore() {
      queuePrototype.writeBuffer = originalWriteBuffer;
      devicePrototype.createBuffer = originalCreateBuffer;
    },
  });
}
