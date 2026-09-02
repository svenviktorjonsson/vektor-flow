const MIN_EXPOSURE_STOPS = -16.0;
const MAX_EXPOSURE_STOPS = 16.0;
const MAX_LINEAR_HDR = 1.0e12;

function requireLinearHdr(sourceVisible) {
  const linearHdrRgb = sourceVisible?.color?.unclippedLinearRgb;
  if (
    !Array.isArray(linearHdrRgb)
    || linearHdrRgb.length !== 3
    || linearHdrRgb.some((channel) => (
      !Number.isFinite(channel)
      || Math.abs(channel) > MAX_LINEAR_HDR
    ))
  ) {
    throw new RangeError(
      "wood presentation requires bounded finite linear HDR RGB",
    );
  }
  return linearHdrRgb;
}

function requireExposure(exposureStops) {
  if (
    !Number.isFinite(exposureStops)
    || exposureStops < MIN_EXPOSURE_STOPS
    || exposureStops > MAX_EXPOSURE_STOPS
  ) {
    throw new RangeError(
      "wood presentation exposureStops must be from -16 through 16",
    );
  }
}

export function presentWoodPolarizationVisibleReference(
  sourceVisible,
  { exposureStops },
) {
  const sourceLinearHdr = requireLinearHdr(sourceVisible);
  requireExposure(exposureStops);
  const linearHdrRgb = Object.freeze(Array.from(sourceLinearHdr));
  const exposureMultiplier = 2.0 ** exposureStops;
  const exposedLinearRgb = Object.freeze(linearHdrRgb.map((channel) => (
    Math.max(0.0, channel) * exposureMultiplier
  )));
  const peakLinear = Math.max(...exposedLinearRgb);
  const displayPeak = peakLinear === 0.0
    ? 0.0
    : Math.min(
      1.0 - Number.EPSILON,
      peakLinear / (1.0 + peakLinear),
    );
  const toneScale = peakLinear === 0.0
    ? 1.0
    : displayPeak / peakLinear;
  const displayLinearRgb = Object.freeze(exposedLinearRgb.map((channel) => (
    channel * toneScale
  )));

  return Object.freeze({
    kind: "wood-polarization-presentation:v1",
    sourceVisible,
    exposureStops,
    exposureMultiplier,
    linearHdrRgb,
    exposedLinearRgb,
    peakLinear,
    displayPeak,
    toneScale,
    displayLinearRgb,
  });
}
