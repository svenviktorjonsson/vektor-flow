export const RETAINED_POINT_DATA = Symbol('vf.retained-point-data');
export const RETAINED_POINT_COMPONENTS = Symbol('vf.retained-point-components');
export const RETAINED_POINT_REDRAW = Symbol('vf.retained-point-redraw');

export function setRetainedWorldPointCloud(renderer, points, projection, options = {}) {
  if (!renderer || typeof renderer.setWorldPoints !== 'function') {
    throw new TypeError('retained point-cloud renderer must provide setWorldPoints');
  }
  renderer.setWorldPoints(points, projection, {
    ...options,
    [RETAINED_POINT_DATA]: true,
  });
}

export function setRetainedWorldPointCloud2D(renderer, points, projection, options = {}) {
  if (!renderer || typeof renderer.setWorldPoints !== 'function') {
    throw new TypeError('retained point-cloud renderer must provide setWorldPoints');
  }
  renderer.setWorldPoints(points, projection, {
    ...options,
    [RETAINED_POINT_DATA]: true,
    [RETAINED_POINT_COMPONENTS]: 2,
  });
}
