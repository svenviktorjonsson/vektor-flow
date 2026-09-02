const MAX_SCENE_PIXELS = 1_048_576;
const MAX_SCENE_VERTICES = 65_536;
const MAX_SCENE_TRIANGLES = 131_072;

export const PROCEDURAL_WOOD_SPECTRAL_SCENE_WGSL = /* wgsl */`
struct SceneColor {
  display_linear_rgba: vec4<f32>,
  reference_base_color: vec4<f32>,
}

@group(0) @binding(0)
var<uniform> vf_scene: SceneColor;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) base_color: vec3<f32>,
}

@vertex
fn vf_procedural_wood_vertex(
  @location(0) position: vec2<f32>,
  @location(1) base_color: vec3<f32>,
) -> VertexOutput {
  var output: VertexOutput;
  output.position = vec4<f32>(position, 0.0, 1.0);
  output.base_color = base_color;
  return output;
}

@fragment
fn vf_procedural_wood_fragment(
  input: VertexOutput,
) -> @location(0) vec4<f32> {
  let reference = max(
    vf_scene.reference_base_color.rgb,
    vec3<f32>(1.0e-4),
  );
  let material_ratio = clamp(
    input.base_color / reference,
    vec3<f32>(0.5),
    vec3<f32>(1.5),
  );
  return vec4<f32>(
    clamp(
      vf_scene.display_linear_rgba.rgb * material_ratio,
      vec3<f32>(0.0),
      vec3<f32>(1.0),
    ),
    vf_scene.display_linear_rgba.a,
  );
}
`;

function requireLowering(lowering) {
  const packet = lowering?.rendererPacket;
  const presentation = lowering?.presentation;
  const sourceMaterial = lowering?.sourceMaterial;
  const referenceBaseColor =
    lowering?.sourcePolarization?.sourceSample?.baseColor;
  if (
    lowering?.kind !== "procedural-wood-spectral-lowering:v1"
    || packet?.kind !== "wood-cut-material-triangle-packet:v1"
    || packet.sourceMaterial !== lowering.sourceMaterial
    || !Number.isSafeInteger(packet.vertexCount)
    || packet.vertexCount < 3
    || packet.vertexCount > MAX_SCENE_VERTICES
    || !Number.isSafeInteger(packet.triangleCount)
    || packet.triangleCount < 1
    || packet.triangleCount > MAX_SCENE_TRIANGLES
    || !(packet.positions instanceof Float32Array)
    || packet.positions.length !== packet.vertexCount * 3
    || !(sourceMaterial?.baseColors instanceof Float32Array)
    || sourceMaterial.baseColors.length !== packet.vertexCount * 4
    || !(packet.indices instanceof Uint32Array)
    || packet.indices.length !== packet.triangleCount * 3
    || !Array.isArray(packet.tangentFrame?.tangent)
    || packet.tangentFrame.tangent.length !== 3
    || !Array.isArray(packet.tangentFrame?.bitangent)
    || packet.tangentFrame.bitangent.length !== 3
    || presentation?.kind !== "wood-polarization-presentation:v1"
    || !Array.isArray(presentation.displayLinearRgb)
    || presentation.displayLinearRgb.length !== 3
    || presentation.displayLinearRgb.some((value) => (
      !Number.isFinite(value) || value < 0.0 || value > 1.0
    ))
    || lowering.sourcePolarization?.sourceSample?.sourceMaterial
      !== sourceMaterial
    || !Array.isArray(referenceBaseColor)
    || referenceBaseColor.length !== 3
    || referenceBaseColor.some((value) => (
      !Number.isFinite(value) || value < 0.0 || value > 1.0
    ))
  ) {
    throw new TypeError("lowered procedural wood renderer packet is required");
  }
  return { packet, presentation, sourceMaterial, referenceBaseColor };
}

function requireExtent(width, height) {
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width < 1
    || height < 1
    || width * height > MAX_SCENE_PIXELS
  ) {
    throw new RangeError("procedural wood scene exceeds pixel budget");
  }
}

function dotPosition(positions, vertex, axis) {
  const offset = vertex * 3;
  return positions[offset] * axis[0]
    + positions[offset + 1] * axis[1]
    + positions[offset + 2] * axis[2];
}

function projectVertices(packet, sourceMaterial, width, height) {
  const projected = Array.from(
    { length: packet.vertexCount },
    (_, vertex) => [
      dotPosition(packet.positions, vertex, packet.tangentFrame.tangent),
      dotPosition(packet.positions, vertex, packet.tangentFrame.bitangent),
    ],
  );
  const uValues = projected.map(([u]) => u);
  const vValues = projected.map(([, v]) => v);
  const minimumU = Math.min(...uValues);
  const maximumU = Math.max(...uValues);
  const minimumV = Math.min(...vValues);
  const maximumV = Math.max(...vValues);
  const spanU = maximumU - minimumU;
  const spanV = maximumV - minimumV;
  if (!(spanU > 1.0e-12) || !(spanV > 1.0e-12)) {
    throw new RangeError("procedural wood scene must span both cut-plane axes");
  }
  const aspect = width / height;
  const scale = Math.min(1.6 / spanU, 1.6 / (spanV * aspect));
  const centerU = 0.5 * (minimumU + maximumU);
  const centerV = 0.5 * (minimumV + maximumV);
  const vertices = new Float32Array(packet.vertexCount * 5);
  projected.forEach(([u, v], vertex) => {
    const outputOffset = vertex * 5;
    const colorOffset = vertex * 4;
    vertices[outputOffset] = (u - centerU) * scale;
    vertices[outputOffset + 1] = (v - centerV) * scale * aspect;
    vertices.set(
      sourceMaterial.baseColors.subarray(colorOffset, colorOffset + 3),
      outputOffset + 2,
    );
  });
  return vertices;
}

export function createProceduralWoodSpectralSceneFixtureReference(
  lowering,
  { width, height },
) {
  const {
    packet,
    presentation,
    sourceMaterial,
    referenceBaseColor,
  } = requireLowering(lowering);
  requireExtent(width, height);
  const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
  return Object.freeze({
    kind: "procedural-wood-spectral-scene:v1",
    sourceLowering: lowering,
    source: PROCEDURAL_WOOD_SPECTRAL_SCENE_WGSL,
    width,
    height,
    format: "rgba8unorm-srgb",
    bytesPerRow,
    outputByteLength: bytesPerRow * height,
    vertexStrideBytes: 20,
    vertices: projectVertices(packet, sourceMaterial, width, height),
    indices: packet.indices,
    fragmentUniforms: new Float32Array([
      ...presentation.displayLinearRgb,
      1.0,
      ...referenceBaseColor,
      1.0,
    ]),
  });
}
