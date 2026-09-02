const MAX_MATERIAL_SAMPLES = 65_536;
const MAX_WAVELENGTH_SAMPLES = 64;

function requireMaterialSample(material, sampleIndex) {
  const sampleCount = Number(material?.imageWidth)
    * Number(material?.imageHeight);
  if (
    !material
    || material.kind !== "wood-cut-material-packet:v1"
    || !Number.isSafeInteger(sampleCount)
    || sampleCount < 1
    || sampleCount > MAX_MATERIAL_SAMPLES
    || !(material.baseColors instanceof Float32Array)
    || material.baseColors.length !== sampleCount * 4
    || !(material.normalRgba8 instanceof Uint8ClampedArray)
    || material.normalRgba8.length !== sampleCount * 4
    || !(material.roughnessR8 instanceof Uint8Array)
    || material.roughnessR8.length !== sampleCount
  ) {
    throw new TypeError("wood cut material packet is required");
  }
  if (
    !Number.isSafeInteger(sampleIndex)
    || sampleIndex < 0
    || sampleIndex >= sampleCount
  ) {
    throw new RangeError("wood material sample index is out of range");
  }
}

function requireWavelengths(wavelengthsNm, wavelengthBudget) {
  if (
    !Number.isSafeInteger(wavelengthBudget)
    || wavelengthBudget < 1
    || wavelengthBudget > MAX_WAVELENGTH_SAMPLES
  ) {
    throw new RangeError(
      "wood polarization wavelengthBudget must be from 1 through 64",
    );
  }
  if (
    !Array.isArray(wavelengthsNm)
    || wavelengthsNm.length < 1
    || wavelengthsNm.length > wavelengthBudget
  ) {
    throw new RangeError(
      "wood polarization wavelengths exceed wavelengthBudget",
    );
  }
}

function decodeNormal(material, sampleIndex) {
  const offset = sampleIndex * 4;
  const normal = [0, 1, 2].map((component) => (
    material.normalRgba8[offset + component] / 127.5 - 1.0
  ));
  const length = Math.hypot(...normal);
  return normal.map((component) => component / length);
}

function localIncidenceCosine(normal, geometricCosine) {
  const tangentSine = Math.sqrt(Math.max(
    0.0,
    1.0 - geometricCosine ** 2,
  ));
  return Math.max(0.0, Math.min(
    1.0,
    normal[0] * tangentSine + normal[2] * geometricCosine,
  ));
}

export function evaluateWoodCutPolarizedSampleReference(
  material,
  {
    sampleIndex,
    wavelengthsNm,
    wavelengthBudget,
    opticalConstants,
    incidentStokes,
    nIncident,
    geometricCosThetaIncident,
    microfacetSampleCount,
    polarizationTransport,
  },
) {
  requireMaterialSample(material, sampleIndex);
  requireWavelengths(wavelengthsNm, wavelengthBudget);
  if (typeof polarizationTransport !== "function") {
    throw new TypeError("wood polarization transport function is required");
  }

  const normal = Object.freeze(decodeNormal(material, sampleIndex));
  const roughness = material.roughnessR8[sampleIndex] / 255.0;
  const localCosThetaIncident = localIncidenceCosine(
    normal,
    geometricCosThetaIncident,
  );
  const spectralSamples = Object.freeze(wavelengthsNm.map((wavelengthNm) => (
    Object.freeze({
      wavelengthNm,
      ...polarizationTransport({
        wavelengthNm,
        opticalConstants,
        incidentStokes,
        nIncident,
        cosThetaIncident: localCosThetaIncident,
        roughness,
        sampleCount: microfacetSampleCount,
      }),
    })
  )));

  return Object.freeze({
    kind: "wood-cut-polarized-sample:v1",
    sourceMaterial: material,
    sampleIndex,
    baseColor: Object.freeze(Array.from(material.baseColors.slice(
      sampleIndex * 4,
      sampleIndex * 4 + 3,
    ))),
    normal,
    roughness,
    geometricCosThetaIncident,
    localCosThetaIncident,
    spectralSamples,
  });
}
