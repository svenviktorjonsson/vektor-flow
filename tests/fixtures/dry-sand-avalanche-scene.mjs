import {
  createDrySandEllipsoidRenderPacketReference,
  createDrySandHopperReference,
  measureDrySandPileStabilityReference,
  setDrySandBaseTiltReference,
  stepDrySandHopperReference,
} from '../../web/vf-ui/vf-sand-hopper-reference.mjs';

const frameId = 'dry_sand_avalanche_frame';
const world = createDrySandHopperReference({
  seed: 0xa71a, grainCount: 256, outletDiameterInGrains: 4.5,
});
stepDrySandHopperReference(world, 480);
const settledMetrics = measureDrySandPileStabilityReference(world);
const settled = createDrySandEllipsoidRenderPacketReference(world, { latitudeSegments: 5, longitudeSegments: 8 });
setDrySandBaseTiltReference(world, { degrees: 12, azimuthRadians: 0 });
stepDrySandHopperReference(world, 96);
const disturbedMetrics = measureDrySandPileStabilityReference(world);
const disturbed = createDrySandEllipsoidRenderPacketReference(world, { latitudeSegments: 5, longitudeSegments: 8 });
setDrySandBaseTiltReference(world, { degrees: 0, azimuthRadians: 0 });
stepDrySandHopperReference(world, 360);
const recoveredMetrics = measureDrySandPileStabilityReference(world);
const recovered = createDrySandEllipsoidRenderPacketReference(world, { latitudeSegments: 5, longitudeSegments: 8 });

function translated(packet, x, suffix, objectId) {
  return Object.freeze({ ...packet, id:`${packet.id}:${suffix}`, object_id:objectId,
    _modelMatrix:[1,0,0,0, 0,1,0,0, 0,0,1,0, x,0,0,1] });
}

function basePatch(x, slope, objectId) {
  const inverse = 1 / Math.sqrt(1 + slope * slope);
  const nx = -slope * inverse; const nz = inverse;
  return Object.freeze({
    type:'field_mesh',id:`sand:avalanche:base:${objectId}`,object_id:objectId,mode3d:true,
    topology:'triangle-list',static_vertices:true,static_indices:true,
    transparent:false,depth_write:true,receives_lighting:true,casts_shadow:false,receives_shadow:true,
    specular_strength:.04,_modelMatrix:[1,0,0,0, 0,1,0,0, 0,0,1,0, x,0,0,1],
    vertices:new Float32Array([
      -1.25,-1.15,-1.25*slope,nx,0,nz,.20,.18,.14,1,
       1.25,-1.15, 1.25*slope,nx,0,nz,.20,.18,.14,1,
       1.25, 1.15, 1.25*slope,nx,0,nz,.20,.18,.14,1,
      -1.25, 1.15,-1.25*slope,nx,0,nz,.20,.18,.14,1,
    ]),
    indices:new Uint32Array([0,1,2,0,2,3]),
  });
}

const meshes = [
  basePatch(-1.7, 0, 600), translated(settled, -1.7, 'settled', 601),
  basePatch(0, Math.tan(12 * Math.PI / 180), 610), translated(disturbed, 0, 'disturbed', 611),
  basePatch(1.7, 0, 620), translated(recovered, 1.7, 'recovered', 621),
];

try {
  await window.VfRuntimeShell.ensureSceneDependencies();
  const panel = window.VfFrame.mount(document.getElementById('layer'), {
    id:frameId,title:'Settled (left) / 12° base avalanche (middle) / recovered repose (right)',
    draggable:false,dockable:false,resizable:false,closable:false,
  });
  panel.root.style.left='2%'; panel.root.style.top='2%'; panel.root.style.width='96%'; panel.root.style.height='96%';
  window.__drySandAvalancheEvidence={
    settledMetrics,disturbedMetrics,recoveredMetrics,complete:true,wgpuErrors:[],
  };
  window.VfDisplay.mountDynamicGeomFrame(frameId,()=>({
    meshes,
    camera:{pos:[4.4,-7.6,3.5],target:[0,0,.25],up:[0,0,1],fov:32},
    lights:[
      {id:'sand_key',kind:'point',pos:[3,-4,6],target:[0,0,.3],color:[1,.88,.68,1],intensity:56,range:18},
      {id:'sand_fill',kind:'point',pos:[-4,1,4],target:[0,0,.3],color:[.70,.78,1,1],intensity:22,range:16},
    ],
    background:[.08,.10,.12,1],unified_renderer:true,
  }));
  window.VfDisplay.requestDynamicGeomFrameUpdate(frameId);
} catch(error) { window.__vfLastError=String(error&&error.stack||error); }
