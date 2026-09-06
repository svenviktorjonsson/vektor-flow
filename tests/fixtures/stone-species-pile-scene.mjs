import {
  createStoneSpeciesPileReference,
} from '../../web/vf-ui/vf-stone-species-pile.mjs';

const config = window.__stonePileView;
const frameId = 'stone_species_pile_frame';
const pile = createStoneSpeciesPileReference();
const ground = Object.freeze({
  type: 'field_mesh', id: 'stone:pile:ground', object_id: 100, mode3d: true,
  topology: 'triangle-list', static_vertices: true, static_indices: true,
  receives_lighting: true, casts_shadow: false, receives_shadow: true,
  specular_strength: 0.03,
  vertices: new Float32Array([
    -9, -7, -0.015, 0, 0, 1, 0.13, 0.135, 0.13, 1,
     9, -7, -0.015, 0, 0, 1, 0.13, 0.135, 0.13, 1,
     9,  7, -0.015, 0, 0, 1, 0.13, 0.135, 0.13, 1,
    -9,  7, -0.015, 0, 0, 1, 0.13, 0.135, 0.13, 1,
  ]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
});

try {
  await window.VfRuntimeShell.ensureSceneDependencies();
  const panel = window.VfFrame.mount(document.getElementById('layer'), {
    id: frameId, title: config.title, draggable: false, dockable: false,
    resizable: false, closable: false,
  });
  panel.root.style.left = '2%';
  panel.root.style.top = '2%';
  panel.root.style.width = '96%';
  panel.root.style.height = '96%';
  window.__stonePileEvidence = {
    kind: pile.kind,
    count: pile.individuals.length,
    speciesCounts: pile.profiles.map((profile, speciesIndex) => ({
      id: profile.id,
      count: pile.individuals.filter((item) => item.speciesIndex === speciesIndex).length,
    })),
    individuals: pile.individuals,
  };
  window.VfDisplay.mountDynamicGeomFrame(frameId, () => ({
    meshes: [ground, ...pile.meshes],
    camera: { pos: config.camera, target: config.target, up: [0, 0, 1], fov: config.fov },
    lights: [
      { id: 'pile_key', kind: 'point', pos: config.light, target: [0, 0, 0.3], color: [1, 0.97, 0.91, 1], intensity: 58, range: 24 },
      { id: 'pile_fill', kind: 'point', pos: [-5, 2, 5], target: [0, 0, 0.2], color: [0.70, 0.80, 1, 1], intensity: 19, range: 20 },
    ],
    background: [0.16, 0.17, 0.18, 1],
    unified_renderer: true,
  }));
  window.VfDisplay.requestDynamicGeomFrameUpdate(frameId);
} catch (error) {
  window.__vfLastError = String(error && error.stack || error);
}
