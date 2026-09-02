const MIN_VISIBLE_NM = 380;
const MAX_VISIBLE_NM = 780;
const MAX_RECORDS = 4096;

const CIE_TABLE = Object.freeze([
  [380, 0.001368, 0.000039, 0.006450001],
  [385, 0.002236, 0.000064, 0.01054999],
  [390, 0.004243, 0.00012, 0.02005001],
  [395, 0.00765, 0.000217, 0.03621],
  [400, 0.01431, 0.000396, 0.06785001],
  [405, 0.02319, 0.00064, 0.1102],
  [410, 0.04351, 0.00121, 0.2074],
  [415, 0.07763, 0.00218, 0.3713],
  [420, 0.13438, 0.004, 0.6456],
  [425, 0.21477, 0.0073, 1.0390501],
  [430, 0.2839, 0.0116, 1.3856],
  [435, 0.3285, 0.01684, 1.62296],
  [440, 0.34828, 0.023, 1.74706],
  [445, 0.34806, 0.0298, 1.7826],
  [450, 0.3362, 0.038, 1.77211],
  [455, 0.3187, 0.048, 1.7441],
  [460, 0.2908, 0.06, 1.6692],
  [465, 0.2511, 0.0739, 1.5281],
  [470, 0.19536, 0.09098, 1.28764],
  [475, 0.1421, 0.1126, 1.0419],
  [480, 0.09564, 0.13902, 0.8129501],
  [485, 0.05795001, 0.1693, 0.6162],
  [490, 0.03201, 0.20802, 0.46518],
  [495, 0.0147, 0.2586, 0.3533],
  [500, 0.0049, 0.323, 0.272],
  [505, 0.0024, 0.4073, 0.2123],
  [510, 0.0093, 0.503, 0.1582],
  [515, 0.0291, 0.6082, 0.1117],
  [520, 0.06327, 0.71, 0.07824999],
  [525, 0.1096, 0.7932, 0.05725001],
  [530, 0.1655, 0.862, 0.04216],
  [535, 0.2257499, 0.9148501, 0.02984],
  [540, 0.2904, 0.954, 0.0203],
  [545, 0.3597, 0.9803, 0.0134],
  [550, 0.4334499, 0.9949501, 0.008749999],
  [555, 0.5120501, 1.0, 0.005749999],
  [560, 0.5945, 0.995, 0.0039],
  [565, 0.6784, 0.9786, 0.002749999],
  [570, 0.7621, 0.952, 0.0021],
  [575, 0.8425, 0.9154, 0.0018],
  [580, 0.9163, 0.87, 0.001650001],
  [585, 0.9786, 0.8163, 0.0014],
  [590, 1.0263, 0.757, 0.0011],
  [595, 1.0567, 0.6949, 0.001],
  [600, 1.0622, 0.631, 0.0008],
  [605, 1.0456, 0.5668, 0.0006],
  [610, 1.0026, 0.503, 0.00034],
  [615, 0.9384, 0.4412, 0.00024],
  [620, 0.8544499, 0.381, 0.00019],
  [625, 0.7514, 0.321, 0.0001],
  [630, 0.6424, 0.265, 0.00005],
  [635, 0.5419, 0.217, 0.00003],
  [640, 0.4479, 0.175, 0.00002],
  [645, 0.3608, 0.1382, 0.00001],
  [650, 0.2835, 0.107, 0.0],
  [655, 0.2187, 0.0816, 0.0],
  [660, 0.1649, 0.061, 0.0],
  [665, 0.1212, 0.04458, 0.0],
  [670, 0.0874, 0.032, 0.0],
  [675, 0.0636, 0.0232, 0.0],
  [680, 0.04677, 0.017, 0.0],
  [685, 0.0329, 0.01192, 0.0],
  [690, 0.0227, 0.00821, 0.0],
  [695, 0.01584, 0.005723, 0.0],
  [700, 0.01135916, 0.004102, 0.0],
  [705, 0.008110916, 0.002929, 0.0],
  [710, 0.005790346, 0.002091, 0.0],
  [715, 0.004109457, 0.001484, 0.0],
  [720, 0.002899327, 0.001047, 0.0],
  [725, 0.00204919, 0.00074, 0.0],
  [730, 0.001439971, 0.00052, 0.0],
  [735, 0.0009999493, 0.0003611, 0.0],
  [740, 0.0006900786, 0.0002492, 0.0],
  [745, 0.0004760213, 0.0001719, 0.0],
  [750, 0.0003323011, 0.00012, 0.0],
  [755, 0.0002348261, 0.0000848, 0.0],
  [760, 0.0001661505, 0.00006, 0.0],
  [765, 0.000117413, 0.0000424, 0.0],
  [770, 0.00008307527, 0.00003, 0.0],
  [775, 0.00005870652, 0.0000212, 0.0],
  [780, 0.00004150994, 0.00001499, 0.0],
].map(Object.freeze));

export const CIE_1931_2_DEGREE_DATASET = Object.freeze({
  observer: "CIE 1931 2 degree standard colorimetric observer",
  doi: "10.25039/CIE.DS.xvudnb9b",
  sourceUrl: "https://files.cie.co.at/CIE_xyz_1931_2deg.csv",
  sourceMd5: "17cca777db64b17170f06f67ce9d3ab7",
  sourceStepNm: 1,
  stepNm: 5,
  minimumWavelengthNm: MIN_VISIBLE_NM,
  maximumWavelengthNm: MAX_VISIBLE_NM,
});

