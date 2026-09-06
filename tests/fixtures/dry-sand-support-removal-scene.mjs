import {
  createDrySandHopperReference,
  createDrySandEllipsoidRenderPacketReference,
  createDrySandObstacleRenderPacketReference,
  measureDrySandPileStabilityReference,
  removeDrySandReceivingObstacleReference,
  setDrySandReceivingObstacleReference,
  stepDrySandHopperReference,
  syncDrySandEllipsoidRenderPacketReference,
} from '../../web/vf-ui/vf-sand-hopper-reference.mjs';

const phase = new URLSearchParams(location.search).get('phase') === 'removed' ? 'removed' : 'supported';
const frameId = 'dry_sand_support_frame';
const world = createDrySandHopperReference({ seed:0xb01e, grainCount:256, outletDiameterInGrains:4.5 });
setDrySandReceivingObstacleReference(world, { center:[0,0,.13], radii:[.23,.18,.13] });
stepDrySandHopperReference(world, 600);
const obstacle = createDrySandObstacleRenderPacketReference(world);
if (phase === 'removed') {
  removeDrySandReceivingObstacleReference(world);
  stepDrySandHopperReference(world, 480);
}
const grains = createDrySandEllipsoidRenderPacketReference(world, { latitudeSegments:5, longitudeSegments:8 });
const ground = {
  type:'field_mesh',id:'sand:plane',object_id:3,mode3d:true,topology:'triangle-list',
  static_vertices:true,static_indices:true,receives_lighting:true,casts_shadow:false,
  receives_shadow:false,specular_strength:.04,
  vertices:new Float32Array([-3,-3,0,0,0,1,.15,.14,.12,1,3,-3,0,0,0,1,.15,.14,.12,1,3,3,0,0,0,1,.15,.14,.12,1,-3,3,0,0,0,1,.15,.14,.12,1]),
  indices:new Uint32Array([0,1,2,0,2,3]),
};

try {
  await window.VfRuntimeShell.ensureSceneDependencies();
  const panel=window.VfFrame.mount(document.getElementById('layer'),{
    id:frameId,title:`Dry sand — ${phase === 'removed' ? 'obstacle removed and relaxed' : 'supported by receiving ellipsoid'}`,
    draggable:false,dockable:false,resizable:false,closable:false,
  });
  panel.root.style.left='2%';panel.root.style.top='2%';panel.root.style.width='96%';panel.root.style.height='96%';
  window.VfDisplay.mountDynamicGeomFrame(frameId,()=>({
    meshes:[ground,...(phase === 'removed' ? [] : [obstacle]),grains],
    camera:{pos:[1.5,-2.5,1.25],target:[0,0,.16],up:[0,0,1],fov:27},
    lights:[{id:'key',kind:'point',pos:[2,-2,3],target:[0,0,.15],color:[1,.88,.68,1],intensity:42,range:12},{id:'fill',kind:'point',pos:[-2,-1,2],target:[0,0,.1],color:[.7,.76,1,1],intensity:20,range:10}],
    background:[.075,.085,.10,1],unified_renderer: true,
  }));
  syncDrySandEllipsoidRenderPacketReference(world,grains);
  window.VfDisplay.requestDynamicGeomFrameUpdate(frameId);
  document.body.dataset.complete='true';
  document.body.dataset.maximumHeight=String(measureDrySandPileStabilityReference(world).maximumHeight);
} catch(error){window.__vfLastError=String(error&&error.stack||error);}
