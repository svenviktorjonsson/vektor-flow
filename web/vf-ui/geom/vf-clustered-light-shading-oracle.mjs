function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveViewDepth(worldPosition, cameraPosition, cameraForward) {
  const dx = finite(worldPosition?.[0]) - finite(cameraPosition?.[0]);
  const dy = finite(worldPosition?.[1]) - finite(cameraPosition?.[1]);
  const dz = finite(worldPosition?.[2]) - finite(cameraPosition?.[2]);
  return (dx * finite(cameraForward?.[0])) +
    (dy * finite(cameraForward?.[1])) +
    (dz * finite(cameraForward?.[2], 1));
}

function sliceCoordinate(value, minimum, maximum, count) {
  const normalized = (value - minimum) / (maximum - minimum);
  return Math.min(count - 1, Math.max(0, Math.floor(normalized * count)));
}

export function clusterIndexForReceiver({
  ndc,
  worldPosition,
  cameraPosition,
  cameraForward,
  grid
}) {
  const xSlices = Math.max(1, finite(grid?.xSlices, 1) | 0);
  const ySlices = Math.max(1, finite(grid?.ySlices, 1) | 0);
  const depthSlices = Math.max(1, finite(grid?.depthSlices, 1) | 0);
  const nearDepth = Math.max(Number.EPSILON, finite(grid?.nearDepth, 0.05));
  const farDepth = Math.max(nearDepth + Number.EPSILON, finite(grid?.farDepth, 500));
  const x = sliceCoordinate(finite(ndc?.[0]), -1, 1, xSlices);
  const y = sliceCoordinate(finite(ndc?.[1]), -1, 1, ySlices);
  const viewDepth = Math.min(farDepth, Math.max(nearDepth,
    positiveViewDepth(worldPosition, cameraPosition, cameraForward)));
  const logarithmicDepth = Math.log(viewDepth / nearDepth) / Math.log(farDepth / nearDepth);
  const z = Math.min(depthSlices - 1, Math.max(0, Math.floor(logarithmicDepth * depthSlices)));
  return ((z * ySlices) + y) * xSlices + x;
}
