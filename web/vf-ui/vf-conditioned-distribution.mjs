import {
  deriveDemandStream,
  philox4x32_10,
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

function requireSample(sample) {
  if (!sample || sample.length !== 2) {
    throw new TypeError('conditioned sample must contain two u32 words');
  }
  for (let index = 0; index < sample.length; index += 1) {
    const word = sample[index];
    if (!Number.isInteger(word) || word < 0 || word > 0xffffffff) {
      throw new TypeError(`conditioned sample[${index}] must be a u32`);
    }
  }
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

export function sampleNormalReference(
  node,
  sample,
  { mean, standardDeviation },
) {
  const { stream } = requireNode(node);
  requireSample(sample);
  if (!Number.isFinite(mean)) {
    throw new RangeError('normal mean must be finite');
  }
  if (!Number.isFinite(standardDeviation) || standardDeviation < 0) {
    throw new RangeError('normal standard deviation must be finite and non-negative');
  }
  const words = philox4x32_10([
    stream.counterPrefix[0],
    stream.counterPrefix[1],
    sample[0],
    sample[1],
  ], stream.key);
  const radiusUniform = (words[0] + 0.5) / U32_RANGE;
  const angleUniform = words[1] / U32_RANGE;
  const standard = Math.sqrt(-2 * Math.log(radiusUniform))
    * Math.cos(2 * Math.PI * angleUniform);
  return mean + standardDeviation * standard;
}
