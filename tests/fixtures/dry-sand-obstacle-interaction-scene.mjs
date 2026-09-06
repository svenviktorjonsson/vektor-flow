import {
  createDrySandHopperReference,
  createDrySandHopperHardwarePacketsReference,
  createDrySandEllipsoidRenderPacketReference,
  createDrySandObstacleRenderPacketReference,
  measureDrySandPileInteractionReference,
  setDrySandReceivingObstacleReference,
  stepDrySandHopperReference,
  syncDrySandEllipsoidRenderPacketReference,
} from '../../web/vf-ui/vf-sand-hopper-reference.mjs';

const frameId = 'dry_sand_obstacle_frame';
const world = createDrySandHopperReference({
  seed: 0xb01d, grainCount: 320, outletDiameterInGrains: 4.5, fillHeightInGrains: 20,
});
setDrySandReceivingObstacleReference(world, {
  center: [0.10, 0, 0.13], radii: [0.23, 0.17, 0.13],
});
const grains = createDrySandEllipsoidRenderPacketReference(world, { latitudeSegments: 5, longitudeSegments: 8 });
const obstacle = createDrySandObstacleRenderPacketReference(world);
const hardware = createDrySandHopperHardwarePacketsReference(world);
const ground = {
  type: 'field_mesh', id: 'sand:plane', object_id: 3, mode3d: true,
  topology: 'triangle-list', static_vertices: true, static_indices: true,
  receives_lighting: true, casts_shadow: false, receives_shadow: false,
  specular_strength: 0.04,
  vertices: new Float32Array([
    -4,-4,0,0,0,1,.15,.14,.12,1, 4,-4,0,0,0,1,.15,.14,.12,1,
     4, 4,0,0,0,1,.15,.14,.12,1,-4, 4,0,0,0,1,.15,.14,.12,1,
  ]), indices: new Uint32Array([0,1,2,0,2,3]),
};

try {
  await window.VfRuntimeShell.ensureSceneDependencies();
  const panel = window.VfFrame.mount(document.getElementById('layer'), {
    id: frameId, title: 'Dry sand — exact receiving obstacle interaction', draggable: false,
    dockable: false, resizable: false, closable: false,
  });
  panel.root.style.left='2%'; panel.root.style.top='2%'; panel.root.style.width='96%'; panel.root.style.height='96%';
  stepDrySandHopperReference(world, 540);
  window.__drySandObstacleEvidence = {
    world, metrics: measureDrySandPileInteractionReference(world), frames: 0, wgpuErrors: [],
  };
  window.VfDisplay.mountDynamicGeomFrame(frameId, () => {
    syncDrySandEllipsoidRenderPacketReference(world, grains);
    return {
      meshes: [ground, obstacle, grains, ...hardware],
      camera: { pos: [2.25,-3.6,2.15], target: [0,0,.75], up: [0,0,1], fov: 30 },
      lights: [
        { id:'key',kind:'point',pos:[3,-3,5],target:[0,0,.7],color:[1,.88,.68,1],intensity:48,range:16 },
        { id:'fill',kind:'point',pos:[-3,-1,3],target:[0,0,.6],color:[.7,.76,1,1],intensity:24,range:14 },
      ],
      background:[.075,.085,.10,1], unified_renderer: true,
    };
  });
  window.VfDisplay.requestDynamicGeomFrameUpdate(frameId);
  window.__drySandObstacleEvidence.complete = true;
} catch (error) { window.__vfLastError = String(error && error.stack || error); }
