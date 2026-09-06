import {
  createWeatheredGraniteSpecimenReference,
} from '../../web/vf-ui/vf-weathered-granite-specimen.mjs';

const identity = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x243f6a88, 0x85a308d3]),
  domain: 'material',
  hierarchy: Object.freeze(['world:highland', 'stone:fieldstone-review']),
  lod: 0,
  channel: 'geology',
});

const config = window.__stoneSpecimenView;
const frameId = 'weathered_granite_specimen_frame';
const specimen = createWeatheredGraniteSpecimenReference(identity);
const groundVertices = new Float32Array([
  -7, -6, -0.035, 0, 0, 1, 0.16, 0.17, 0.16, 1,
   7, -6, -0.035, 0, 0, 1, 0.16, 0.17, 0.16, 1,
   7,  6, -0.035, 0, 0, 1, 0.16, 0.17, 0.16, 1,
  -7,  6, -0.035, 0, 0, 1, 0.16, 0.17, 0.16, 1,
]);
const ground = Object.freeze({
  type: 'field_mesh', id: 'stone:ground', object_id: 2, mode3d: true,
  topology: 'triangle-list', static_vertices: true, static_indices: true,
  receives_lighting: true, casts_shadow: false, receives_shadow: true,
  specular_strength: 0.04,
  vertices: groundVertices,
  indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
});

try {
  await window.VfRuntimeShell.ensureSceneDependencies();
  const panel = window.VfFrame.mount(document.getElementById('layer'), {
    id: frameId,
    title: config.title,
    draggable: false,
    dockable: false,
    resizable: false,
    closable: false,
  });
  panel.root.style.left = '2%';
  panel.root.style.top = '2%';
  panel.root.style.width = '96%';
  panel.root.style.height = '96%';
  const lights = config.neutral ? [
    { id: 'neutral_key', kind: 'point', pos: [3, -4, 6], target: [0, 0, 0.8], color: [1, 1, 1, 1], intensity: 26, range: 18 },
    { id: 'neutral_fill', kind: 'point', pos: [-4, -1, 3], target: [0, 0, 0.8], color: [1, 1, 1, 1], intensity: 15, range: 16 },
  ] : [
    { id: 'warm_key', kind: 'point', pos: [4, -5, 6], target: [0, 0, 0.8], color: [1, 0.91, 0.78, 1], intensity: 36, range: 20 },
    { id: 'cool_fill', kind: 'point', pos: [-4, -1, 3], target: [0, 0, 0.8], color: [0.60, 0.72, 1, 1], intensity: 13, range: 18 },
  ];
  window.__weatheredGraniteEvidence = {
    kind: specimen.kind,
    metrics: specimen.metrics,
    vectorBytes: specimen.vectorBytes,
    vertexCount: specimen.packet.vertices.length / 10,
    triangleCount: specimen.packet.indices.length / 3,
    materialKind: specimen.packet.material_channels.kind,
  };
  window.VfDisplay.mountDynamicGeomFrame(frameId, () => ({
    meshes: config.ground ? [ground, specimen.packet] : [specimen.packet],
    camera: { pos: config.camera, target: config.target, up: [0, 0, 1], fov: config.fov },
    lights,
    background: config.neutral ? [0.32, 0.32, 0.32, 1] : [0.035, 0.045, 0.055, 1],
    unified_renderer: true,
  }));
  window.VfDisplay.requestDynamicGeomFrameUpdate(frameId);
} catch (error) {
  window.__vfLastError = String(error && error.stack || error);
}
