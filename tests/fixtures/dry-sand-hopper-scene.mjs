import {
  createDrySandHopperReference,
  createDrySandRenderPacketReference,
  stepDrySandHopperReference,
  syncDrySandRenderPacketReference,
} from '../../web/vf-ui/vf-sand-hopper-reference.mjs';

const frameId = 'dry_sand_hopper_frame';
const world = createDrySandHopperReference({
  seed: 0x5a17, grainCount: 640, outletDiameterInGrains: 4.2, fillHeightInGrains: 24,
});
const grains = createDrySandRenderPacketReference(world);

function funnelMesh() {
  const segments = 64; const vertices = new Float32Array((segments + 1) * 2 * 10);
  const indices = new Uint32Array(segments * 6); const slope = world.hopperRadius - world.outletRadius;
  let vertexOffset = 0; let indexOffset = 0;
  for (let segment = 0; segment <= segments; segment += 1) {
    const angle = segment / segments * Math.PI * 2;
    const cosine = Math.cos(angle); const sine = Math.sin(angle);
    const normalLength = Math.hypot(world.hopperTop - world.hopperBottom, slope);
    const nx = cosine * (world.hopperTop - world.hopperBottom) / normalLength;
    const ny = sine * (world.hopperTop - world.hopperBottom) / normalLength;
    const nz = -slope / normalLength;
    for (const [radius, z] of [[world.outletRadius, world.hopperBottom], [world.hopperRadius, world.hopperTop]]) {
      vertices.set([radius * cosine, radius * sine, z, nx, ny, nz, 0.36, 0.39, 0.42, 0.31], vertexOffset);
      vertexOffset += 10;
    }
    if (segment < segments) {
      const a = segment * 2; const b = a + 1; const c = a + 2; const d = a + 3;
      indices.set([a, c, b, b, c, d], indexOffset); indexOffset += 6;
    }
  }
  return {
    type: 'field_mesh', id: 'sand:circular-hopper', object_id: 2, mode3d: true,
    topology: 'triangle-list', transparent: true, depth_write: false,
    receives_lighting: true, casts_shadow: false, receives_shadow: false,
    specular_strength: 0.34, vertices, indices,
  };
}

const ground = {
  type: 'field_mesh', id: 'sand:plane', object_id: 3, mode3d: true,
  topology: 'triangle-list', static_vertices: true, static_indices: true,
  receives_lighting: true, casts_shadow: false, receives_shadow: false,
  specular_strength: 0.04,
  vertices: new Float32Array([
    -4, -4, 0, 0, 0, 1, 0.15, 0.14, 0.12, 1,
     4, -4, 0, 0, 0, 1, 0.15, 0.14, 0.12, 1,
     4,  4, 0, 0, 0, 1, 0.15, 0.14, 0.12, 1,
    -4,  4, 0, 0, 0, 1, 0.15, 0.14, 0.12, 1,
  ]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
};

try {
  await window.VfRuntimeShell.ensureSceneDependencies();
  const panel = window.VfFrame.mount(document.getElementById('layer'), {
    id: frameId, title: 'Dry sand hopper — fixed-step granular state', draggable: false,
    dockable: false, resizable: false, closable: false,
  });
  panel.root.style.left = '2%'; panel.root.style.top = '2%';
  panel.root.style.width = '96%'; panel.root.style.height = '96%';
  stepDrySandHopperReference(world, 54);
  window.__drySandEvidence = { world, grains, frames: 0, wgpuErrors: [] };
  window.VfDisplay.mountDynamicGeomFrame(frameId, () => {
    syncDrySandRenderPacketReference(world, grains);
    return {
      meshes: [ground, grains, funnelMesh()],
      camera: { pos: [3.0, -4.8, 3.0], target: [0, 0, 1.03], up: [0, 0, 1], fov: 32 },
      lights: [
        { id: 'sand_key', kind: 'point', pos: [3, -3, 5], target: [0, 0, 0.8], color: [1, 0.88, 0.68, 1], intensity: 48, range: 16 },
        { id: 'sand_fill', kind: 'point', pos: [-3, -1, 3], target: [0, 0, 0.7], color: [0.70, 0.76, 1, 1], intensity: 24, range: 14 },
      ],
      background: [0.075, 0.085, 0.10, 1], unified_renderer: true,
    };
  });
  const advance = () => {
    if (window.__drySandEvidence.frames < 300) {
      stepDrySandHopperReference(world, 1);
      window.__drySandEvidence.frames += 1;
      window.VfDisplay.requestDynamicGeomFrameUpdate(frameId);
      requestAnimationFrame(advance);
    } else window.__drySandEvidence.complete = true;
  };
  window.VfDisplay.requestDynamicGeomFrameUpdate(frameId);
  requestAnimationFrame(advance);
} catch (error) {
  window.__vfLastError = String(error && error.stack || error);
}