const XYZ_TO_LINEAR_SRGB = Object.freeze([
  Object.freeze([12831 / 3959, -329 / 214, -1974 / 3959]),
  Object.freeze([-851781 / 878810, 1648619 / 878810, 36519 / 878810]),
  Object.freeze([705 / 12673, -2585 / 12673, 705 / 667]),
]);

function requireRecords(records) {
  if (
    !Array.isArray(records)
    || records.length < 2
    || records.length > MAX_RECORDS
  ) {
    throw new RangeError("spectral color requires 2 through 4096 records");
  }
  records.forEach((record, index) => {
    if (!Number.isFinite(record?.wavelengthNm)) {
      throw new TypeError(`records[${index}].wavelengthNm must be finite`);
    }
    if (
      !Number.isFinite(record.radiance)
      || record.radiance < 0.0
      || record.radiance > 1.0
    ) {
      throw new RangeError(
        `records[${index}].radiance must be from 0 through 1`,
      );
    }
    if (index > 0 && record.wavelengthNm <= records[index - 1].wavelengthNm) {
      throw new RangeError("spectral wavelengths must be strictly ascending");
    }
  });
}

function interpolateRadiance(records, wavelengthNm) {
  if (
    wavelengthNm < records[0].wavelengthNm
    || wavelengthNm > records.at(-1).wavelengthNm
  ) return 0.0;
  const upper = records.findIndex((record) => (
    record.wavelengthNm >= wavelengthNm
  ));
  if (records[upper].wavelengthNm === wavelengthNm) {
    return records[upper].radiance;
  }
  const lower = upper - 1;
  const span = records[upper].wavelengthNm - records[lower].wavelengthNm;
  const amount = (wavelengthNm - records[lower].wavelengthNm) / span;
  return records[lower].radiance
    + amount * (records[upper].radiance - records[lower].radiance);
}

function integratePiecewise(records, minimum, maximum) {
  let integral = 0.0;
  for (let index = 1; index < records.length; index += 1) {
    const left = records[index - 1];
    const right = records[index];
    const start = Math.max(minimum, left.wavelengthNm);
    const end = Math.min(maximum, right.wavelengthNm);
    if (end <= start) continue;
    const startRadiance = interpolateRadiance(records, start);
    const endRadiance = interpolateRadiance(records, end);
    integral += 0.5 * (end - start) * (startRadiance + endRadiance);
  }
  return integral;
}

function integrateCie(records, component) {
  let integral = 0.0;
  for (let index = 1; index < CIE_TABLE.length; index += 1) {
    const left = CIE_TABLE[index - 1];
    const right = CIE_TABLE[index];
    const leftWeighted = left[component]
      * interpolateRadiance(records, left[0]);
    const rightWeighted = right[component]
      * interpolateRadiance(records, right[0]);
    integral += 0.5 * (right[0] - left[0])
      * (leftWeighted + rightWeighted);
  }
  return integral;
}

const EQUAL_ENERGY_Y = CIE_TABLE.slice(1).reduce((integral, right, index) => {
  const left = CIE_TABLE[index];
  return integral + 0.5 * (right[0] - left[0]) * (left[2] + right[2]);
}, 0.0);

function multiplyMatrix(matrix, value) {
  return matrix.map((row) => row.reduce(
    (sum, coefficient, index) => sum + coefficient * value[index],
    0.0,
  ));
}

function clampUnit(value) {
  return Math.max(0.0, Math.min(1.0, value));
}

export function integrateSpectralVisibleColorReference(records) {
  requireRecords(records);
  const normalization = 1.0 / EQUAL_ENERGY_Y;
  const unclippedXyz = [1, 2, 3].map((component) => (
    integrateCie(records, component) * normalization
  ));
  const unclippedLinearRgb = multiplyMatrix(
    XYZ_TO_LINEAR_SRGB,
    unclippedXyz,
  );
  const xyz = unclippedXyz.map(clampUnit);
  const linearRgb = unclippedLinearRgb.map(clampUnit);
  const outOfGamut = xyz.some((value, index) => (
    value !== unclippedXyz[index]
  )) || linearRgb.some((value, index) => (
    value !== unclippedLinearRgb[index]
  ));
  return Object.freeze({
    kind: "spectral-visible-color:v1",
    observer: CIE_1931_2_DEGREE_DATASET.observer,
    dataset: CIE_1931_2_DEGREE_DATASET,
    xyz: Object.freeze(xyz),
    unclippedXyz: Object.freeze(unclippedXyz),
    linearRgb: Object.freeze(linearRgb),
    unclippedLinearRgb: Object.freeze(unclippedLinearRgb),
    outOfGamut,
    visibleRadianceIntegral: integratePiecewise(
      records,
      MIN_VISIBLE_NM,
      MAX_VISIBLE_NM,
    ),
    infraredRadianceIntegral: integratePiecewise(
      records,
      MAX_VISIBLE_NM,
      Infinity,
    ),
  });
}
