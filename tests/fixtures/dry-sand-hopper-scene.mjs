import {
  createDrySandHopperReference,
  createDrySandHopperHardwarePacketsReference,
  createDrySandEllipsoidRenderPacketReference,
  stepDrySandHopperReference,
  syncDrySandEllipsoidRenderPacketReference,
} from '../../web/vf-ui/vf-sand-hopper-reference.mjs';
import {
  createDrySandAggregateReference,
  createDrySandAggregateRenderPacketReference,
  settleDrySandIntoAggregateReference,
  stepDrySandBcreReference,
} from '../../web/vf-ui/vf-sand-aggregate-reference.mjs';

const frameId = 'dry_sand_hopper_frame';
const world = createDrySandHopperReference({
  seed: 0x5a17, grainCount: 384, outletDiameterInGrains: 4.2, fillHeightInGrains: 20,
});
const grains = createDrySandEllipsoidRenderPacketReference(world, { latitudeSegments: 5, longitudeSegments: 8 });
const aggregate = createDrySandAggregateReference(world, { resolution: 33, extent: 1.0 });
let aggregatePacket = createDrySandAggregateRenderPacketReference(aggregate, { distance: 2 });
const hardware = createDrySandHopperHardwarePacketsReference(world);

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
  stepDrySandHopperReference(world, 240);
  settleDrySandIntoAggregateReference(world, aggregate, { speedThreshold: 0.08 });
  stepDrySandBcreReference(aggregate, 20);
  window.__drySandEvidence = { world, aggregate, grains, frames: 0, wgpuErrors: [] };
  window.VfDisplay.mountDynamicGeomFrame(frameId, () => {
    syncDrySandEllipsoidRenderPacketReference(world, grains);
    aggregatePacket = createDrySandAggregateRenderPacketReference(aggregate, { distance: 2 });
    return {
      meshes: [ground, aggregatePacket, grains, ...hardware],
      camera: { pos: [2.7, -4.4, 2.7], target: [0, 0, 0.95], up: [0, 0, 1], fov: 31 },
      lights: [
        { id: 'sand_key', kind: 'point', pos: [3, -3, 5], target: [0, 0, 0.8], color: [1, 0.88, 0.68, 1], intensity: 48, range: 16 },
        { id: 'sand_fill', kind: 'point', pos: [-3, -1, 3], target: [0, 0, 0.7], color: [0.70, 0.76, 1, 1], intensity: 24, range: 14 },
      ],
      background: [0.075, 0.085, 0.10, 1], unified_renderer: true,
    };
  });
  const advance = () => {
    if (window.__drySandEvidence.frames < 60) {
      stepDrySandHopperReference(world, 1);
      settleDrySandIntoAggregateReference(world, aggregate, { speedThreshold: 0.08 });
      stepDrySandBcreReference(aggregate, 1);
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
