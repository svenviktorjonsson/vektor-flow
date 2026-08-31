function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function nonNegativeFinite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${label} must be non-negative and finite`);
  return number;
}

function vector3(value, label) {
  if (!Array.isArray(value) || value.length !== 3) throw new TypeError(`${label} must have three components`);
  return value.map((component, index) => finiteNumber(component, `${label}[${index}]`));
}

function matrix4(value, label) {
  if (!value || value.length !== 16) throw new TypeError(`${label} must have sixteen components`);
  return Array.from(value, (component, index) => finiteNumber(component, `${label}[${index}]`));
}

function normalizeCamera(camera) {
  if (!camera || typeof camera !== 'object') throw new TypeError('camera must be an object');
  const nearDepth = finiteNumber(camera.nearDepth, 'camera.nearDepth');
  const farDepth = finiteNumber(camera.farDepth, 'camera.farDepth');
  if (!(nearDepth > 0)) throw new RangeError('camera.nearDepth must be positive');
  if (!(farDepth > nearDepth)) throw new RangeError('camera.farDepth must exceed camera.nearDepth');
  return {
    viewMatrix: matrix4(camera.viewMatrix, 'camera.viewMatrix'),
    projectionMatrix: matrix4(camera.projectionMatrix, 'camera.projectionMatrix'),
    nearDepth,
    farDepth
  };
}

// Repository matrices are column-major: result = matrix * column-vector.
function transformPoint(matrix, point) {
  const x = point[0], y = point[1], z = point[2];
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  if (!Number.isFinite(w) || Math.abs(w) <= Number.EPSILON) {
    throw new RangeError('camera.viewMatrix produced a non-projectable point');
  }
  return [
    (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w,
    (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w,
    (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w
  ];
}

function projectViewPoint(viewPoint, projectionMatrix) {
  const x = viewPoint[0], y = viewPoint[1], z = viewPoint[2];
  const clipX = projectionMatrix[0] * x + projectionMatrix[4] * y + projectionMatrix[8] * z + projectionMatrix[12];
  const clipY = projectionMatrix[1] * x + projectionMatrix[5] * y + projectionMatrix[9] * z + projectionMatrix[13];
  const clipZ = projectionMatrix[2] * x + projectionMatrix[6] * y + projectionMatrix[10] * z + projectionMatrix[14];
  const clipW = projectionMatrix[3] * x + projectionMatrix[7] * y + projectionMatrix[11] * z + projectionMatrix[15];
  if (!Number.isFinite(clipW) || Math.abs(clipW) <= Number.EPSILON) {
    throw new RangeError('camera.projectionMatrix produced zero clip W');
  }
  const ndc = [clipX / clipW, clipY / clipW, clipZ / clipW];
  if (!ndc.every(Number.isFinite)) throw new RangeError('camera projection produced non-finite NDC');
  return { ndc, clipW };
}

export function projectWorldPointToCamera(worldPoint, cameraInput) {
  const camera = normalizeCamera(cameraInput);
  const viewPosition = transformPoint(camera.viewMatrix, vector3(worldPoint, 'worldPoint'));
  const projected = projectViewPoint(viewPosition, camera.projectionMatrix);
  return {
    viewPosition,
    viewDepth: -viewPosition[2],
    clipW: projected.clipW,
    ndc: projected.ndc
  };
}

function viewAabbForSphere(position, radius, viewMatrix) {
  const center = transformPoint(viewMatrix, position);
  const xExtent = radius * Math.hypot(viewMatrix[0], viewMatrix[4], viewMatrix[8]);
  const yExtent = radius * Math.hypot(viewMatrix[1], viewMatrix[5], viewMatrix[9]);
  const zExtent = radius * Math.hypot(viewMatrix[2], viewMatrix[6], viewMatrix[10]);
  return { center, extent: [xExtent, yExtent, zExtent] };
}

function boxCorners(box) {
  const result = [];
  for (let bits = 0; bits < 8; bits += 1) {
    result.push([
      box.center[0] + ((bits & 1) ? box.extent[0] : -box.extent[0]),
      box.center[1] + ((bits & 2) ? box.extent[1] : -box.extent[1]),
      box.center[2] + ((bits & 4) ? box.extent[2] : -box.extent[2])
    ]);
  }
  return result;
}

function clippedBoxPoints(box, nearDepth, farDepth) {
  const corners = boxCorners(box);
  const points = corners.filter(point => -point[2] >= nearDepth && -point[2] <= farDepth);
  for (let bits = 0; bits < 8; bits += 1) {
    for (const axisBit of [1, 2, 4]) {
      if ((bits & axisBit) !== 0) continue;
      const left = corners[bits];
      const right = corners[bits | axisBit];
      const leftDepth = -left[2];
      const rightDepth = -right[2];
      for (const planeDepth of [nearDepth, farDepth]) {
        if ((leftDepth - planeDepth) * (rightDepth - planeDepth) > 0 || leftDepth === rightDepth) continue;
        const t = (planeDepth - leftDepth) / (rightDepth - leftDepth);
        if (t < 0 || t > 1) continue;
        points.push([
          left[0] + (right[0] - left[0]) * t,
          left[1] + (right[1] - left[1]) * t,
          left[2] + (right[2] - left[2]) * t
        ]);
      }
    }
  }
  return points;
}

function projectSphereBounds(position, radius, camera) {
  const box = viewAabbForSphere(position, radius, camera.viewMatrix);
  const centerDepth = -box.center[2];
  const depthExtent = box.extent[2];
  if (centerDepth + depthExtent < camera.nearDepth || centerDepth - depthExtent > camera.farDepth) return null;
  const points = clippedBoxPoints(box, camera.nearDepth, camera.farDepth);
  if (points.length === 0) return null;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const point of points) {
    const projected = projectViewPoint(point, camera.projectionMatrix);
    minX = Math.min(minX, projected.ndc[0]);
    maxX = Math.max(maxX, projected.ndc[0]);
    minY = Math.min(minY, projected.ndc[1]);
    maxY = Math.max(maxY, projected.ndc[1]);
  }
  if (maxX < -1 || minX > 1 || maxY < -1 || minY > 1) return null;
  return {
    minX: Math.max(-1, minX),
    maxX: Math.min(1, maxX),
    minY: Math.max(-1, minY),
    maxY: Math.min(1, maxY),
    minDepth: Math.max(camera.nearDepth, centerDepth - depthExtent),
    maxDepth: Math.min(camera.farDepth, centerDepth + depthExtent)
  };
}

function normalizedDirection(value) {
  const direction = vector3(value, 'light.direction');
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (!(length > Number.EPSILON)) throw new RangeError('light.direction must be non-zero');
  return direction.map(component => component / length);
}

function spotEnvelope(light) {
  const position = vector3(light.position, 'light.position');
  const direction = normalizedDirection(light.direction);
  const range = nonNegativeFinite(light.range, 'light.range');
  const outerConeCos = finiteNumber(light.outerConeCos, 'light.outerConeCos');
  if (!(outerConeCos > 0 && outerConeCos <= 1)) {
    throw new RangeError('light.outerConeCos must be greater than zero and at most one');
  }
  const baseRadius = range * Math.sqrt(Math.max(0, 1 - outerConeCos * outerConeCos)) / outerConeCos;
  const radius = Math.hypot(range * 0.5, baseRadius);
  if (!Number.isFinite(radius)) throw new RangeError('spot-light envelope must be finite');
  return {
    position: position.map((component, index) => component + direction[index] * range * 0.5),
    radius
  };
}

function geometryEnvelope(light) {
  if (!Array.isArray(light.points)) throw new TypeError('light.points must be an array');
  if (light.points.length === 0) throw new RangeError('light.points must not be empty');
  const points = light.points.map((point, index) => vector3(point, `light.points[${index}]`));
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (const point of points) {
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis], point[axis]);
      maximum[axis] = Math.max(maximum[axis], point[axis]);
    }
  }
  const position = minimum.map((value, axis) => (value + maximum[axis]) * 0.5);
  let radius = 0;
  for (const point of points) {
    radius = Math.max(radius, Math.hypot(
      point[0] - position[0],
      point[1] - position[1],
      point[2] - position[2]
    ));
  }
  return { position, radius };
}

export function projectLightViewBounds(light, cameraInput) {
  if (!light || typeof light !== 'object') throw new TypeError('light must be an object');
  const camera = normalizeCamera(cameraInput);
  let envelope;
  if (light.kind === 'point') {
    envelope = {
      position: vector3(light.position, 'light.position'),
      radius: nonNegativeFinite(light.radius, 'light.radius')
    };
  } else if (light.kind === 'spot') {
    envelope = spotEnvelope(light);
  } else if (light.kind === 'projected' || light.kind === 'geometry') {
    envelope = geometryEnvelope(light);
  } else {
    throw new TypeError('light.kind must be point, spot, projected, or geometry');
  }
  return projectSphereBounds(envelope.position, envelope.radius, camera);
}
