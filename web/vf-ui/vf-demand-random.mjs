// Internal deterministic-random reference. Philox constants and round layout
// follow Random123's BSD-licensed reference implementation:
// https://github.com/DEShawResearch/random123/blob/main/include/Random123/philox.h

const PHILOX_M0 = 0xd2511f53;
const PHILOX_M1 = 0xcd9e8d57;
const PHILOX_W0 = 0x9e3779b9;
const PHILOX_W1 = 0xbb67ae85;

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
  let words = counter.map((word) => word >>> 0);
  let key0 = key[0] >>> 0;
  let key1 = key[1] >>> 0;

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
