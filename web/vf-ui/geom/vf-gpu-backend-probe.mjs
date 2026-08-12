export function createWebGpuProbeCanvas(canvas) {
  if (typeof globalThis.OffscreenCanvas === 'function') {
    return new globalThis.OffscreenCanvas(1, 1);
  }
  const document = canvas?.ownerDocument || globalThis.document;
  if (typeof document?.createElement === 'function') return document.createElement('canvas');
  return typeof canvas?.cloneNode === 'function' ? canvas.cloneNode(false) : null;
}
