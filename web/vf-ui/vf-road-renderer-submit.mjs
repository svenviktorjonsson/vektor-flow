const MAX_RENDER_PIXELS = 16_777_216;

export const ROAD_RENDERER_WGSL = `
struct RoadMaterial {
  albedo_roughness: vec4<f32>,
  wetness_specular: vec4<f32>,
};

@group(0) @binding(0)
var<storage, read> road_material: RoadMaterial;

struct RoadVertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
};

@vertex
fn road_vertex(
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
) -> RoadVertexOutput {
  var output: RoadVertexOutput;
  output.position = vec4<f32>(position, 1.0);
  output.normal = normal;
  return output;
}

@fragment
fn road_fragment(input: RoadVertexOutput) -> @location(0) vec4<f32> {
  let surface_normal = normalize(input.normal);
  let road_light = vec3<f32>(0.36, 0.48, 0.8);
  let road_half = normalize(road_light + vec3<f32>(0.0, 0.0, 1.0));
  let normal_light = max(0.0, dot(surface_normal, road_light));
  let normal_half = max(0.0, dot(surface_normal, road_half));
  let roughness = clamp(road_material.albedo_roughness.w, 0.0, 1.0);
  let wetness = clamp(road_material.wetness_specular.x, 0.0, 1.0);
  let specular_strength = clamp(
    road_material.wetness_specular.y,
    0.0,
    1.0,
  );
  let smoothness = 1.0 - roughness;
  let lobe = normal_half * normal_half * normal_half * normal_half;
  let gloss = lobe * mix(lobe, 1.0, smoothness);
  let diffuse = 0.08
    + 0.92 * normal_light * (1.0 - 0.25 * specular_strength);
  let road_specular = specular_strength * (1.0 + 0.5 * wetness) * gloss;
  let color = clamp(
    road_material.albedo_roughness.xyz * diffuse + road_specular,
    vec3<f32>(0.0),
    vec3<f32>(1.0),
  );
  return vec4<f32>(color, 1.0);
}
`;

const ROAD_LIGHT = Object.freeze([0.36, 0.48, 0.8]);
const ROAD_HALF = Object.freeze((() => {
  const vector = [ROAD_LIGHT[0], ROAD_LIGHT[1], ROAD_LIGHT[2] + 1];
  const length = Math.hypot(...vector);
  return vector.map((value) => value / length);
})());

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function normalized(vector) {
  const length = Math.hypot(...vector);
  return vector.map((value) => value / length);
}

function dot(left, right) {
  return left.reduce((sum, value, axis) => sum + value * right[axis], 0);
}

export function shadeRoadMaterialReference({
  albedo,
  roughness,
  wetness,
  specularStrength,
  normal,
}) {
  const surfaceNormal = normalized(normal);
  const normalLight = Math.max(0, dot(surfaceNormal, ROAD_LIGHT));
  const normalHalf = Math.max(0, dot(surfaceNormal, ROAD_HALF));
  const smoothness = 1 - clamp01(roughness);
  const lobe = normalHalf ** 4;
  const gloss = lobe * (lobe * (1 - smoothness) + smoothness);
  const strength = clamp01(specularStrength);
  const diffuse = 0.08 + 0.92 * normalLight * (1 - 0.25 * strength);
  const specular = strength * (1 + 0.5 * clamp01(wetness)) * gloss;
  return Object.freeze(albedo.map((value) => (
    clamp01(value * diffuse + specular)
  )));
}

function requireConfiguration(
  device,
  pipeline,
  colorAttachment,
  width,
  height,
  readPixels,
) {
  if (
    typeof device?.createBindGroup !== 'function'
    || typeof device?.createCommandEncoder !== 'function'
    || typeof device?.queue?.submit !== 'function'
    || typeof pipeline?.getBindGroupLayout !== 'function'
    || typeof colorAttachment?.createView !== 'function'
    || typeof readPixels !== 'function'
  ) {
    throw new TypeError('road renderer submit configuration is required');
  }
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width < 1
    || height < 1
    || width * height > MAX_RENDER_PIXELS
  ) {
    throw new RangeError('road renderer submit exceeds pixel budget');
  }
}

function requireDraw(draw) {
  if (
    draw?.kind !== 'road-renderer-draw:v1'
    || !Number.isSafeInteger(draw.frame)
    || draw.frame < 0
    || !Array.isArray(draw.resources)
    || draw.resources.some((resources) => (
      resources?.kind !== 'road-renderer-gpu-resources:v1'
      || !(resources.packet?.indices instanceof Uint32Array)
      || resources.packet.indices.length < 1
      || !resources.vertexBuffer
      || !resources.indexBuffer
      || !resources.materialBuffer
    ))
  ) {
    throw new TypeError('road renderer draw is invalid');
  }
}

export function createRoadRendererSubmitReference(
  device,
  {
    pipeline,
    colorAttachment,
    width,
    height,
    readPixels,
  },
) {
  requireConfiguration(
    device,
    pipeline,
    colorAttachment,
    width,
    height,
    readPixels,
  );

  return async function submit(draw) {
    requireDraw(draw);
    const encoder = device.createCommandEncoder({
      label: `road-renderer-frame-${draw.frame}`,
    });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: colorAttachment.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(pipeline);
    for (const resources of draw.resources) {
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{
          binding: 0,
          resource: { buffer: resources.materialBuffer },
        }],
      });
      pass.setBindGroup(0, bindGroup);
      pass.setVertexBuffer(0, resources.vertexBuffer);
      pass.setIndexBuffer(resources.indexBuffer, 'uint32');
      pass.drawIndexed(resources.packet.indices.length, 1, 0, 0, 0);
    }
    pass.end();
    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);
    const rgba8 = await readPixels({
      frame: draw.frame,
      width,
      height,
      colorAttachment,
    });
    return Object.freeze({
      kind: 'road-renderer-output:v1',
      rgba8,
      drawCount: draw.resources.length,
      commandBuffer,
    });
  };
}
