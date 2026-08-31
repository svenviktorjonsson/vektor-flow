import {
  deriveDemandStream,
  sampleDemandStreamU32,
} from './vf-demand-random.mjs';

const nodeState = new WeakMap();
const U32_RANGE = 0x100000000;

function requireNode(node) {
  const state = nodeState.get(node);
  if (!state) {
    throw new TypeError('conditioned distribution node is required');
  }
  return state;
}

function snapshotNode(identity) {
  const node = Object.freeze({
    generator: identity.generator,
    version: identity.version,
    seed: Object.freeze([...identity.seed]),
    domain: identity.domain,
    hierarchy: Object.freeze([...identity.hierarchy]),
    lod: identity.lod,
    channel: identity.channel,
  });
  nodeState.set(node, { stream: deriveDemandStream(node) });
  return node;
}

export function createConditionedRoot(identity) {
  return snapshotNode(identity);
}

export function conditionChild(parent, { segment, channel }) {
  requireNode(parent);
  if (typeof segment !== 'string') {
    throw new TypeError('child hierarchy segment must be a string');
  }
  if (typeof channel !== 'string') {
    throw new TypeError('child channel must be a string');
  }
  return snapshotNode({
    ...parent,
    hierarchy: [...parent.hierarchy, segment],
    channel,
  });
}

export function sampleBoundedUniform(node, sample, { min, max }) {
  const { stream } = requireNode(node);
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(min < max)) {
    throw new RangeError('bounded uniform requires finite min < max');
  }
  const span = max - min;
  if (!Number.isFinite(span)) {
    throw new RangeError('bounded uniform span must be finite');
  }
  const unit = sampleDemandStreamU32(stream, sample) / U32_RANGE;
  return min + span * unit;
}
