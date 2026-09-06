import {
  createShoreBeachReference,
  createShoreBeachRenderPacketsReference,
} from '../../web/vf-ui/vf-shore-beach-reference.mjs';

const frameId = 'shore_beach_frame';
const shore = createShoreBeachReference({ seed: 0x5eac, resolution: 65 });
const packets = createShoreBeachRenderPacketsReference(shore);

try {
  await window.VfRuntimeShell.ensureSceneDependencies();
  const panel = window.VfFrame.mount(document.getElementById('layer'), {
    id: frameId, title: 'Deterministic shore — shared terrain, sediment, water and stones',
    draggable: false, dockable: false, resizable: false, closable: false,
  });
  panel.root.style.left = '2%'; panel.root.style.top = '2%';
  panel.root.style.width = '96%'; panel.root.style.height = '96%';
  window.__shoreBeachEvidence = {
    revision: shore.revision, waterlineSegments: shore.waterlineSegments.length,
    rockCount: shore.rocks.length, metrics: shore.metrics,
  };
  window.VfDisplay.mountDynamicGeomFrame(frameId, () => ({
    meshes: [packets.terrain, packets.sediment, packets.water, ...packets.rocks],
    camera: { pos: [5.8, -7.8, 5.5], target: [0, 0, 0], up: [0, 0, 1], fov: 33 },
    lights: [
      { id: 'shore_key', kind: 'point', pos: [-4, -5, 8], target: [0, 0, 0], color: [1, .93, .82, 1], intensity: 72, range: 28 },
      { id: 'shore_fill', kind: 'point', pos: [5, 3, 5], target: [0, 0, 0], color: [.64, .78, 1, 1], intensity: 24, range: 24 },
    ],
    background: [0.12, 0.18, 0.23, 1], unified_renderer: true,
  }));
  window.VfDisplay.requestDynamicGeomFrameUpdate(frameId);
} catch (error) {
  window.__vfLastError = String(error && error.stack || error);
}
