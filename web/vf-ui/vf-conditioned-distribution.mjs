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

function conditionToken(stream) {
  const words = [...stream.key, ...stream.counterPrefix];
  return `condition:v1:${words.map((word) => word.toString(16).padStart(8, '0')).join(':')}`;
}

function snapshotNode(identity, canonicalHierarchy = identity.hierarchy) {
  const node = Object.freeze({
    generator: identity.generator,
    version: identity.version,
    seed: Object.freeze([...identity.seed]),
    domain: identity.domain,
    hierarchy: Object.freeze([...identity.hierarchy]),
    lod: identity.lod,
    channel: identity.channel,
  });
  nodeState.set(node, {
    stream: deriveDemandStream({
      ...node,
      hierarchy: canonicalHierarchy,
    }),
  });
  return node;
}

export function createConditionedRoot(identity) {
  return snapshotNode(identity);
}

export function conditionChild(parent, { segment, channel }) {
  const { stream: parentStream } = requireNode(parent);
  if (typeof segment !== 'string') {
    throw new TypeError('child hierarchy segment must be a string');
  }
  if (typeof channel !== 'string') {
    throw new TypeError('child channel must be a string');
  }
  const identity = {
    ...parent,
    hierarchy: [...parent.hierarchy, segment],
    channel,
  };
  return snapshotNode(identity, [
    ...parent.hierarchy,
    conditionToken(parentStream),
    segment,
  ]);
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

function requireCategoricalWeights(weights) {
  const isTypedArray = ArrayBuffer.isView(weights) && !(weights instanceof DataView);
  if (!Array.isArray(weights) && !isTypedArray) {
    throw new TypeError('categorical weights must be an array or typed array');
  }
  if (weights.length === 0) {
    throw new RangeError('categorical weights must not be empty');
  }
  let total = 0;
  let lastPositiveIndex = -1;
  for (let index = 0; index < weights.length; index += 1) {
    const weight = weights[index];
    if (typeof weight !== 'number') {
      throw new TypeError(`categorical weight[${index}] must be a number`);
    }
    if (!Number.isFinite(weight) || weight < 0) {
      throw new RangeError(`categorical weight[${index}] must be finite and non-negative`);
    }
    total += weight;
    if (!Number.isFinite(total)) {
      throw new RangeError('categorical weight total must be finite');
    }
    if (weight > 0) {
      lastPositiveIndex = index;
    }
  }
  if (!(total > 0)) {
    throw new RangeError('categorical weights must contain a positive weight');
  }
  return { total, lastPositiveIndex };
}

export function sampleWeightedCategoricalIndex(node, sample, weights) {
  const { stream } = requireNode(node);
  requireSample(sample);
  const { total, lastPositiveIndex } = requireCategoricalWeights(weights);
  const target = (sampleDemandStreamU32(stream, sample) / U32_RANGE) * total;
  let cumulative = 0;
  for (let index = 0; index < weights.length; index += 1) {
    cumulative += weights[index];
    if (target < cumulative) {
      return index;
    }
  }
  return lastPositiveIndex;
}

export function normalReferenceFromU32(
  words,
  { mean, standardDeviation },
) {
  requireSample(words);
  if (!Number.isFinite(mean)) {
    throw new RangeError('normal mean must be finite');
  }
  if (!Number.isFinite(standardDeviation) || standardDeviation < 0) {
    throw new RangeError('normal standard deviation must be finite and non-negative');
  }
  const radiusUniform = (words[0] + 0.5) / U32_RANGE;
  const angleUniform = words[1] / U32_RANGE;
  const standard = Math.sqrt(-2 * Math.log(radiusUniform))
    * Math.cos(2 * Math.PI * angleUniform);
  return mean + standardDeviation * standard;
}

export function correlatedNormal2ReferenceFromU32(
  words,
  { mean, standardDeviation, correlation },
) {
  requireSample(words);
  const radiusUniform = (words[0] + 0.5) / U32_RANGE;
  const angleUniform = words[1] / U32_RANGE;
  const radius = Math.sqrt(-2 * Math.log(radiusUniform));
  const angle = 2 * Math.PI * angleUniform;
  const firstStandard = radius * Math.cos(angle);
  const secondStandard = radius * Math.sin(angle);
  return [
    mean[0] + standardDeviation[0] * firstStandard,
    mean[1] + standardDeviation[1] * (
      correlation * firstStandard
      + Math.sqrt(1 - correlation * correlation) * secondStandard
    ),
  ];
}

export function sampleNormalReference(
  node,
  sample,
  { mean, standardDeviation },
) {
  const { stream } = requireNode(node);
  requireSample(sample);
  const words = philox4x32_10([
    stream.counterPrefix[0],
    stream.counterPrefix[1],
    sample[0],
    sample[1],
  ], stream.key);
  return normalReferenceFromU32([words[0], words[1]], { mean, standardDeviation });
}
