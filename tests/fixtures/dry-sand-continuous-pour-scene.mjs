import {
  createDrySandEllipsoidRenderPacketReference,
  createDrySandHopperHardwarePacketsReference,
  createDrySandHopperReference,
} from '../../web/vf-ui/vf-sand-hopper-reference.mjs';
import {
  createDrySandAggregateReference,
  createDrySandAggregateRenderPacketReference,
  stepDrySandPourAggregateReference,
} from '../../web/vf-ui/vf-sand-aggregate-reference.mjs';

const frameId = 'dry_sand_continuous_pour_frame';
const world = createDrySandHopperReference({
  seed: 0x6a11, grainCount: 320, outletDiameterInGrains: 4.2,
});
const aggregate = createDrySandAggregateReference(world, { resolution: 33, extent: 1.4 });
const receipt = stepDrySandPourAggregateReference(world, aggregate, {
  steps: 240, speedThreshold: 0.08,
});
const grains = createDrySandEllipsoidRenderPacketReference(world, {
  latitudeSegments: 5, longitudeSegments: 8,
});
const dense = createDrySandAggregateRenderPacketReference(aggregate, { distance: 2 });
const hardware = createDrySandHopperHardwarePacketsReference(world);
const ground = Object.freeze({
  type:'field_mesh',id:'sand:continuous:plane',object_id:700,mode3d:true,
  topology:'triangle-list',static_vertices:true,static_indices:true,
  transparent:false,depth_write:true,receives_lighting:true,casts_shadow:false,receives_shadow:true,
  specular_strength:.04,
  vertices:new Float32Array([-4,-4,-.004,0,0,1,.15,.14,.12,1, 4,-4,-.004,0,0,1,.15,.14,.12,1,
    4,4,-.004,0,0,1,.15,.14,.12,1, -4,4,-.004,0,0,1,.15,.14,.12,1]),
  indices:new Uint32Array([0,1,2,0,2,3]),
});

try {
  await window.VfRuntimeShell.ensureSceneDependencies();
  const panel = window.VfFrame.mount(document.getElementById('layer'), {
    id:frameId,title:'Continuous 4.2D hole pour — 118 explicit + 202 dense grains',
    draggable:false,dockable:false,resizable:false,closable:false,
  });
  panel.root.style.left='2%'; panel.root.style.top='2%'; panel.root.style.width='96%'; panel.root.style.height='96%';
  window.__drySandContinuousPourEvidence={world,aggregate,receipt,complete:true,wgpuErrors:[]};
  window.VfDisplay.mountDynamicGeomFrame(frameId,()=>({
    meshes:[ground,dense,grains,...hardware],
    camera:{pos:[2.7,-4.4,2.7],target:[0,0,.92],up:[0,0,1],fov:31},
    lights:[
      {id:'sand_key',kind:'point',pos:[3,-3,5],target:[0,0,.8],color:[1,.88,.68,1],intensity:48,range:16},
      {id:'sand_fill',kind:'point',pos:[-3,-1,3],target:[0,0,.7],color:[.70,.76,1,1],intensity:24,range:14},
    ],
    background:[.075,.085,.10,1],unified_renderer:true,
  }));
  window.VfDisplay.requestDynamicGeomFrameUpdate(frameId);
} catch(error) { window.__vfLastError=String(error&&error.stack||error); }
