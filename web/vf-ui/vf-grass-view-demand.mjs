const MAX_CELL_BUDGET = 4096;
const MAX_BLADE_BUDGET = 65536;
const MAX_SCAN_CELLS = 65536;
const MIN_CELL = -2_000_000_000;
const MAX_CELL = 2_000_000_000;

function subtract(first, second) {
  return first.map((value, axis) => value - second[axis]);
}

function addScaled(first, second, scale) {
  return first.map((value, axis) => value + second[axis] * scale);
}

function dot(first, second) {
  return first.reduce((sum, value, axis) => sum + value * second[axis], 0);
}

function cross(first, second) {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

function normalize(vector) {
  const length = Math.sqrt(dot(vector, vector));
  return vector.map((value) => value / length);
}

function requireVector3(value, name) {
  const typed = ArrayBuffer.isView(value) && !(value instanceof DataView);
  if ((!Array.isArray(value) && !typed) || value.length !== 3) {
    throw new TypeError(`${name} must contain exactly three numbers`);
  }
  for (let axis = 0; axis < 3; axis += 1) {
    if (typeof value[axis] !== 'number') {
      throw new TypeError(`${name}[${axis}] must be a number`);
    }
    if (!Number.isFinite(value[axis])) {
      throw new RangeError(`${name}[${axis}] must be finite`);
    }
  }
}

function requirePositiveNumber(value, name) {
  if (typeof value !== 'number') {
    throw new TypeError(`${name} must be a number`);
  }
  if (!Number.isFinite(value) || !(value > 0)) {
    throw new RangeError(`${name} must be finite and positive`);
  }
}

function requireCamera(camera) {
  if (!camera || typeof camera !== 'object') {
    throw new TypeError('grass view camera is required');
  }
  requireVector3(camera.eye, 'grass view camera eye');
  requireVector3(camera.target, 'grass view camera target');
  requireVector3(camera.up, 'grass view camera up');
  requirePositiveNumber(camera.viewportWidth, 'grass view viewport width');
  requirePositiveNumber(camera.viewportHeight, 'grass view viewport height');
  if (camera.maximumDistance != null) {
    requirePositiveNumber(camera.maximumDistance, 'grass view maximum distance');
  }
  if (
    typeof camera.verticalFovRadians !== 'number'
    || !Number.isFinite(camera.verticalFovRadians)
    || !(camera.verticalFovRadians > 0)
    || !(camera.verticalFovRadians < Math.PI)
  ) {
    throw new RangeError('grass view vertical FOV must be between 0 and pi');
  }
  const forward = subtract(camera.target, camera.eye);
  if (!(dot(forward, forward) > 0)) {
    throw new RangeError('grass view camera eye and target must differ');
  }
  if (!(dot(cross(forward, camera.up), cross(forward, camera.up)) > 1e-24)) {
    throw new RangeError('grass view camera up must not be parallel to its view');
  }
}

function requireBudget(value, name, maximum) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`${name} must be an integer from 0 to ${maximum}`);
  }
}

function cameraBasis(camera) {
  const forward = normalize(subtract(camera.target, camera.eye));
  const right = normalize(cross(forward, camera.up));
  const up = cross(right, forward);
  const tangent = Math.tan(camera.verticalFovRadians / 2);
  return {
    forward,
    right,
    up,
    tangent,
    aspect: camera.viewportWidth / camera.viewportHeight,
    focalPixels: camera.viewportHeight / (2 * tangent),
  };
}

function boundedPlaneIntersection(camera, direction, planeZ, maximumDistance) {
  const distance = Math.abs(direction[2]) <= 1e-12
    ? Infinity
    : (planeZ - camera.eye[2]) / direction[2];
  if (distance > 0 && Number.isFinite(distance) && distance <= maximumDistance) {
    return Object.freeze({
      point: addScaled(camera.eye, direction, distance),
      farClipped: false,
    });
  }
  if (Number.isFinite(maximumDistance)) {
    return Object.freeze({
      point: addScaled(camera.eye, direction, maximumDistance),
      farClipped: true,
    });
  }
  if (Math.abs(direction[2]) <= 1e-12) {
    throw new RangeError('grass view frustum must not be parallel to the grass plane');
  }
  throw new RangeError('grass view frustum must face the grass plane');
}

function viewRay(basis, x, y) {
  return normalize([
    basis.forward[0]
      + basis.right[0] * x * basis.tangent * basis.aspect
      + basis.up[0] * y * basis.tangent,
    basis.forward[1]
      + basis.right[1] * x * basis.tangent * basis.aspect
      + basis.up[1] * y * basis.tangent,
    basis.forward[2]
      + basis.right[2] * x * basis.tangent * basis.aspect
      + basis.up[2] * y * basis.tangent,
  ]);
}

function projectedInterval(points, axis) {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const point of points) {
    const projection = point[0] * axis[0] + point[1] * axis[1];
    minimum = Math.min(minimum, projection);
    maximum = Math.max(maximum, projection);
  }
  return [minimum, maximum];
}

function cellIntersectsFootprint(cellX, cellY, footprint) {
  const cell = [
    [cellX, cellY],
    [cellX + 1, cellY],
    [cellX + 1, cellY + 1],
    [cellX, cellY + 1],
  ];
  const axes = [[1, 0], [0, 1]];
  for (let index = 0; index < footprint.length; index += 1) {
    const first = footprint[index];
    const second = footprint[(index + 1) % footprint.length];
    const edgeX = second[0] - first[0];
    const edgeY = second[1] - first[1];
    const length = Math.hypot(edgeX, edgeY);
    axes.push([-edgeY / length, edgeX / length]);
  }
  for (const axis of axes) {
    const [footprintMinimum, footprintMaximum] = projectedInterval(footprint, axis);
    const [cellMinimum, cellMaximum] = projectedInterval(cell, axis);
    if (cellMaximum < footprintMinimum || footprintMaximum < cellMinimum) {
      return false;
    }
  }
  return true;
}

