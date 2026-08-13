import { createRetainedScreenSpaceSimplexScene } from './geom/vf-screen-simplex-renderer.mjs';

export const SCREEN_SCENE_LAYER = Object.freeze({
  FACE: 0,
  EDGE: 1,
  VERTEX: 2,
  OVERLAY: 3,
  SELECTION: 4
});

export function createLayeredScreenScene({ retained = createRetainedScreenSpaceSimplexScene() } = {}) {
  let records = [];

  return Object.freeze({
    beginFrame() {
      records = [];
    },
    primitive(scope, id, primitive, { selection = false, overlay = false } = {}) {
      const layer = selection
        ? SCREEN_SCENE_LAYER.SELECTION
        : overlay
          ? SCREEN_SCENE_LAYER.OVERLAY
          : primitiveLayer(primitive);
      records.push(Object.freeze({
        id: `${scope}:${selection ? 'selection:' : ''}${id}`,
        primitive,
        layer,
        order: records.length
      }));
    },
    commit(renderer) {
      retained.replace(records
        .sort((left, right) => left.layer - right.layer || left.order - right.order)
        .map(({ id, primitive }) => [id, primitive]));
      return renderer ? retained.commit(renderer) : false;
    },
    invalidate() {
      retained.invalidate();
    },
    snapshot() {
      return Object.freeze(records.map(({ id, primitive, layer }) => Object.freeze({
        id, primitive, layer
      })));
    }
  });
}

function primitiveLayer(primitive) {
  if (primitive?.kind === 'face') return SCREEN_SCENE_LAYER.FACE;
  if (primitive?.kind === 'vertex') return SCREEN_SCENE_LAYER.VERTEX;
  return SCREEN_SCENE_LAYER.EDGE;
}
