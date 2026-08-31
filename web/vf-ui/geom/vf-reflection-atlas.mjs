function finiteInteger(value, label, minimum = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < minimum) {
    throw new RangeError(`${label} must be an integer at least ${minimum}`);
  }
  return number;
}

function nonEmptyString(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${label} must be non-empty`);
  return text;
}

function slotId(slotIndex) {
  return `reflection-atlas-slot-${slotIndex}`;
}

function canonicalJob(input) {
  if (!input || typeof input !== 'object') throw new TypeError('reflection atlas job must be an object');
  return {
    clusterId: nonEmptyString(input.clusterId, 'reflection atlas job clusterId'),
    cacheKey: nonEmptyString(input.cacheKey, 'reflection atlas job cacheKey'),
    allocatedPixels: finiteInteger(input.allocatedPixels, 'reflection atlas job allocatedPixels', 1)
  };
}

function previousSlots(previous) {
  if (previous == null) return [];
  if (!previous || !Array.isArray(previous.slots)) {
    throw new TypeError('previous reflection atlas requires slots');
  }
  const clusterIds = new Set();
  const slotIndices = new Set();
  return previous.slots.map(input => {
    if (!input || typeof input !== 'object') throw new TypeError('previous reflection atlas slot must be an object');
    const slotIndex = finiteInteger(input.slotIndex, 'previous reflection atlas slotIndex');
    const clusterId = nonEmptyString(input.clusterId, 'previous reflection atlas clusterId');
    if (clusterIds.has(clusterId)) throw new RangeError(`duplicate previous reflection atlas cluster "${clusterId}"`);
    if (slotIndices.has(slotIndex)) throw new RangeError(`duplicate previous reflection atlas slot ${slotIndex}`);
    clusterIds.add(clusterId);
    slotIndices.add(slotIndex);
    return {
      slotIndex,
      clusterId,
      cacheKey: nonEmptyString(input.cacheKey, 'previous reflection atlas cacheKey'),
      allocatedPixels: finiteInteger(input.allocatedPixels, 'previous reflection atlas allocatedPixels', 1)
    };
  });
}

export function allocateReflectionAtlas(inputs, options = {}) {
  if (!Array.isArray(inputs)) throw new TypeError('reflection atlas jobs must be an array');
  const maxCaptures = finiteInteger(options.maxCaptures, 'reflection atlas maxCaptures');
  const maxPixels = finiteInteger(options.maxPixels, 'reflection atlas maxPixels');
  const jobs = inputs.map(canonicalJob);
  const seenClusters = new Set();
  for (const job of jobs) {
    if (seenClusters.has(job.clusterId)) throw new RangeError(`duplicate reflection atlas job "${job.clusterId}"`);
    seenClusters.add(job.clusterId);
  }

  const admitted = [];
  const overflow = [];
  let allocatedPixels = 0;
  for (const job of jobs) {
    if (admitted.length >= maxCaptures) {
      overflow.push({ clusterId: job.clusterId, requestedPixels: job.allocatedPixels, reason: 'capture-budget' });
      continue;
    }
    if (job.allocatedPixels > maxPixels - allocatedPixels) {
      overflow.push({ clusterId: job.clusterId, requestedPixels: job.allocatedPixels, reason: 'pixel-budget' });
      continue;
    }
    admitted.push(job);
    allocatedPixels += job.allocatedPixels;
  }

  const oldByCluster = new Map(previousSlots(options.previous).map(slot => [slot.clusterId, slot]));
  const reservedIndices = new Set();
  const assignedIndex = new Map();
  for (const job of admitted) {
    const old = oldByCluster.get(job.clusterId);
    if (old && old.slotIndex < maxCaptures && !reservedIndices.has(old.slotIndex)) {
      reservedIndices.add(old.slotIndex);
      assignedIndex.set(job.clusterId, old.slotIndex);
    }
  }
  let nextSlot = 0;
  for (const job of admitted) {
    if (assignedIndex.has(job.clusterId)) continue;
    while (reservedIndices.has(nextSlot)) nextSlot += 1;
    assignedIndex.set(job.clusterId, nextSlot);
    reservedIndices.add(nextSlot);
  }

  const assignments = admitted.map(job => {
    const old = oldByCluster.get(job.clusterId);
    const index = assignedIndex.get(job.clusterId);
    const reusable = !!old
      && old.slotIndex === index
      && old.cacheKey === job.cacheKey
      && old.allocatedPixels === job.allocatedPixels;
    const status = reusable ? 'reused' : old ? 'invalidated' : 'capture';
    return {
      clusterId: job.clusterId,
      slotId: slotId(index),
      allocatedPixels: job.allocatedPixels,
      cacheKey: job.cacheKey,
      status,
      needsCapture: !reusable
    };
  });
  const slots = assignments.map(assignment => {
    const slotIndex = assignedIndex.get(assignment.clusterId);
    return {
      slotIndex,
      slotId: slotId(slotIndex),
      clusterId: assignment.clusterId,
      cacheKey: assignment.cacheKey,
      allocatedPixels: assignment.allocatedPixels
    };
  }).sort((left, right) => left.slotIndex - right.slotIndex);

  const reusedCaptures = assignments.filter(item => item.status === 'reused').length;
  const invalidatedCaptures = assignments.filter(item => item.status === 'invalidated').length;
  return {
    slots,
    assignments,
    overflow,
    budget: { maxCaptures, maxPixels },
    stats: {
      allocatedCaptures: assignments.length,
      allocatedPixels,
      reusedCaptures,
      invalidatedCaptures,
      newCaptures: assignments.length - reusedCaptures - invalidatedCaptures,
      overflowCount: overflow.length
    }
  };
}
