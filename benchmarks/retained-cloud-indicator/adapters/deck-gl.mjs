import { INDICATOR_PROTOCOL } from '../protocol.mjs';
import { installWebGlFixtureTracker } from '../retention-ledger.mjs';

export const DECK_GL_VERSION = '9.3.11';

export function deckOrbitViewState(frame, viewport) {
  const rotationOrbit = -360 * frame / INDICATOR_PROTOCOL.orbitFrames;
  return {
    target: [0, 0, 0],
    zoom: Math.log2(viewport[1] / (2 * INDICATOR_PROTOCOL.renderState.orthographicHalfHeight)),
    rotationOrbit: rotationOrbit === 0 ? 0 : rotationOrbit,
    rotationX: 0,
  };
}

function readWebGlRgba(gl, width, height) {
  const bottomUp = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp);
  const rgba = new Uint8Array(bottomUp.length);
  for (let y = 0; y < height; y += 1) {
    const source = (height - 1 - y) * width * 4;
    rgba.set(bottomUp.subarray(source, source + width * 4), y * width * 4);
  }
  return rgba;
}

export function createDeckGlAdapter(host, fixture, options = {}) {
  const viewport = options.viewport ?? INDICATOR_PROTOCOL.viewport;
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = viewport;
  Object.assign(canvas.style, { width: `${viewport[0]}px`, height: `${viewport[1]}px` });
  host.replaceChildren(canvas);
  let tracker;
  let deck;
  let gl;
  let layer;
  let cameraUniformWrites = 0;
  let retainedPositions;
  let retainedColors;

  function render(frame) {
    deck.setProps({ viewState: deckOrbitViewState(frame, viewport), layers: [layer] });
    deck.redraw(true);
  }

  return Object.freeze({
    id: 'deck-gl-scatterplot',
    version: DECK_GL_VERSION,
    async initialize(lane) {
      const started = performance.now();
      tracker = installWebGlFixtureTracker(3_000_000);
      const [{ Deck, OrbitView, COORDINATE_SYSTEM }, { ScatterplotLayer }] = await Promise.all([
        import('@deck.gl/core'),
        import('@deck.gl/layers'),
      ]);
      retainedPositions = fixture.positions;
      retainedColors = fixture.colors;
      layer = new ScatterplotLayer({
        id: 'retained-cloud-scatterplot',
        data: {
          length: fixture.pointCount,
          attributes: {
            getPosition: { value: retainedPositions, size: 3 },
            getFillColor: { value: retainedColors, size: 4, normalized: true },
          },
        },
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        radiusUnits: 'pixels',
        radiusScale: 1,
        radiusMinPixels: lane.pointSizePx / 2,
        radiusMaxPixels: lane.pointSizePx / 2,
        getRadius: lane.pointSizePx / 2,
        filled: true,
        stroked: false,
        antialiasing: true,
        billboard: true,
        opacity: 1,
        pickable: false,
      });
      await new Promise((resolve, reject) => {
        deck = new Deck({
          canvas,
          width: viewport[0],
          height: viewport[1],
          useDevicePixels: 1,
          controller: false,
          views: [new OrbitView({
            id: 'retained-cloud-orbit',
            orbitAxis: 'Y',
            orthographic: true,
          })],
          viewState: deckOrbitViewState(0, viewport),
          layers: [layer],
          parameters: {
            depthWriteEnabled: true,
            depthCompare: 'less',
            blend: true,
          },
          onLoad: resolve,
          onError: reject,
        });
      });
      await new Promise((resolve, reject) => {
        deck.setProps({
          viewState: deckOrbitViewState(0, viewport),
          layers: [layer],
          onAfterRender: resolve,
          onError: reject,
        });
      });
      deck.setProps({ onAfterRender: () => {} });
      gl = deck.device?.gl ?? deck.animationLoop?.device?.gl ?? canvas.getContext('webgl2');
      if (!gl) throw new Error('deck.gl WebGL2 context unavailable');
      render(0);
      gl.finish();
      tracker.markInitialized();
      return {
        firstVisibleMs: performance.now() - started,
        uploadBytes: fixture.byteLength,
        estimatedGpuBytes: fixture.byteLength + viewport[0] * viewport[1] * 8,
        jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
        backend: `deck.gl ${DECK_GL_VERSION} ScatterplotLayer WebGL2`,
        timestampMode: 'unsupported by WebGL adapter',
        sampleCount: gl.getParameter(gl.SAMPLES),
        renderer: gl.getParameter(gl.RENDERER),
        vendor: gl.getParameter(gl.VENDOR),
        debug: {
          drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
          glError: gl.getError(),
          initialized: deck.isInitialized,
          layers: deck.layerManager?.getLayers?.().map((value) => value.id) ?? [],
          viewports: deck.getViewports().map((value) => ({
            id: value.id,
            size: [value.width, value.height],
            origin: value.project([0, 0, 0]),
            x: value.project([1, 0, 0]),
          })),
        },
      };
    },
    async submitFrame(frame) {
      render(frame);
      cameraUniformWrites += 1;
      return { cameraAngleRadians: 2 * Math.PI * frame / INDICATOR_PROTOCOL.orbitFrames };
    },
    async completeGpu() { gl.finish(); },
    async drainGpu() { gl.finish(); },
    async capture(frame) {
      gl.finish();
      return {
        frame,
        width: viewport[0],
        height: viewport[1],
        rgba: readWebGlRgba(gl, viewport[0], viewport[1]),
      };
    },
    retainedEvidence() {
      const currentLayer = deck?.props?.layers?.find((candidate) => candidate?.id === layer?.id);
      return {
        ...tracker.evidence(),
        cameraUniformWritesAfterInitialize: cameraUniformWrites,
        cameraUniformBytesAfterInitialize: cameraUniformWrites * 128,
        fixtureBufferIdentityStable: currentLayer === layer
          && layer?.props?.data?.attributes?.getPosition?.value === retainedPositions
          && layer?.props?.data?.attributes?.getFillColor?.value === retainedColors,
      };
    },
    async destroy() {
      try { deck?.finalize(); } finally { tracker?.restore(); }
    },
  });
}
