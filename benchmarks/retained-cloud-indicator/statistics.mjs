function quantile(sorted, probability) {
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower] + (sorted[Math.min(sorted.length - 1, lower + 1)] - sorted[lower]) * fraction;
}

function tCritical95(degreesOfFreedom) {
  if (degreesOfFreedom <= 1) return 12.706;
  if (degreesOfFreedom === 2) return 4.303;
  if (degreesOfFreedom === 3) return 3.182;
  if (degreesOfFreedom === 4) return 2.776;
  if (degreesOfFreedom <= 9) return 2.262;
  if (degreesOfFreedom <= 19) return 2.093;
  if (degreesOfFreedom <= 29) return 2.045;
  if (degreesOfFreedom <= 59) return 2.001;
  if (degreesOfFreedom <= 119) return 1.984;
  return 1.96;
}

export function summarizeIntervals(samples) {
  if (!Array.isArray(samples) || samples.length < 2
    || !samples.every((value) => Number.isFinite(value) && value > 0)) {
    throw new TypeError('interval summary requires at least two positive finite samples');
  }
  const rawSamplesMs = [...samples];
  const sorted = [...samples].sort((left, right) => left - right);
  const meanMs = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const squared = samples.reduce((sum, value) => sum + (value - meanMs) ** 2, 0);
  const sampleStddevMs = Math.sqrt(squared / (samples.length - 1));
  const halfWidth = tCritical95(samples.length - 1) * sampleStddevMs / Math.sqrt(samples.length);
  const threshold = (thresholdMs) => {
    const count = samples.filter((value) => value > thresholdMs).length;
    return { thresholdMs, count, rate: count / samples.length };
  };
  const maxMs = sorted.at(-1);
  return Object.freeze({
    count: samples.length,
    meanMs,
    sampleStddevMs,
    mean95ConfidenceIntervalMs: [meanMs - halfWidth, meanMs + halfWidth],
    minMs: sorted[0],
    p50Ms: quantile(sorted, 0.5),
    p95Ms: quantile(sorted, 0.95),
    p99Ms: quantile(sorted, 0.99),
    maxMs,
    percentileMethod: 'R-7 linear interpolation',
    longestStall: { sampleIndex: rawSamplesMs.indexOf(maxMs), milliseconds: maxMs },
    effectiveFps: 1000 / meanMs,
    missedFrames60Hz: threshold(16.67),
    missedFrames30Hz: threshold(33.33),
    rawSamplesMs,
  });
}
