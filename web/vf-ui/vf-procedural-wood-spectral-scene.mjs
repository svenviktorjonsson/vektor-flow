const MAX_SCENE_PIXELS = 1_048_576;
const MAX_SCENE_VERTICES = 65_536;
const MAX_SCENE_TRIANGLES = 131_072;
const LIGHT_DIRECTION = Object.freeze([0.35, 0.25, Math.sqrt(0.815)]);
const VIEW_DIRECTION = Object.freeze([0.0, 0.0, 1.0]);

export const PROCEDURAL_WOOD_SPECTRAL_SCENE_WGSL = /* wgsl */`
struct SceneColor {
  display_linear_rgba: vec4<f32>,
  reference_base_color: vec4<f32>,
  light_direction: vec4<f32>,
  view_direction: vec4<f32>,
}

@group(0) @binding(0)
var<uniform> vf_scene: SceneColor;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) base_color: vec3<f32>,
  @location(1) surface_normal: vec3<f32>,
  @location(2) alpha: vec2<f32>,
}

@vertex
fn vf_procedural_wood_vertex(
  @location(0) position: vec2<f32>,
  @location(1) base_color: vec3<f32>,
  @location(2) surface_normal: vec3<f32>,
  @location(3) alpha: vec2<f32>,
) -> VertexOutput {
  var output: VertexOutput;
  output.position = vec4<f32>(position, 0.0, 1.0);
  output.base_color = base_color;
  output.surface_normal = surface_normal;
  output.alpha = alpha;
  return output;
}

fn ggx_lambda(direction: vec3<f32>, alpha: vec2<f32>) -> f32 {
  let numerator = alpha.x * alpha.x * direction.x * direction.x
    + alpha.y * alpha.y * direction.y * direction.y;
  return 0.5 * (sqrt(1.0 + numerator / (direction.z * direction.z)) - 1.0);
}

fn ggx_distribution(halfway: vec3<f32>, alpha: vec2<f32>) -> f32 {
  let scaled = halfway.x * halfway.x / (alpha.x * alpha.x)
    + halfway.y * halfway.y / (alpha.y * alpha.y)
    + halfway.z * halfway.z;
  return 1.0 / (3.14159265359 * alpha.x * alpha.y * scaled * scaled);
}

fn tangent_coordinates(
  direction: vec3<f32>,
  tangent: vec3<f32>,
  bitangent: vec3<f32>,
  normal: vec3<f32>,
) -> vec3<f32> {
  return vec3<f32>(
    dot(direction, tangent),
    dot(direction, bitangent),
    dot(direction, normal),
  );
}

fn angular_response(
  normal_value: vec3<f32>,
  alpha_value: vec2<f32>,
) -> f32 {
  let normal = normalize(normal_value);
  let light = normalize(vf_scene.light_direction.xyz);
  let view = normalize(vf_scene.view_direction.xyz);
  let normal_light = dot(normal, light);
  let normal_view = dot(normal, view);
  if (normal_light <= 1.0e-5 || normal_view <= 1.0e-5) {
    return 0.0;
  }
  var tangent_seed = vec3<f32>(1.0, 0.0, 0.0);
  if (abs(normal.x) > 0.999) {
    tangent_seed = vec3<f32>(0.0, 1.0, 0.0);
  }
  let tangent = normalize(tangent_seed - normal * dot(tangent_seed, normal));
  let bitangent = cross(normal, tangent);
  let local_light = tangent_coordinates(light, tangent, bitangent, normal);
  let local_view = tangent_coordinates(view, tangent, bitangent, normal);
  let halfway = normalize(light + view);
  let local_halfway = tangent_coordinates(
    halfway,
    tangent,
    bitangent,
    normal,
  );
  let alpha = max(alpha_value, vec2<f32>(0.02));
  let distribution = ggx_distribution(local_halfway, alpha);
  let masking_shadowing = 1.0 / (
    1.0
    + ggx_lambda(local_light, alpha)
    + ggx_lambda(local_view, alpha)
  );
  let view_halfway = clamp(dot(view, halfway), 0.0, 1.0);
  let fresnel = 0.04 + 0.96 * pow(1.0 - view_halfway, 5.0);
  let specular = distribution * masking_shadowing * fresnel
    / (4.0 * normal_light * normal_view);
  let diffuse = (1.0 - fresnel) / 3.14159265359;
  return max(0.0, (diffuse + specular) * normal_light);
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
  let lighting = angular_response(input.surface_normal, input.alpha);
  return vec4<f32>(
    clamp(
      vf_scene.display_linear_rgba.rgb * material_ratio * lighting,
      vec3<f32>(0.0),
      vec3<f32>(1.0),
    ),
    vf_scene.display_linear_rgba.a,
  );
}
`;

function dot(left, right) {
  return left.reduce((sum, value, index) => (
    sum + value * right[index]
  ), 0.0);
}

