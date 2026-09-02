import {
  createProceduralWoodSpectralSceneFixtureReference,
} from "./vf-procedural-wood-spectral-scene.mjs";

const MAX_SCENE_VERTICES = 65_536;
const SCENE_VERTEX_BYTES = 64;
const WAVELENGTHS_NM = Object.freeze([450.0, 600.0, 850.0]);
const CAMERA_TOWARD = Object.freeze(normalize([1.7, 1.3, 2.4]));
const CAMERA_RIGHT = Object.freeze(normalize(cross([0, 0, 1], CAMERA_TOWARD)));
const CAMERA_UP = Object.freeze(normalize(cross(CAMERA_TOWARD, CAMERA_RIGHT)));

function clampUnit(value) {
  return Math.max(0.0, Math.min(1.0, value));
}

function dot(left, right) {
  return left.reduce((sum, value, index) => (
    sum + value * right[index]
  ), 0.0);
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function normalize(vector) {
  const length = Math.hypot(...vector);
  if (!(length > 1.0e-12)) {
    throw new RangeError("stone scene vector must be non-zero");
  }
  return vector.map((value) => value / length);
}

function range(values) {
  return Math.max(...values) - Math.min(...values);
}

function requireMaterial(material) {
  const channels = material?.material_channels;
  const vertexCount = material?.vertices?.length / 10;
  if (
    material?.type !== "field_mesh"
    || !(material.vertices instanceof Float32Array)
    || !Number.isSafeInteger(vertexCount)
    || vertexCount < 4
    || vertexCount > MAX_SCENE_VERTICES
    || !(material.indices instanceof Uint32Array)
    || material.indices.length < 3
    || material.indices.length % 3 !== 0
    || channels?.kind !== "rock-geology-weathering:v1"
    || !(channels.roughness instanceof Float32Array)
    || channels.roughness.length !== vertexCount
    || !(channels.displacement instanceof Float32Array)
    || channels.displacement.length !== vertexCount
  ) {
    throw new TypeError("procedural stone material packet is required");
  }
  return { channels, vertexCount };
}

function averageBaseColor(material, vertexCount) {
  const color = [0.0, 0.0, 0.0];
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 10 + 6;
    for (let channel = 0; channel < 3; channel += 1) {
      color[channel] += material.vertices[offset + channel] / vertexCount;
    }
  }
  return color.map(clampUnit);
}

function spectralDescriptor(sourceMaterial, referenceBaseColor) {
  const neutralReflectance = clampUnit(
    0.2126 * referenceBaseColor[0]
    + 0.7152 * referenceBaseColor[1]
    + 0.0722 * referenceBaseColor[2],
  );
  const reflected = WAVELENGTHS_NM.map(() => neutralReflectance);
  const floats = new Float32Array(4 + WAVELENGTHS_NM.length * 8);
  floats.set([...referenceBaseColor, 0.75]);
  WAVELENGTHS_NM.forEach((wavelength, sample) => {
    const offset = 4 + sample * 8;
    floats.set([
      wavelength,
      0.7,
      1.0 - reflected[sample],
      0.0,
      reflected[sample],
      0.0,
      0.0,
      0.0,
    ], offset);
  });
  return Object.freeze({
    kind: "wood-polarization-gpu:v1",
    headerFloats: 4,
    recordStrideFloats: 8,
    spectralSampleCount: WAVELENGTHS_NM.length,
    floats,
    sourceSample: Object.freeze({
      sourceMaterial,
      baseColor: Object.freeze(referenceBaseColor),
    }),
  });
}

function sortedIndices(indices, depths) {
  const triangles = Array.from(
    { length: indices.length / 3 },
    (_, triangle) => {
      const values = Array.from(indices.slice(triangle * 3, triangle * 3 + 3));
      const depth = values.reduce((sum, vertex) => (
        sum + depths[vertex]
      ), 0.0) / 3.0;
      return { values, depth, triangle };
    },
  );
  triangles.sort((left, right) => (
    left.depth - right.depth || left.triangle - right.triangle
  ));
  return new Uint32Array(triangles.flatMap(({ values }) => values));
}

