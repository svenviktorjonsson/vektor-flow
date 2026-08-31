// Internal deterministic-random reference. Philox constants and round layout
// follow Random123's BSD-licensed reference implementation:
// https://github.com/DEShawResearch/random123/blob/main/include/Random123/philox.h

const PHILOX_M0 = 0xd2511f53;
const PHILOX_M1 = 0xcd9e8d57;
const PHILOX_W0 = 0x9e3779b9;
const PHILOX_W1 = 0xbb67ae85;
const textEncoder = new TextEncoder();
const SHA256_K = Uint32Array.of(
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
);

function concatBytes(parts) {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function requireU32(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new TypeError(`${label} must be a u32`);
  }
  return value;
}

function u32Bytes(value, label = 'encoded length') {
  const word = requireU32(value, label);
  return Uint8Array.of(word, word >>> 8, word >>> 16, word >>> 24);
}

function frame(tag, payload) {
  return concatBytes([Uint8Array.of(tag), u32Bytes(payload.length), payload]);
}

function requireWordArray(words, expectedLength, label) {
  if (!words || words.length !== expectedLength) {
    throw new TypeError(`${label} must contain ${expectedLength} u32 words`);
  }
  for (let index = 0; index < words.length; index += 1) {
    requireU32(words[index], `${label}[${index}]`);
  }
}

function wordPairBytes(pair, label) {
  requireWordArray(pair, 2, label);
  return concatBytes([
    u32Bytes(pair[0], `${label}[0]`),
    u32Bytes(pair[1], `${label}[1]`),
  ]);
}

function hierarchyBytes(segments) {
  const encoded = segments.map((segment) => textEncoder.encode(segment));
  return concatBytes([
    u32Bytes(encoded.length),
    ...encoded.flatMap((segment) => [u32Bytes(segment.length), segment]),
  ]);
}

function encodeDemandStreamIdentity(identity) {
  return concatBytes([
    Uint8Array.of(0x56, 0x4b, 0x46, 0x44),
    u32Bytes(1),
    frame(1, textEncoder.encode(identity.generator)),
    frame(2, u32Bytes(identity.version, 'version')),
    frame(3, wordPairBytes(identity.seed, 'seed')),
    frame(4, textEncoder.encode(identity.domain)),
    frame(5, hierarchyBytes(identity.hierarchy)),
    frame(6, u32Bytes(identity.lod, 'lod')),
    frame(7, textEncoder.encode(identity.channel)),
  ]);
}

export function encodeDemandIdentity(identity) {
  return concatBytes([
    encodeDemandStreamIdentity(identity),
    frame(8, wordPairBytes(identity.sample, 'sample')),
  ]);
}

function rotateRight(word, amount) {
  return ((word >>> amount) | (word << (32 - amount))) >>> 0;
}

// FIPS 180-4 SHA-256 is used only to compress the canonical stream identity
// into fixed-width Philox key/counter words. It is not the random generator.
export function sha256Bytes(input) {
  const paddingLength = (64 - ((input.length + 9) % 64)) % 64;
  const padded = new Uint8Array(input.length + 9 + paddingLength);
  padded.set(input);
  padded[input.length] = 0x80;
  const bitLengthHigh = Math.floor(input.length / 0x20000000) >>> 0;
  const bitLengthLow = (input.length << 3) >>> 0;
  const lengthOffset = padded.length - 8;
  for (let index = 0; index < 4; index += 1) {
    padded[lengthOffset + index] = bitLengthHigh >>> (24 - index * 8);
    padded[lengthOffset + 4 + index] = bitLengthLow >>> (24 - index * 8);
  }

  const hash = Uint32Array.of(
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  );
  const words = new Uint32Array(64);

  for (let block = 0; block < padded.length; block += 64) {
    for (let index = 0; index < 16; index += 1) {
      const offset = block + index * 4;
      words[index] = (
        (padded[offset] << 24)
        | (padded[offset + 1] << 16)
        | (padded[offset + 2] << 8)
        | padded[offset + 3]
      ) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const before15 = words[index - 15];
      const before2 = words[index - 2];
      const sigma0 = rotateRight(before15, 7)
        ^ rotateRight(before15, 18)
        ^ (before15 >>> 3);
      const sigma1 = rotateRight(before2, 17)
        ^ rotateRight(before2, 19)
        ^ (before2 >>> 10);
      words[index] = (
        words[index - 16] + sigma0 + words[index - 7] + sigma1
      ) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + SHA256_K[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  const output = new Uint8Array(32);
  for (let wordIndex = 0; wordIndex < hash.length; wordIndex += 1) {
    const word = hash[wordIndex];
    for (let byteIndex = 0; byteIndex < 4; byteIndex += 1) {
      output[wordIndex * 4 + byteIndex] = word >>> (24 - byteIndex * 8);
    }
  }
  return output;
}

function multiplyHighLowU32(left, right) {
  const leftLow = left & 0xffff;
  const leftHigh = left >>> 16;
  const rightLow = right & 0xffff;
  const rightHigh = right >>> 16;
  const lowProduct = leftLow * rightLow;
  const middle = (lowProduct >>> 16)
    + leftHigh * rightLow
    + leftLow * rightHigh;
  const low = (((middle & 0xffff) << 16) | (lowProduct & 0xffff)) >>> 0;
  const high = (leftHigh * rightHigh + Math.floor(middle / 0x10000)) >>> 0;
  return [high, low];
}

export function philox4x32_10(counter, key) {
  requireWordArray(counter, 4, 'counter');
  requireWordArray(key, 2, 'key');
  let words = [...counter];
  let key0 = key[0];
  let key1 = key[1];

  for (let round = 0; round < 10; round += 1) {
    const [high0, low0] = multiplyHighLowU32(PHILOX_M0, words[0]);
    const [high1, low1] = multiplyHighLowU32(PHILOX_M1, words[2]);
    words = [
      (high1 ^ words[1] ^ key0) >>> 0,
      low1,
      (high0 ^ words[3] ^ key1) >>> 0,
      low0,
    ];
    key0 = (key0 + PHILOX_W0) >>> 0;
    key1 = (key1 + PHILOX_W1) >>> 0;
  }

  return words;
}

function digestWord(digest, offset) {
  return (
    (digest[offset] << 24)
    | (digest[offset + 1] << 16)
    | (digest[offset + 2] << 8)
    | digest[offset + 3]
  ) >>> 0;
}

export function deriveDemandStream(identity) {
  const digest = sha256Bytes(encodeDemandStreamIdentity(identity));
  return Object.freeze({
    key: Object.freeze([digestWord(digest, 0), digestWord(digest, 4)]),
    counterPrefix: Object.freeze([digestWord(digest, 8), digestWord(digest, 12)]),
  });
}

export function sampleDemandStreamU32(stream, sample) {
  requireWordArray(sample, 2, 'sample');
  const counter = [
    stream.counterPrefix[0],
    stream.counterPrefix[1],
    sample[0],
    sample[1],
  ];
  return philox4x32_10(counter, stream.key)[0];
}

export function deriveDemandKey(identity) {
  const stream = deriveDemandStream(identity);
  return {
    key: [...stream.key],
    counter: [...stream.counterPrefix, identity.sample[0], identity.sample[1]],
  };
}

export function demandU32(identity) {
  return sampleDemandStreamU32(deriveDemandStream(identity), identity.sample);
}
