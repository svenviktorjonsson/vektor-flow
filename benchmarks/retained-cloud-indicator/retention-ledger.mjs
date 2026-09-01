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

export function installWebGlFixtureTracker(minimumFixtureBytes, globals = globalThis) {
  if (!Number.isSafeInteger(minimumFixtureBytes) || minimumFixtureBytes < 1) {
    throw new RangeError('minimum fixture bytes must be positive');
  }
  const originals = [];
  const fixtureBuffers = new Set();
  const boundBuffers = new WeakMap();
  let initialized = false;
  let initialFixtureBufferWrites = 0;
  let initialFixtureBufferBytes = 0;
  let fixtureBufferWritesAfterInitialize = 0;
  let fixtureBufferBytesAfterInitialize = 0;
  let fixtureBufferReallocationsAfterInitialize = 0;
  const constructors = new Set([
    globals.WebGLRenderingContext,
    globals.WebGL2RenderingContext,
  ]);
  for (const constructor of constructors) {
    const prototype = constructor?.prototype;
    if (!prototype) continue;
    const originalBindBuffer = prototype.bindBuffer;
    if (typeof originalBindBuffer === 'function') {
      originals.push([prototype, 'bindBuffer', originalBindBuffer]);
      prototype.bindBuffer = function(target, buffer, ...rest) {
        let targets = boundBuffers.get(this);
        if (!targets) { targets = new Map(); boundBuffers.set(this, targets); }
        targets.set(target, buffer);
        return originalBindBuffer.call(this, target, buffer, ...rest);
      };
    }
    for (const method of ['bufferData', 'bufferSubData']) {
      const original = prototype[method];
      if (typeof original !== 'function') continue;
      originals.push([prototype, method, original]);
      prototype[method] = function(target, ...rest) {
        const bytes = byteLength(method === 'bufferData' ? rest[0] : rest[1]);
        const buffer = boundBuffers.get(this)?.get(target) ?? null;
        if (buffer && bytes >= minimumFixtureBytes) {
          const allocationOnly = method === 'bufferData' && typeof rest[0] === 'number';
          if (initialized) {
            if (method === 'bufferData') fixtureBufferReallocationsAfterInitialize += 1;
            if (!allocationOnly) {
              fixtureBufferWritesAfterInitialize += 1;
              fixtureBufferBytesAfterInitialize += bytes;
            }
          } else {
            fixtureBuffers.add(buffer);
            if (!allocationOnly) {
              initialFixtureBufferWrites += 1;
              initialFixtureBufferBytes += bytes;
            }
          }
        }
        return original.call(this, target, ...rest);
      };
    }
  }
  if (originals.length === 0) throw new Error('WebGL prototypes are required for retention tracking');
  return Object.freeze({
    markInitialized() { initialized = true; },
    evidence() {
      return {
        initialFixtureBufferWrites,
        initialFixtureBufferBytes,
        initialFixtureBufferAllocations: fixtureBuffers.size,
        fixtureBufferWritesAfterInitialize,
        fixtureBufferBytesAfterInitialize,
        fixtureBufferReallocationsAfterInitialize,
        fixtureBufferMapsAfterInitialize: 0,
        fixtureBufferCopiesAfterInitialize: 0,
        largeMappedAtCreationAfterInitialize: 0,
      };
    },
    restore() {
      for (const [prototype, method, original] of originals.reverse()) prototype[method] = original;
    },
  });
}

export function installWebGpuFixtureTracker(minimumFixtureBytes, globals = globalThis) {
  if (!Number.isSafeInteger(minimumFixtureBytes) || minimumFixtureBytes < 1) {
    throw new RangeError('minimum fixture bytes must be positive');
  }
  const queuePrototype = globals.GPUQueue?.prototype;
  const devicePrototype = globals.GPUDevice?.prototype;
  const bufferPrototype = globals.GPUBuffer?.prototype;
  const encoderPrototype = globals.GPUCommandEncoder?.prototype;
  if (!queuePrototype || !devicePrototype) throw new Error('WebGPU prototypes are required for retention tracking');
  const originalWriteBuffer = queuePrototype.writeBuffer;
  const originalCreateBuffer = devicePrototype.createBuffer;
  const originalMapAsync = bufferPrototype?.mapAsync;
  const originalCopyBufferToBuffer = encoderPrototype?.copyBufferToBuffer;
  const fixtureBuffers = new Set();
  const creationSizes = new Map();
  const writeHistory = [];
  let initialized = false;
  let fixtureBufferWritesAfterInitialize = 0;
  let fixtureBufferBytesAfterInitialize = 0;
  let fixtureBufferReallocationsAfterInitialize = 0;
  let fixtureBufferMapsAfterInitialize = 0;
  let fixtureBufferCopiesAfterInitialize = 0;
  let largeMappedAtCreationAfterInitialize = 0;
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
    if (initialized && size >= minimumFixtureBytes) {
      fixtureBufferReallocationsAfterInitialize += 1;
      if (descriptor?.mappedAtCreation === true) largeMappedAtCreationAfterInitialize += 1;
    }
    return buffer;
  };
  if (typeof originalMapAsync === 'function') {
    bufferPrototype.mapAsync = function(...args) {
      if (initialized && fixtureBuffers.has(this)) {
        fixtureBufferWritesAfterInitialize += 1;
        fixtureBufferBytesAfterInitialize += creationSizes.get(this) ?? 0;
        fixtureBufferMapsAfterInitialize += 1;
      }
      return originalMapAsync.apply(this, args);
    };
  }
  if (typeof originalCopyBufferToBuffer === 'function') {
    encoderPrototype.copyBufferToBuffer = function(source, sourceOffset, destination, destinationOffset, size) {
      if (initialized && fixtureBuffers.has(destination)) {
        fixtureBufferWritesAfterInitialize += 1;
        fixtureBufferBytesAfterInitialize += Number(size) || 0;
        fixtureBufferCopiesAfterInitialize += 1;
      }
      return originalCopyBufferToBuffer.call(
        this, source, sourceOffset, destination, destinationOffset, size,
      );
    };
  }
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
        fixtureBufferMapsAfterInitialize,
        fixtureBufferCopiesAfterInitialize,
        largeMappedAtCreationAfterInitialize,
      };
    },
    restore() {
      queuePrototype.writeBuffer = originalWriteBuffer;
      devicePrototype.createBuffer = originalCreateBuffer;
      if (typeof originalMapAsync === 'function') bufferPrototype.mapAsync = originalMapAsync;
      if (typeof originalCopyBufferToBuffer === 'function') {
        encoderPrototype.copyBufferToBuffer = originalCopyBufferToBuffer;
      }
    },
  });
}
