const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

export function importGlb(input, { name = 'Imported GLB' } = {}) {
  const bytes = asBytes(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) {
    throw new TypeError('The file is not a binary glTF (GLB) document.');
  }
  if (view.getUint32(4, true) !== 2) throw new TypeError('Only glTF 2.0 GLB files are supported.');
  if (view.getUint32(8, true) !== bytes.byteLength) throw new TypeError('The GLB length header is invalid.');
  let offset = 12;
  let json = null;
  let binary = null;
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    offset += 8;
    if (offset + length > bytes.byteLength) throw new TypeError('A GLB chunk exceeds the file length.');
    const chunk = bytes.subarray(offset, offset + length);
    if (type === JSON_CHUNK) json = JSON.parse(new TextDecoder().decode(chunk).replace(/\0+\s*$/, '').trim());
    if (type === BIN_CHUNK) binary = chunk;
    offset += length;
  }
  if (!json || !binary) throw new TypeError('GLB requires JSON and binary chunks.');
  rejectUnsupportedCompression(json);
  const materials = (json.materials || []).map((material, index) => normalizeMaterial(material, index, json));
  const images = (json.images || []).map((image, index) => normalizeImage(image, index, json, binary));
  const primitives = [];
  for (const entry of sceneNodes(json)) {
    const node = json.nodes?.[entry.nodeIndex];
    if (!node || node.mesh == null) continue;
    const mesh = json.meshes?.[node.mesh];
    if (!mesh) continue;
    for (let primitiveIndex = 0; primitiveIndex < (mesh.primitives || []).length; primitiveIndex += 1) {
      const primitive = mesh.primitives[primitiveIndex];
      if (primitive.mode != null && ![4, 5, 6].includes(primitive.mode)) continue;
      const positions = readAccessor(json, binary, primitive.attributes?.POSITION);
      if (!positions?.length) continue;
      const normals = readAccessor(json, binary, primitive.attributes?.NORMAL);
      const texcoords = readAccessor(json, binary, primitive.attributes?.TEXCOORD_0);
      const indices = primitive.indices == null
        ? positions.map((_, index) => index)
        : readAccessor(json, binary, primitive.indices).flat();
      primitives.push(Object.freeze({
        id: `mesh-${node.mesh}-primitive-${primitiveIndex}`,
        name: mesh.name || node.name || `Mesh ${node.mesh + 1}`,
        positions: Object.freeze(positions.map((position) => Object.freeze(transformPoint(entry.matrix, position)))),
        normals: Object.freeze((normals || []).map((normal) => Object.freeze(transformNormal(entry.matrix, normal)))),
        texcoords: Object.freeze((texcoords || []).map((coordinate) => Object.freeze(coordinate.slice(0, 2)))),
        triangles: Object.freeze(triangulate(indices, primitive.mode ?? 4).map((triangle) => Object.freeze(triangle))),
        material: primitive.material == null ? null : primitive.material
      }));
    }
  }
  if (!primitives.length) throw new TypeError('GLB contains no supported triangle mesh primitives.');
  return deepFreeze({
    format: 'vkf.glb-asset',
    version: 1,
    name,
    source: { mediaType: 'model/gltf-binary', base64: bytesToBase64(bytes) },
    primitives,
    materials,
    images,
    animations: json.animations || [],
    metadata: { asset: json.asset || {}, scene: json.scene ?? 0 }
  });
}

export function exportGlbAsset(asset) {
  if (asset?.format !== 'vkf.glb-asset' || !asset?.source?.base64) throw new TypeError('Invalid VKF GLB asset.');
  return base64ToBytes(asset.source.base64);
}

function sceneNodes(json) {
  const result = [];
  const roots = json.scenes?.[json.scene ?? 0]?.nodes || json.nodes?.map((_, index) => index) || [];
  const visit = (nodeIndex, parent) => {
    const node = json.nodes?.[nodeIndex];
    if (!node) return;
    const matrix = multiply4(parent, nodeMatrix(node));
    result.push({ nodeIndex, matrix });
    for (const child of node.children || []) visit(child, matrix);
  };
  for (const root of roots) visit(root, identity4());
  return result;
}

function readAccessor(json, binary, accessorIndex) {
  if (accessorIndex == null) return null;
  const accessor = json.accessors?.[accessorIndex];
  const bufferView = json.bufferViews?.[accessor?.bufferView];
  if (!accessor || !bufferView || (bufferView.buffer ?? 0) !== 0 || accessor.sparse) {
    throw new TypeError('GLB accessor layout is unsupported.');
  }
  const components = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 })[accessor.type];
  const bytesPerComponent = ({ 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 })[accessor.componentType];
  if (!components || !bytesPerComponent) throw new TypeError('Unsupported GLB accessor component type.');
  const stride = bufferView.byteStride || components * bytesPerComponent;
  const start = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  return Array.from({ length: accessor.count }, (_, item) => Array.from({ length: components }, (_, component) =>
    componentValue(view, start + item * stride + component * bytesPerComponent, accessor.componentType, accessor.normalized)
  ));
}

