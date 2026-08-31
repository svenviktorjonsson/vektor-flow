import {
  cameraRangesForFrame,
  createBrowserPeerAdapter,
  fixtureView,
  installLargeBufferUploadTracker,
  prepareHost,
} from './browser-common.mjs';

export const DECK_GL_VERSION = '9.3.11';

export function deckBinaryPositions(points, pointCount) {
  if (!(points instanceof Float32Array) || points.length < pointCount * 2) {
    throw new TypeError('deck.gl positions must contain packed float32 x/y values');
  }
  return Object.freeze({ value: points, size: 2 });
}

export function createDeckGlLargeSceneAdapter(host, workload, options = {}) {
  prepareHost(host, workload);
  const fixture = fixtureView(workload, options.fixtureBytes);
  const tracker = options.tracker ?? installLargeBufferUploadTracker(workload.pointCount * 4);
  let deck = null;
  let canvas = null;
  let dependencies = options.dependencies ?? null;
  let layer = null;

  function draw(frame) {
    deck.setProps({ viewState: viewState(frame), layers: [layer] });
    deck.redraw('benchmark camera frame');
  }

  function viewState(frame) {
    const ranges = cameraRangesForFrame(workload, frame);
    const [width, height] = workload.viewport;
    return {
      target: [ranges.offset[0], ranges.offset[1], 0],
      zoomX: Math.log2(width / (ranges.x[1] - ranges.x[0])),
      zoomY: Math.log2(height / (ranges.y[1] - ranges.y[0])),
    };
  }

  return createBrowserPeerAdapter({
    version: DECK_GL_VERSION,
    host,
    workload,
    fixture,
    tracker,
    async initializeImpl() {
      dependencies ??= {
        ...(await import('@deck.gl/core')),
        ...(await import('@deck.gl/layers')),
      };
      const { Deck, OrthographicView, ScatterplotLayer, COORDINATE_SYSTEM } = dependencies;
      canvas = document.createElement('canvas');
      [canvas.width, canvas.height] = workload.viewport;
      Object.assign(canvas.style, { width: `${canvas.width}px`, height: `${canvas.height}px` });
      host.append(canvas);
      layer = new ScatterplotLayer({
        id: 'frozen-points',
        data: {
          length: workload.pointCount,
          attributes: { getPosition: deckBinaryPositions(fixture.points, workload.pointCount) },
        },
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        radiusUnits: 'pixels',
        radiusMinPixels: workload.pointDiameterPixels / 2,
        radiusMaxPixels: workload.pointDiameterPixels / 2,
        getRadius: workload.pointDiameterPixels / 2,
        getFillColor: workload.pointRgba,
        stroked: false,
        filled: true,
        antialiasing: true,
        pickable: false,
      });
      const loaded = new Promise((resolve, reject) => {
        deck = new Deck({
          canvas,
          width: workload.viewport[0],
          height: workload.viewport[1],
          useDevicePixels: 1,
          controller: false,
          views: [new OrthographicView({ id: 'frozen-orthographic', flipY: false })],
          viewState: viewState(0),
          layers: [layer],
          onLoad: resolve,
          onError: reject,
        });
      });
      await loaded;
      await new Promise((resolve, reject) => {
        deck.setProps({
          viewState: viewState(0),
          layers: [layer],
          onAfterRender: resolve,
          onError: reject,
        });
      });
    },
    async renderFrameImpl(frame) {
      draw(frame);
    },
    debugImpl() {
      return {
        initialized: deck?.isInitialized,
        canvas: canvas ? [canvas.width, canvas.height] : null,
        propLayers: deck?.props?.layers?.map((value) => value?.id),
        layers: deck?.layerManager?.getLayers?.().map((value) => value.id),
        viewports: deck?.getViewports?.().map((viewport) => ({
          size: [viewport.width, viewport.height],
          center: viewport.project([0, 0, 0]),
        })),
      };
    },
    async destroyImpl() { deck?.finalize(); },
  });
}
