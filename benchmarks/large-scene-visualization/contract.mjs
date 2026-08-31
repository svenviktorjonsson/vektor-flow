import { createHash } from 'node:crypto';

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256Json(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export function workloadContractSha256(workload) {
  return sha256Json(workload);
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
}

function exactSha(value, label) {
  if (!/^[0-9a-f]{64}$/.test(value ?? '')) throw new Error(`${label} must be a lowercase SHA-256`);
}

export function validateManifest(manifest) {
  if (manifest?.schema !== 'vkf.large-scene-visualization') throw new Error('invalid benchmark manifest schema');
  if (manifest.schemaVersion !== 1) throw new Error('unsupported benchmark manifest version');
  if (!Array.isArray(manifest.implementations) || manifest.implementations[0] !== 'vkf') {
    throw new Error('implementations must begin with vkf');
  }
  const implementations = new Set(manifest.implementations);
  if (implementations.size !== manifest.implementations.length) throw new Error('duplicate implementation id');
  const peerIds = manifest.peers?.map(({ id }) => id) ?? [];
  if (peerIds.length < 1 || peerIds.some((id) => !implementations.has(id))) {
    throw new Error('every peer must be a benchmark implementation');
  }
  for (const peer of manifest.peers) {
    requiredString(peer.id, 'peer id');
    requiredString(peer.package, `${peer.id} package`);
    requiredString(peer.version, `${peer.id} version`);
    requiredString(peer.officialSource, `${peer.id} official source`);
    requiredString(peer.adapterContract, `${peer.id} adapter contract`);
  }
  if (!Array.isArray(manifest.workloads) || manifest.workloads.length < 1) {
    throw new Error('at least one workload is required');
  }
  const workloadIds = new Set();
  for (const workload of manifest.workloads) {
    requiredString(workload.id, 'workload id');
    if (workloadIds.has(workload.id)) throw new Error(`duplicate workload ${workload.id}`);
    workloadIds.add(workload.id);
    positiveInteger(workload.pointCount, `${workload.id} point count`);
    if (workload.primitive !== 'screen-space circular point' || workload.projection !== 'orthographic') {
      throw new Error(`${workload.id} does not use the comparable point contract`);
    }
    if (workload.dataMutation !== 'none') {
      throw new Error(`${workload.id} must keep identical position buffers after setup`);
    }
    requiredString(workload.perFrameOperation, `${workload.id} per-frame operation`);
    const expectedCameraFormula = workload.cameraPath?.kind === 'fixed'
      ? 'offset=[0,0]'
      : workload.cameraPath?.kind === 'sinusoidal-pan'
        ? 'phase=2*pi*frame/frames; offset=[xAmplitude*sin(phase),yAmplitude*cos(phase)]'
        : null;
    if (!expectedCameraFormula || workload.cameraPath.formula !== expectedCameraFormula) {
      throw new Error(`${workload.id} camera path formula is invalid`);
    }
    if (!Array.isArray(workload.viewport) || workload.viewport.length !== 2
      || workload.viewport.some((value) => !Number.isSafeInteger(value) || value < 1)) {
      throw new Error(`${workload.id} viewport is invalid`);
    }
    if (workload.devicePixelRatio !== 1) throw new Error(`${workload.id} devicePixelRatio must be 1`);
    if (workload.fixture?.layout !== 'interleaved x,y float32 little-endian') {
      throw new Error(`${workload.id} fixture layout is invalid`);
    }
    exactSha(workload.fixture?.sha256, `${workload.id} fixture hash`);
    requiredString(workload.correctness?.oracle, `${workload.id} correctness oracle`);
    if (workload.correctness.reference !== 'ideal-disc-source-over-v1'
      || workload.correctness.subpixelsPerAxis !== 8) {
      throw new Error(`${workload.id} correctness reference is not reproducible`);
    }
    if (canonical(workload.correctness.regionChannels) !== canonical([
      'foreground-coverage',
      'premultiplied-r',
      'premultiplied-g',
      'premultiplied-b',
      'alpha',
    ])) {
      throw new Error(`${workload.id} correctness region channels are invalid`);
    }
    if (!(workload.correctness.maxRegionError >= 0 && workload.correctness.maxRegionError < 1)) {
      throw new Error(`${workload.id} correctness tolerance is invalid`);
    }
  }
  positiveInteger(manifest.measurement?.minimumWarmupFrames, 'minimum warmup frames');
  positiveInteger(manifest.measurement?.minimumMeasuredFrames, 'minimum measured frames');
  if (manifest.measurement.ratchetMetric !== 'steady-frame-ms'
    || manifest.measurement.statistic !== 'median') {
    throw new Error('0.4 ratchet must use median steady-frame-ms');
  }
  const gate040 = manifest.releaseGates?.['0.4.0'];
  if (gate040?.status !== 'active' || gate040.maxVkfToPeerRatioExclusive !== 1.5) {
    throw new Error('0.4 gate must be active and strictly below 1.5x');
  }
  const gate060 = manifest.releaseGates?.['0.6.0'];
  if (gate060?.status !== 'deferred' || gate060.maxVkfToPeerRatioExclusive !== 0.5) {
    throw new Error('0.6 target must remain deferred at strictly below 0.5x');
  }
  return true;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function validateEnvironment(environment, workload) {
  for (const field of ['operatingSystem', 'architecture', 'cpu', 'gpu', 'browser', 'browserVersion', 'powerMode']) {
    requiredString(environment?.[field], `environment ${field}`);
  }
  if (environment.devicePixelRatio !== workload.devicePixelRatio) {
    throw new Error(`${workload.id} devicePixelRatio differs from the manifest`);
  }
  if (canonical(environment.viewport) !== canonical(workload.viewport)) {
    throw new Error(`${workload.id} viewport differs from the manifest`);
  }
}

function validatePublished(manifest, workload, measurement) {
  if (measurement.comparable !== true) {
    throw new Error(`${measurement.implementation} published rows must be comparable`);
  }
  requiredString(measurement.versions?.implementation, `${measurement.implementation} version`);
  requiredString(measurement.versions?.harness, `${measurement.implementation} harness version`);
  const correctness = measurement.correctness;
  if (correctness?.passed !== true) throw new Error(`${measurement.implementation} correctness did not pass`);
  if (correctness.oracle !== workload.correctness.oracle) {
    throw new Error(`${measurement.implementation} correctness oracle differs from the workload`);
  }
  exactSha(correctness.artifactSha256, `${measurement.implementation} correctness artifact`);
  if (correctness.datasetSha256 !== workload.fixture.sha256) {
    throw new Error(`${measurement.implementation} dataset hash differs from the workload`);
  }
  if (correctness.workloadContractSha256 !== workloadContractSha256(workload)) {
    throw new Error(`${measurement.implementation} workload contract hash differs from the manifest`);
  }
  if (!Number.isFinite(correctness.maxRegionError)
    || correctness.maxRegionError > workload.correctness.maxRegionError
    || correctness.allowedRegionError !== workload.correctness.maxRegionError) {
    throw new Error(`${measurement.implementation} correctness region error exceeds the workload limit`);
  }
  const timing = measurement.timing;
  if (!(Number.isSafeInteger(correctness.completedAtSequence)
    && Number.isSafeInteger(timing?.startedAtSequence)
    && timing.startedAtSequence > correctness.completedAtSequence)) {
    throw new Error(`${measurement.implementation} timing started before correctness completed`);
  }
  if (timing.metric !== manifest.measurement.ratchetMetric) {
    throw new Error(`${measurement.implementation} timing metric is not comparable`);
  }
  if (!Array.isArray(timing.samplesMs)
    || timing.samplesMs.length < manifest.measurement.minimumMeasuredFrames
    || timing.samplesMs.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error(`${measurement.implementation} has insufficient finite positive timing samples`);
  }
  return median(timing.samplesMs);
}

export function evaluateReport(manifest, report) {
  validateManifest(manifest);
  if (report?.schema !== 'vkf.large-scene-visualization-report' || report.schemaVersion !== 1) {
    throw new Error('invalid benchmark report schema');
  }
  if (report.manifestSha256 !== sha256Json(manifest)) throw new Error('report manifest hash differs');
  if (!Array.isArray(report.workloads)) throw new Error('report workloads must be an array');
  const gate = { release: '0.4.0', ...manifest.releaseGates['0.4.0'] };
  const workloadMap = new Map(manifest.workloads.map((workload) => [workload.id, workload]));
  const knownImplementations = new Set(manifest.implementations);
  const seenWorkloads = new Set();
  const rows = [];
  let publishedCount = 0;
  for (const workloadReport of report.workloads) {
    const workload = workloadMap.get(workloadReport.id);
    if (!workload) throw new Error(`unknown workload ${workloadReport.id}`);
    if (seenWorkloads.has(workload.id)) throw new Error(`duplicate report workload ${workload.id}`);
    seenWorkloads.add(workload.id);
    validateEnvironment(report.environment, workload);
    if (!Array.isArray(workloadReport.measurements)) throw new Error(`${workload.id} measurements must be an array`);
    const measurements = new Map();
    const medians = new Map();
    for (const measurement of workloadReport.measurements) {
      if (!knownImplementations.has(measurement.implementation)) {
        throw new Error(`${workload.id} has unknown implementation ${measurement.implementation}`);
      }
      if (measurements.has(measurement.implementation)) {
        throw new Error(`${workload.id} repeats ${measurement.implementation}`);
      }
      measurements.set(measurement.implementation, measurement);
      if (measurement.state === 'scaffold') {
        if (measurement.timing || measurement.correctness) {
          throw new Error(`${measurement.implementation} scaffold must not contain measured evidence`);
        }
        continue;
      }
      if (measurement.state !== 'published') {
        throw new Error(`${measurement.implementation} state must be scaffold or published`);
      }
      medians.set(measurement.implementation, validatePublished(manifest, workload, measurement));
      publishedCount += 1;
    }
    if (medians.size > 0 && !medians.has('vkf')) throw new Error(`${workload.id} has peer timing without VKF timing`);
    if (medians.size === 1 && medians.has('vkf')) {
      throw new Error(`${workload.id} has VKF timing without a peer comparison`);
    }
    if (medians.size > 0 && medians.size !== manifest.implementations.length) {
      throw new Error(
        `${workload.id} must publish ${manifest.implementations.join(', ')} together`,
      );
    }
    const vkfMedianMs = medians.get('vkf');
    if (vkfMedianMs !== undefined) {
      for (const peer of manifest.peers) {
        const peerMedianMs = medians.get(peer.id);
        if (peerMedianMs === undefined) continue;
        const ratio = vkfMedianMs / peerMedianMs;
        if (!(ratio < gate.maxVkfToPeerRatioExclusive)) {
          throw new Error(
            `${workload.id}/${peer.id} ratio ${ratio.toFixed(3)} must be below ${gate.maxVkfToPeerRatioExclusive.toFixed(3)}`,
          );
        }
        rows.push({
          workload: workload.id,
          peer: peer.id,
          metric: manifest.measurement.ratchetMetric,
          statistic: manifest.measurement.statistic,
          vkfMedianMs,
          peerMedianMs,
          ratio,
        });
      }
    }
  }
  const hasPublishedClaims = publishedCount > 0;
  if (hasPublishedClaims && seenWorkloads.size !== manifest.workloads.length) {
    throw new Error('measured reports must include every frozen workload');
  }
  if (hasPublishedClaims && report.status !== 'measured') throw new Error('published rows require measured report status');
  if (!hasPublishedClaims && report.status !== 'scaffold') throw new Error('unmeasured reports must be scaffold status');
  return { gate, hasPublishedClaims, rows };
}