function componentValue(view, offset, type, normalized) {
  const value = ({
    5120: () => view.getInt8(offset), 5121: () => view.getUint8(offset),
    5122: () => view.getInt16(offset, true), 5123: () => view.getUint16(offset, true),
    5125: () => view.getUint32(offset, true), 5126: () => view.getFloat32(offset, true)
  })[type]();
  if (!normalized || type === 5126 || type === 5125) return value;
  return type === 5120 ? Math.max(value / 127, -1)
    : type === 5121 ? value / 255
      : type === 5122 ? Math.max(value / 32767, -1) : value / 65535;
}

function triangulate(indices, mode) {
  const result = [];
  if (mode === 4) for (let index = 0; index + 2 < indices.length; index += 3) result.push(indices.slice(index, index + 3));
  if (mode === 5) for (let index = 2; index < indices.length; index += 1) result.push(index % 2 ? [indices[index - 1], indices[index - 2], indices[index]] : [indices[index - 2], indices[index - 1], indices[index]]);
  if (mode === 6) for (let index = 2; index < indices.length; index += 1) result.push([indices[0], indices[index - 1], indices[index]]);
  return result.filter((triangle) => new Set(triangle).size === 3);
}

function normalizeMaterial(material, index, json) {
  const pbr = material.pbrMetallicRoughness || {};
  return {
    name: material.name || `Material ${index + 1}`,
    baseColorFactor: pbr.baseColorFactor || [1, 1, 1, 1],
    baseColorTexture: textureSource(pbr.baseColorTexture, json),
    metallicFactor: pbr.metallicFactor ?? 1,
    roughnessFactor: pbr.roughnessFactor ?? 1,
    metallicRoughnessTexture: textureSource(pbr.metallicRoughnessTexture, json),
    normalTexture: textureSource(material.normalTexture, json),
    emissiveFactor: material.emissiveFactor || [0, 0, 0],
    emissiveTexture: textureSource(material.emissiveTexture, json),
    alphaMode: material.alphaMode || 'OPAQUE',
    alphaCutoff: material.alphaCutoff ?? 0.5,
    doubleSided: material.doubleSided === true
  };
}
function textureSource(info, json) { return info == null ? null : json.textures?.[info.index]?.source ?? null; }
function normalizeImage(image, index, json, binary) {
  if (image.uri) return { name: image.name || `Image ${index + 1}`, mediaType: image.mimeType || '', uri: image.uri };
  const view = json.bufferViews?.[image.bufferView];
  if (!view) return null;
  const bytes = binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
  return { name: image.name || `Image ${index + 1}`, mediaType: image.mimeType || 'application/octet-stream', base64: bytesToBase64(bytes) };
}
function rejectUnsupportedCompression(json) {
  const used = new Set(json.extensionsUsed || []);
  for (const extension of ['KHR_draco_mesh_compression', 'EXT_meshopt_compression']) {
    if (used.has(extension)) throw new TypeError(`${extension} compressed GLB requires a decoder and is not supported yet.`);
  }
}
function nodeMatrix(node) {
  if (node.matrix) return node.matrix;
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  return [(1-2*y*y-2*z*z)*sx,(2*x*y+2*z*w)*sx,(2*x*z-2*y*w)*sx,0,(2*x*y-2*z*w)*sy,(1-2*x*x-2*z*z)*sy,(2*y*z+2*x*w)*sy,0,(2*x*z+2*y*w)*sz,(2*y*z-2*x*w)*sz,(1-2*x*x-2*y*y)*sz,0,tx,ty,tz,1];
}
function identity4() { return [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]; }
function multiply4(a, b) { return Array.from({ length: 16 }, (_, i) => { const row = i % 4; const column = Math.floor(i / 4); return a[row]*b[column*4]+a[row+4]*b[column*4+1]+a[row+8]*b[column*4+2]+a[row+12]*b[column*4+3]; }); }
function transformPoint(m, p) { return [m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12],m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13],m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]]; }
function transformNormal(m, p) { const value = [m[0]*p[0]+m[4]*p[1]+m[8]*p[2],m[1]*p[0]+m[5]*p[1]+m[9]*p[2],m[2]*p[0]+m[6]*p[1]+m[10]*p[2]]; const length = Math.hypot(...value) || 1; return value.map((entry) => entry / length); }
function asBytes(value) { if (value instanceof Uint8Array) return value; if (value instanceof ArrayBuffer) return new Uint8Array(value); if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength); throw new TypeError('GLB input must be binary data.'); }
function bytesToBase64(bytes) { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return typeof btoa === 'function' ? btoa(binary) : globalThis.Buffer.from(bytes).toString('base64'); }
function base64ToBytes(value) { const binary = typeof atob === 'function' ? atob(value) : globalThis.Buffer.from(value, 'base64').toString('binary'); return Uint8Array.from(binary, (character) => character.charCodeAt(0)); }
function deepFreeze(value) { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; for (const child of Object.values(value)) deepFreeze(child); return Object.freeze(value); }
