import {
  createWoodPolarizationGpuConsumptionFixture,
  verifyWoodPolarizationGpuConsumption,
} from "./vf-wood-polarization-gpu.mjs";
import {
  integrateSpectralVisibleColorReference,
} from "./vf-spectral-visible-color.mjs";

const HEADER_FLOATS = 4;
const RECORD_STRIDE_FLOATS = 8;
const ENERGY_TOLERANCE = 1.0e-6;

function spectralRecords(descriptor, gpuOutput, lane) {
  return Array.from(
    { length: descriptor.spectralSampleCount },
    (_, record) => Object.freeze({
      wavelengthNm: descriptor.floats[
        HEADER_FLOATS + record * RECORD_STRIDE_FLOATS
      ],
      radiance: gpuOutput[record * RECORD_STRIDE_FLOATS + lane],
    }),
  );
}

function requirePassiveGpuOutput(descriptor, gpuOutput) {
  const fixture = createWoodPolarizationGpuConsumptionFixture(descriptor);
  if (fixture.violations !== 0) {
    throw new RangeError("wood polarization input violates passive energy");
  }
  const parity = verifyWoodPolarizationGpuConsumption(fixture, gpuOutput);
  if (!parity.matched) {
    throw new RangeError("wood polarization GPU output failed parity");
  }
}

export function integrateWoodPolarizationVisibleReference(
  descriptor,
  gpuOutput,
) {
  requirePassiveGpuOutput(descriptor, gpuOutput);
  if (descriptor.spectralSampleCount < 2) {
    throw new RangeError(
      "wood visible integration requires at least two spectral samples",
    );
  }

  const reflectedRecords = spectralRecords(descriptor, gpuOutput, 3);
  const absorbedRecords = spectralRecords(descriptor, gpuOutput, 7);
  let maxSampleEnergyError = 0.0;
  const incidentRecords = reflectedRecords.map((reflected, index) => {
    const radiance = reflected.radiance + absorbedRecords[index].radiance;
    maxSampleEnergyError = Math.max(
      maxSampleEnergyError,
      Math.abs(radiance - 1.0),
    );
    if (radiance > 1.0 + ENERGY_TOLERANCE) {
      throw new RangeError("wood polarization output creates energy");
    }
    return Object.freeze({
      wavelengthNm: reflected.wavelengthNm,
      radiance: Math.max(0.0, Math.min(1.0, radiance)),
    });
  });
  const color = integrateSpectralVisibleColorReference(reflectedRecords);
  const absorbed = integrateSpectralVisibleColorReference(absorbedRecords);
  const incident = integrateSpectralVisibleColorReference(incidentRecords);

  return Object.freeze({
    kind: "wood-polarization-visible:v1",
    color,
    reflectedVisibleRadianceIntegral: color.visibleRadianceIntegral,
    reflectedInfraredRadianceIntegral: color.infraredRadianceIntegral,
    absorbedVisibleRadianceIntegral: absorbed.visibleRadianceIntegral,
    absorbedInfraredRadianceIntegral: absorbed.infraredRadianceIntegral,
    incidentVisibleRadianceIntegral: incident.visibleRadianceIntegral,
    incidentInfraredRadianceIntegral: incident.infraredRadianceIntegral,
    maxSampleEnergyError,
  });
}
