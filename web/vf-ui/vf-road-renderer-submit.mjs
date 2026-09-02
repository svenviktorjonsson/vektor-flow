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
};

@vertex
fn road_vertex(@location(0) position: vec3<f32>) -> RoadVertexOutput {
  var output: RoadVertexOutput;
  output.position = vec4<f32>(position, 1.0);
  return output;
}

@fragment
fn road_fragment() -> @location(0) vec4<f32> {
  return vec4<f32>(road_material.albedo_roughness.xyz, 1.0);
}
`;

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