function normalize(vector, name) {
  if (
    !Array.isArray(vector)
    || vector.length !== 3
    || vector.some((value) => !Number.isFinite(value))
  ) {
    throw new TypeError(`${name} must be a finite three-vector`);
  }
  const length = Math.hypot(...vector);
  if (!(length > 1.0e-12)) {
    throw new RangeError(`${name} must be non-zero`);
  }
  return vector.map((value) => value / length);
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function ggxLambda(direction, alphaX, alphaY) {
  return 0.5 * (Math.sqrt(1.0 + (
    alphaX * alphaX * direction[0] * direction[0]
    + alphaY * alphaY * direction[1] * direction[1]
  ) / (direction[2] * direction[2])) - 1.0);
}

export function evaluateProceduralWoodAngularResponseReference({
  normal: normalValue,
  alphaX,
  alphaY,
  lightDirection: lightValue,
  viewDirection: viewValue,
}) {
  if (
    !Number.isFinite(alphaX)
    || !Number.isFinite(alphaY)
    || alphaX < 0.02
    || alphaY < 0.02
  ) {
    throw new RangeError("procedural wood GGX alpha must be at least 0.02");
  }
  const normal = normalize(normalValue, "normal");
  const light = normalize(lightValue, "lightDirection");
  const view = normalize(viewValue, "viewDirection");
  const normalLight = dot(normal, light);
  const normalView = dot(normal, view);
  if (normalLight <= 1.0e-5 || normalView <= 1.0e-5) {
    return Object.freeze({
      outgoing: 0.0,
      fresnel: 0.0,
      diffuseWeight: 0.0,
    });
  }
  const seed = Math.abs(normal[0]) > 0.999 ? [0, 1, 0] : [1, 0, 0];
  const tangent = normalize(seed.map((value, index) => (
    value - normal[index] * dot(seed, normal)
  )), "tangent");
  const bitangent = cross(normal, tangent);
  const local = (direction) => [
    dot(direction, tangent),
    dot(direction, bitangent),
    dot(direction, normal),
  ];
  const localLight = local(light);
  const localView = local(view);
  const halfway = normalize(view.map((value, index) => (
    value + light[index]
  )), "halfway");
  const localHalfway = local(halfway);
  const scaled = localHalfway[0] * localHalfway[0] / (alphaX * alphaX)
    + localHalfway[1] * localHalfway[1] / (alphaY * alphaY)
    + localHalfway[2] * localHalfway[2];
  const distribution = 1.0 / (
    Math.PI * alphaX * alphaY * scaled * scaled
  );
  const maskingShadowing = 1.0 / (
    1.0
    + ggxLambda(localLight, alphaX, alphaY)
    + ggxLambda(localView, alphaX, alphaY)
  );
  const viewHalfway = Math.max(0.0, Math.min(1.0, dot(view, halfway)));
  const fresnel = 0.04 + 0.96 * (1.0 - viewHalfway) ** 5;
  const diffuseWeight = 1.0 - fresnel;
  const specular = distribution * maskingShadowing * fresnel
    / (4.0 * normalLight * normalView);
  const outgoing = Math.max(
    0.0,
    (diffuseWeight / Math.PI + specular) * normalLight,
  );
  return Object.freeze({
    outgoing,
    fresnel,
    diffuseWeight,
    distribution,
    maskingShadowing,
  });
}

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
    || !(sourceMaterial.normalRgba8 instanceof Uint8ClampedArray)
    || sourceMaterial.normalRgba8.length !== packet.vertexCount * 4
    || packet.normalRgba8 !== sourceMaterial.normalRgba8
    || !(packet.ggxLobe?.alphaX instanceof Float32Array)
    || packet.ggxLobe.alphaX.length !== packet.vertexCount
    || !(packet.ggxLobe?.alphaY instanceof Float32Array)
    || packet.ggxLobe.alphaY.length !== packet.vertexCount
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
  const vertices = new Float32Array(packet.vertexCount * 10);
  projected.forEach(([u, v], vertex) => {
    const outputOffset = vertex * 10;
    const colorOffset = vertex * 4;
    vertices[outputOffset] = (u - centerU) * scale;
    vertices[outputOffset + 1] = (v - centerV) * scale * aspect;
    vertices.set(
      sourceMaterial.baseColors.subarray(colorOffset, colorOffset + 3),
      outputOffset + 2,
    );
    const normal = normalize([0, 1, 2].map((component) => (
      sourceMaterial.normalRgba8[colorOffset + component] / 127.5 - 1.0
    )), "surfaceNormal");
    vertices.set(normal, outputOffset + 5);
    vertices[outputOffset + 8] = packet.ggxLobe.alphaX[vertex];
    vertices[outputOffset + 9] = packet.ggxLobe.alphaY[vertex];
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
    vertexStrideBytes: 40,
    vertices: projectVertices(packet, sourceMaterial, width, height),
    indices: packet.indices,
    fragmentUniforms: new Float32Array([
      ...presentation.displayLinearRgb,
      1.0,
      ...referenceBaseColor,
      1.0,
      ...LIGHT_DIRECTION,
      0.0,
      ...VIEW_DIRECTION,
      0.0,
    ]),
  });
}