function ringCells(centerX, centerY, radius) {
  if (radius === 0) return [[centerX, centerY]];
  const cells = [];
  for (let x = centerX - radius; x <= centerX + radius; x += 1) {
    cells.push([x, centerY - radius], [x, centerY + radius]);
  }
  for (let y = centerY - radius + 1; y < centerY + radius; y += 1) {
    cells.push([centerX - radius, y], [centerX + radius, y]);
  }
  return cells;
}

function binaryCellCompare(first, second) {
  return first[0] - second[0] || first[1] - second[1];
}

export function selectGrassViewDemandReference({
  camera,
  planeZ,
  cellBudget,
  bladeBudget,
}) {
  requireCamera(camera);
  if (typeof planeZ !== 'number' || !Number.isFinite(planeZ)) {
    throw new RangeError('grass view planeZ must be finite');
  }
  requireBudget(cellBudget, 'grass view cellBudget', MAX_CELL_BUDGET);
  requireBudget(bladeBudget, 'grass view bladeBudget', MAX_BLADE_BUDGET);
  const basis = cameraBasis(camera);
  const maximumDistance = camera.maximumDistance ?? Infinity;
  const cornerIntersections = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, y]) => boundedPlaneIntersection(
    camera,
    viewRay(basis, x, y),
    planeZ,
    maximumDistance,
  ));
  const footprint = cornerIntersections.map(({ point }) => point.slice(0, 2));
  const centerIntersection = boundedPlaneIntersection(
    camera,
    basis.forward,
    planeZ,
    maximumDistance,
  );
  const centerPoint = centerIntersection.point;
  const minimumX = Math.min(...footprint.map(([x]) => x));
  const maximumX = Math.max(...footprint.map(([x]) => x));
  const minimumY = Math.min(...footprint.map(([, y]) => y));
  const maximumY = Math.max(...footprint.map(([, y]) => y));
  const minimumCellX = Math.floor(minimumX);
  const maximumCellX = Math.floor(maximumX);
  const minimumCellY = Math.floor(minimumY);
  const maximumCellY = Math.floor(maximumY);
  if (
    minimumCellX < MIN_CELL
    || maximumCellX > MAX_CELL
    || minimumCellY < MIN_CELL
    || maximumCellY > MAX_CELL
  ) {
    throw new RangeError('grass view footprint exceeds the bounded field');
  }
  const width = maximumCellX - minimumCellX + 1;
  const height = maximumCellY - minimumCellY + 1;
  const canScanAll = width <= MAX_SCAN_CELLS
    && height <= Math.floor(MAX_SCAN_CELLS / width);
  const selected = [];
  let intersectingCount = 0;
  let scannedCellCount = 0;
  if (cellBudget > 0 && canScanAll) {
    const candidates = [];
    for (let x = minimumCellX; x <= maximumCellX; x += 1) {
      for (let y = minimumCellY; y <= maximumCellY; y += 1) {
        scannedCellCount += 1;
        if (cellIntersectsFootprint(x, y, footprint)) {
          candidates.push([x, y]);
        }
      }
    }
    intersectingCount = candidates.length;
    candidates.sort((first, second) => (
      Math.hypot(first[0] + 0.5 - centerPoint[0], first[1] + 0.5 - centerPoint[1])
      - Math.hypot(second[0] + 0.5 - centerPoint[0], second[1] + 0.5 - centerPoint[1])
      || binaryCellCompare(first, second)
    ));
    selected.push(...candidates.slice(0, cellBudget));
  } else if (cellBudget > 0) {
    const centerCellX = Math.floor(centerPoint[0]);
    const centerCellY = Math.floor(centerPoint[1]);
    let scanned = 0;
    for (let radius = 0; selected.length < cellBudget && scanned < MAX_SCAN_CELLS; radius += 1) {
      for (const [x, y] of ringCells(centerCellX, centerCellY, radius)) {
        scanned += 1;
        if (scanned > MAX_SCAN_CELLS) break;
        if (
          x >= minimumCellX
          && x <= maximumCellX
          && y >= minimumCellY
          && y <= maximumCellY
          && cellIntersectsFootprint(x, y, footprint)
        ) {
          selected.push([x, y]);
          if (selected.length >= cellBudget) break;
        }
      }
    }
    scannedCellCount = scanned;
    intersectingCount = selected.length + 1;
  }
  selected.sort(binaryCellCompare);
  const centerDepth = dot(subtract(centerPoint, camera.eye), basis.forward);
  const pixelsPerCell = basis.focalPixels / centerDepth;
  const detailLevel = Math.max(0, Math.min(4, Math.ceil(
    Math.log2(Math.max(1, pixelsPerCell / 8)),
  )));
  return Object.freeze({
    kind: 'grass-view-demand:v1',
    cells: Object.freeze(selected.map((cell) => Object.freeze(cell))),
    detailLevel,
    footprint: 1 / pixelsPerCell,
    bladeBudget,
    cellBudget,
    scannedCellCount,
    truncated: !canScanAll || intersectingCount > cellBudget,
    farClipped: centerIntersection.farClipped
      || cornerIntersections.some(({ farClipped }) => farClipped),
    maximumDistance: Number.isFinite(maximumDistance) ? maximumDistance : null,
  });
}