function adaptStone(material, channels, vertexCount) {
  const positions = new Float32Array(vertexCount * 3);
  const baseColors = new Float32Array(vertexCount * 4);
  const normalRgba8 = new Uint8ClampedArray(vertexCount * 4);
  const alphaX = new Float32Array(vertexCount);
  const alphaY = new Float32Array(vertexCount);
  const depths = new Float32Array(vertexCount);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const input = vertex * 10;
    const position = Array.from(material.vertices.slice(input, input + 3));
    const normal = normalize(Array.from(
      material.vertices.slice(input + 3, input + 6),
    ));
    const viewNormal = [
      dot(normal, CAMERA_RIGHT),
      dot(normal, CAMERA_UP),
      dot(normal, CAMERA_TOWARD),
    ];
    positions.set([
      dot(position, CAMERA_RIGHT),
      dot(position, CAMERA_UP),
      0.0,
    ], vertex * 3);
    depths[vertex] = dot(position, CAMERA_TOWARD);
    baseColors.set(material.vertices.slice(input + 6, input + 10), vertex * 4);
    normalRgba8.set([
      ...viewNormal.map((value) => Math.round((value * 0.5 + 0.5) * 255)),
      255,
    ], vertex * 4);
    const alpha = Math.max(0.02, channels.roughness[vertex] ** 2);
    alphaX[vertex] = alpha;
    alphaY[vertex] = alpha;
  }
  const sourceMaterial = Object.freeze({ baseColors, normalRgba8 });
  const referenceBaseColor = averageBaseColor(material, vertexCount);
  const sourcePolarization = spectralDescriptor(
    sourceMaterial,
    referenceBaseColor,
  );
  const rendererPacket = Object.freeze({
    kind: "wood-cut-material-triangle-packet:v1",
    sourceMaterial,
    vertexCount,
    triangleCount: material.indices.length / 3,
    positions,
    indices: sortedIndices(material.indices, depths),
    normalRgba8,
    ggxLobe: Object.freeze({ alphaX, alphaY }),
    tangentFrame: Object.freeze({
      tangent: Object.freeze([1, 0, 0]),
      bitangent: Object.freeze([0, 1, 0]),
      normal: Object.freeze([0, 0, 1]),
      handedness: 1,
    }),
  });
  return Object.freeze({
    kind: "procedural-wood-spectral-lowering:v1",
    sourceMaterial,
    sourcePolarization,
    presentation: Object.freeze({
      kind: "wood-polarization-presentation:v1",
      linearHdrRgb: Object.freeze([...referenceBaseColor]),
      displayLinearRgb: Object.freeze([...referenceBaseColor]),
      exposureStops: 0.0,
    }),
    rendererPacket,
  });
}

export function createProceduralStoneSpectralSceneFixtureReference(
  material,
  extent,
) {
  const { channels, vertexCount } = requireMaterial(material);
  const lowering = adaptStone(material, channels, vertexCount);
  const fixture = createProceduralWoodSpectralSceneFixtureReference(
    lowering,
    extent,
  );
  const colorValues = [];
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    colorValues.push(...material.vertices.slice(
      vertex * 10 + 6,
      vertex * 10 + 9,
    ));
  }
  return Object.freeze({
    ...fixture,
    kind: "procedural-stone-spectral-scene:v1",
    sourceMaterial: material,
    distribution: Object.freeze({
      sampleCount: vertexCount,
      baseColorSpan: range(colorValues),
      roughnessSpan: range(channels.roughness),
      displacementSpan: range(channels.displacement),
      maximumVertexBytes: MAX_SCENE_VERTICES * SCENE_VERTEX_BYTES,
    }),
  });
}
