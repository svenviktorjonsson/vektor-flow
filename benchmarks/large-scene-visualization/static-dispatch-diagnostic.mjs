export const STATIC_DISPATCH_PROTOCOL = Object.freeze({
  sourceWorkload: 'orthographic-points-1m-pan',
  workload: 'orthographic-points-1m-static-dispatch',
  warmupSamples: 60,
  measuredSamples: 100,
  measuredOperation: 'one real retained draw plus one explicit GPU completion',
});

export function staticDispatchWorkload(source, implementations) {
  if (source?.id !== STATIC_DISPATCH_PROTOCOL.sourceWorkload || source.pointCount !== 1_000_000) {
    throw new Error('static dispatch diagnostic requires the frozen one-million-point source workload');
  }
  return Object.freeze({
    ...source,
    id: STATIC_DISPATCH_PROTOCOL.workload,
    dataMutation: 'none',
    perFrameOperation: 'none; fixed retained dispatch',
    comparableImplementations: [...implementations],
    nonComparableImplementations: [],
    cameraPath: {
      kind: 'fixed',
      frames: 1,
      formula: 'offset=[0,0]',
      xRange: [...source.cameraPath.xRange],
      yRange: [...source.cameraPath.yRange],
    },
    correctness: {
      ...source.correctness,
      checkpoints: [0],
    },
  });
}

export function staticDispatchRotatedOrder(manifest) {
  const sourceIndex = manifest.workloads.findIndex(
    ({ id }) => id === STATIC_DISPATCH_PROTOCOL.sourceWorkload,
  );
  if (sourceIndex < 0) throw new Error('static dispatch source workload is missing');
  return manifest.implementations.map((_, index) => (
    manifest.implementations[(index + sourceIndex) % manifest.implementations.length]
  ));
}
