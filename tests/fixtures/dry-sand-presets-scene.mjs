import {
  createDrySandEllipsoidRenderPacketReference,
  createDrySandHopperHardwarePacketsReference,
  createDrySandHopperReference,
  stepDrySandHopperReference,
} from '../../web/vf-ui/vf-sand-hopper-reference.mjs';

const frameId = 'dry_sand_presets_frame';
const fine = createDrySandHopperReference({
  seed: 0x8123, grainCount: 256, preset: 'fine', outletDiameterInGrains: 4.2,
});
const coarse = createDrySandHopperReference({
  seed: 0x8123, grainCount: 256, preset: 'coarse', outletDiameterInGrains: 4.2,
});
stepDrySandHopperReference(fine, 260);
stepDrySandHopperReference(coarse, 260);

function translated(packet, x, suffix, objectId) {
  return Object.freeze({ ...packet, id: `${packet.id}:${suffix}`, object_id: objectId,
    _modelMatrix: [1,0,0,0, 0,1,0,0, 0,0,1,0, x,0,0,1] });
}

const meshes = [];
for (const [world, x, suffix, objectBase] of [
  [fine, -0.92, 'fine', 410], [coarse, 0.92, 'coarse', 420],
]) {
  meshes.push(translated(createDrySandEllipsoidRenderPacketReference(world, {
    latitudeSegments: 5, longitudeSegments: 8,
  }), x, suffix, objectBase));
  createDrySandHopperHardwarePacketsReference(world).forEach((packet, index) => {
    meshes.push(translated(packet, x, suffix, objectBase + index + 1));
  });
}
const ground = Object.freeze({
  type:'field_mesh',id:'sand:presets:ground',object_id:400,mode3d:true,
  topology:'triangle-list',static_vertices:true,static_indices:true,
  transparent:false,depth_write:true,receives_lighting:true,casts_shadow:false,receives_shadow:true,
  specular_strength:.04,
  vertices:new Float32Array([-4,-3,-.004,0,0,1,.20,.18,.14,1, 4,-3,-.004,0,0,1,.20,.18,.14,1,
    4,3,-.004,0,0,1,.20,.18,.14,1, -4,3,-.004,0,0,1,.20,.18,.14,1]),
  indices:new Uint32Array([0,1,2,0,2,3]),
});

try {
  await window.VfRuntimeShell.ensureSceneDependencies();
  const panel = window.VfFrame.mount(document.getElementById('layer'), {
    id:frameId,title:'Fine sand (left) / coarse sand (right) — conditioned contact state',
    draggable:false,dockable:false,resizable:false,closable:false,
  });
  panel.root.style.left='2%'; panel.root.style.top='2%'; panel.root.style.width='96%'; panel.root.style.height='96%';
  window.__drySandPresetEvidence={fine,coarse};
  window.VfDisplay.mountDynamicGeomFrame(frameId,()=>({
    meshes:[ground,...meshes],
    camera:{pos:[3.8,-6.8,3.3],target:[0,0,.92],up:[0,0,1],fov:32},
    lights:[
      {id:'sand_key',kind:'point',pos:[3,-4,6],target:[0,0,.8],color:[1,.88,.68,1],intensity:54,range:18},
      {id:'sand_fill',kind:'point',pos:[-4,1,4],target:[0,0,.7],color:[.70,.78,1,1],intensity:21,range:16},
    ],
    background:[.08,.10,.12,1],unified_renderer:true,
  }));
  window.VfDisplay.requestDynamicGeomFrameUpdate(frameId);
} catch(error) { window.__vfLastError=String(error&&error.stack||error); }
