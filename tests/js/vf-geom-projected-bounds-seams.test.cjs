const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '../../web/vf-ui/geom/vf-geom-wgpu.js'),
  'utf8'
);

assert.match(source, /_prepareShadowMapsForScene:\s*function \(enc, mesh, t, frameWidth, frameHeight, clusteredCamera\)/);
assert.match(source, /this\._planClusteredLightsForFrame\(this\._clusteredLightsForScene\(sceneLights, mesh\), clusteredCamera\);/);
assert.match(source, /var clusteredCameraBatch = this\._clusteredCameraForBatchScene\(mesh, t, aspBatch\);/);
assert.match(source, /this\._prepareShadowMapsForScene\(shadowEncBatch, mesh, t, wBatch, hBatch, clusteredCameraBatch\)/);
assert.match(source, /this\._planClusteredLightsForFrame\(this\._clusteredLightsForScene\(lightsNorm, mesh\),\s*clusteredCameraFromMatrices\(\s*viewMat,\s*projMat,/);
assert.doesNotMatch(source, /this\._planClusteredLightsForFrame\(sceneLights\);/);
assert.doesNotMatch(source, /this\._planClusteredLightsForFrame\(lightsNorm\);/);

console.log('vf-geom projected-bounds camera seam tests passed');
