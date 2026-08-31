import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeFixture } from './materialize-fixture.mjs';

const benchmarkRoot = dirname(fileURLToPath(import.meta.url));
const contractPath = join(benchmarkRoot, 'contract.json');
const sourcePath = join(benchmarkRoot, 'programs', 'project-transform-reduce.vkf');
const polarsSourcePath = join(
  benchmarkRoot,
  'programs',
  'project-transform-reduce-polars.py',
);
const duckdbSourcePath = join(
  benchmarkRoot,
  'programs',
  'project-transform-reduce-duckdb.py',
);
const repositoryRoot = resolve(benchmarkRoot, '../..');

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function canonicalTextSha256(text) {
  const canonical = String(text).replace(/\r\n?/g, '\n');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function sha256TextFile(path) {
  return canonicalTextSha256(readFileSync(path, 'utf8'));
}

export function loadContract(path = contractPath) {
  const contract = JSON.parse(readFileSync(path, 'utf8'));
  if (contract.schema_version !== 1 || contract.status !== 'non_gating') {
    throw new Error('unsupported lazy-data comparison contract');
  }
  return Object.freeze(contract);
}

export function availabilityReport(runners, contract = loadContract()) {
  const peers = {};
  for (const peer of contract.peer_set.members) {
    const runner = runners[peer];
    if (!runner) {
      peers[peer] = { status: 'UNAVAILABLE', reason: 'runner not provided' };
    } else if (!existsSync(runner) || !statSync(runner).isFile()) {
      peers[peer] = { status: 'UNAVAILABLE', reason: 'runner path does not exist' };
    } else {
      peers[peer] = { status: 'AVAILABLE', runner, runner_sha256: sha256File(runner) };
    }
  }
  return Object.freeze({
    schema_version: 1,
    status: 'not_measured',
    non_gating: true,
    peers: Object.freeze(peers),
    samples: Object.freeze([]),
    comparisons: Object.freeze([]),
  });
}

export function validateCandidateSamples(samples, fixtureManifest, contract = loadContract()) {
  if (!Array.isArray(samples)) throw new Error('raw samples must be an array');
  const fields = contract.measurement.required_raw_sample_fields;
  for (const sample of samples) {
    for (const field of fields) {
      if (!Object.hasOwn(sample, field)) throw new Error(`missing raw sample field ${field}`);
    }
    if (!contract.peer_set.members.includes(sample.peer)) {
      throw new Error(`unknown sample peer ${sample.peer}`);
    }
    if (!Object.hasOwn(contract.boundaries, sample.boundary)) {
      throw new Error(`unknown sample boundary ${sample.boundary}`);
    }
    if (!Number.isSafeInteger(sample.round) || sample.round < 0 ||
        !Number.isSafeInteger(sample.order) || sample.order < 0) {
      throw new Error('sample round and order must be nonnegative safe integers');
    }
    if (!Number.isFinite(sample.elapsed_wall_ms) || sample.elapsed_wall_ms < 0) {
      throw new Error('invalid elapsed_wall_ms');
    }
    if (sample.status !== 'OK') throw new Error(`sample status is ${sample.status}`);
    if (sample.result !== fixtureManifest.expected_sum) {
      throw new Error(
        `${sample.peer}/${sample.boundary} result mismatch: ` +
        `${sample.result}; expected ${fixtureManifest.expected_sum}`,
      );
    }
  }
  return samples;
}

function runSampleProcess({ specification, boundary, phase, cwd, timeoutMs, expected }) {
  const started = performance.now();
  const executed = spawnSync(
    specification.command,
    specification.args ?? [],
    {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...specification.env,
        VKF_BENCHMARK_BOUNDARY: boundary,
        VKF_BENCHMARK_PHASE: phase,
      },
      timeout: timeoutMs,
      windowsHide: true,
    },
  );
  const rendered = String(executed.stdout ?? '').trim();
  const result = rendered === '' ? null : Number(rendered);
  const elapsedWallMs = performance.now() - started;
  if (executed.error?.code === 'ETIMEDOUT') {
    return Object.freeze({ status: 'TIMEOUT', result: null, elapsed_wall_ms: elapsedWallMs });
  }
  if (executed.error || executed.status !== 0) {
    return Object.freeze({ status: 'ERROR', result, elapsed_wall_ms: elapsedWallMs });
  }
  if (!Number.isFinite(result) || result !== expected) {
    return Object.freeze({ status: 'ORACLE_MISMATCH', result, elapsed_wall_ms: elapsedWallMs });
  }
  return Object.freeze({ status: 'OK', result, elapsed_wall_ms: elapsedWallMs });
}

export function collectPairedSamples({
  peers,
  fixtureManifest,
  rounds,
  timeoutMs,
  preparationTimeoutMs = 60_000,
  workRoot,
}) {
  if (!Number.isSafeInteger(rounds) || rounds < 1) throw new Error('rounds must be positive');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('timeoutMs must be a positive safe integer');
  }
  if (!Number.isSafeInteger(preparationTimeoutMs) || preparationTimeoutMs < 1) {
    throw new Error('preparationTimeoutMs must be a positive safe integer');
  }
  const peerNames = Object.keys(peers);
  if (peerNames.length === 0) throw new Error('at least one sampling peer is required');
  mkdirSync(workRoot, { recursive: true });
  const warmRoots = Object.fromEntries(peerNames.map((peer) => {
    const root = join(workRoot, 'warm', peer);
    mkdirSync(root, { recursive: true });
    return [peer, root];
  }));
  for (const peer of peerNames) {
    const prepared = runSampleProcess({
      specification: peers[peer],
      boundary: 'warm_source_e2e',
      phase: 'preparation',
      cwd: warmRoots[peer],
      timeoutMs: preparationTimeoutMs,
      expected: fixtureManifest.expected_sum,
    });
    if (prepared.status !== 'OK') {
      throw new Error(`${peer} warm preparation failed: ${prepared.status}`);
    }
  }

  const samples = [];
  for (let round = 0; round < rounds; ++round) {
    const rotated = peerNames.map((_, index) => peerNames[(round + index) % peerNames.length]);
    for (const boundary of ['fresh_source_e2e', 'warm_source_e2e']) {
      for (let order = 0; order < rotated.length; ++order) {
        const peer = rotated[order];
        const cwd = boundary === 'fresh_source_e2e'
          ? mkdtempSync(join(workRoot, `fresh-${round}-${peer}-`))
          : warmRoots[peer];
        const observed = runSampleProcess({
          specification: peers[peer],
          boundary,
          phase: 'sample',
          cwd,
          timeoutMs,
          expected: fixtureManifest.expected_sum,
        });
        samples.push(Object.freeze({ peer, boundary, round, order, ...observed }));
      }
    }
  }
  return Object.freeze(samples);
}

function vkfSourceForFixture(fixturePath) {
  const template = readFileSync(sourcePath, 'utf8');
  const marker = '"fixture.csv"';
  if (template.split(marker).length !== 2) {
    throw new Error('VKF benchmark source must contain exactly one fixture marker');
  }
  const escaped = resolve(fixturePath).replaceAll('\\', '/').replaceAll('"', '\\"');
  return template.replace(marker, `"${escaped}"`);
}

export function verifyVkfRunner({ runner, fixturePath, fixtureManifest, workRoot }) {
  const resolvedRunner = resolve(runner);
  const identity = {
    runner: resolvedRunner,
    runner_sha256: sha256File(resolvedRunner),
    source_sha256: sha256TextFile(sourcePath),
  };
  const runnerWork = resolve(workRoot);
  mkdirSync(runnerWork, { recursive: true });
  const generatedSource = join(runnerWork, 'project-transform-reduce.vkf');
  const artifact = join(
    runnerWork,
    `project-transform-reduce${process.platform === 'win32' ? '.exe' : ''}`,
  );
  writeFileSync(generatedSource, vkfSourceForFixture(fixturePath), 'utf8');

  const compiled = spawnSync(
    resolvedRunner,
    ['-b', generatedSource, '-o', artifact, '--diagnostics'],
    { cwd: repositoryRoot, encoding: 'utf8', timeout: 60_000, windowsHide: true },
  );
  if (compiled.error || compiled.status !== 0 || !existsSync(artifact)) {
    return Object.freeze({
      status: 'UNAVAILABLE',
      reason: compiled.error ? 'VKF compiler could not start' : 'VKF public lazy CSV compilation failed',
      ...identity,
    });
  }

  const executed = spawnSync(
    artifact,
    [],
    { cwd: runnerWork, encoding: 'utf8', timeout: 60_000, windowsHide: true },
  );
  if (executed.error || executed.status !== 0) {
    return Object.freeze({
      status: 'UNAVAILABLE',
      reason: executed.error ? 'VKF artifact could not start' : 'VKF public lazy CSV execution failed',
      ...identity,
    });
  }
  const rendered = String(executed.stdout || '').trim();
  const result = Number(rendered);
  if (!rendered || !Number.isFinite(result) || result !== fixtureManifest.expected_sum) {
    return Object.freeze({
      status: 'UNAVAILABLE',
      reason: `correctness oracle mismatch: ${rendered || '<empty>'}`,
      ...identity,
    });
  }
  return Object.freeze({ status: 'AVAILABLE', ...identity, result });
}

export function verifyPolarsRunner({
  runner,
  fixturePath,
  fixtureManifest,
  requirement,
  threads,
}) {
  const resolvedRunner = resolve(runner);
  const identity = {
    runner: resolvedRunner,
    runner_sha256: sha256File(resolvedRunner),
    source_sha256: sha256TextFile(polarsSourcePath),
  };
  const executed = spawnSync(
    resolvedRunner,
    [polarsSourcePath, resolve(fixturePath)],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: { ...process.env, POLARS_MAX_THREADS: String(threads) },
      timeout: 60_000,
      windowsHide: true,
    },
  );
  if (executed.error || executed.status !== 0) {
    return Object.freeze({
      status: 'UNAVAILABLE',
      reason: executed.error ? 'Polars runner could not start' : 'Polars lazy execution failed',
      ...identity,
    });
  }

  let observed;
  try {
    observed = JSON.parse(String(executed.stdout || '').trim());
  } catch {
    return Object.freeze({
      status: 'UNAVAILABLE',
      reason: 'Polars runner returned malformed output',
      ...identity,
    });
  }
  if (!observed || Array.isArray(observed) || typeof observed !== 'object') {
    return Object.freeze({
      status: 'UNAVAILABLE',
      reason: 'Polars runner returned malformed output',
      ...identity,
    });
  }
  if (observed.peer_version !== requirement?.version) {
    return Object.freeze({
      status: 'UNAVAILABLE',
      reason: `incompatible Polars version: ${observed.peer_version ?? '<missing>'}`,
      ...identity,
    });
  }
  if (!/^[0-9a-f]{64}$/.test(observed.dependency_sha256 ?? '')) {
    return Object.freeze({
      status: 'UNAVAILABLE',
      reason: 'Polars dependency hash is missing or malformed',
      ...identity,
    });
  }
  if (observed.threads !== threads) {
    return Object.freeze({
      status: 'UNAVAILABLE',
      reason: `Polars thread contract mismatch: ${observed.threads ?? '<missing>'}`,
      ...identity,
    });
  }
  if (!Number.isFinite(observed.result) || observed.result !== fixtureManifest.expected_sum) {
    return Object.freeze({
      status: 'UNAVAILABLE',
      reason: `correctness oracle mismatch: ${observed.result ?? '<missing>'}`,
      ...identity,
      peer_version: observed.peer_version,
      dependency_sha256: observed.dependency_sha256,
    });
  }
  return Object.freeze({
    status: 'AVAILABLE',
    ...identity,
    peer_version: observed.peer_version,
    dependency_sha256: observed.dependency_sha256,
    threads: observed.threads,
    result: observed.result,
  });
}

export function verifyDuckdbRunner({
  runner,
  fixturePath,
  fixtureManifest,
  requirement,
  threads,
}) {
  const resolvedRunner = resolve(runner);
  const identity = {
    runner: resolvedRunner,
    runner_sha256: sha256File(resolvedRunner),
    source_sha256: sha256TextFile(duckdbSourcePath),
  };
  const executed = spawnSync(
    resolvedRunner,
    [duckdbSourcePath, resolve(fixturePath), String(threads)],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: { ...process.env, PYTHONUTF8: '1' },
      timeout: 60_000,
      windowsHide: true,
    },
  );
  if (executed.error || executed.status !== 0) {
    return Object.freeze({
      status: 'UNAVAILABLE',
      reason: executed.error ? 'DuckDB runner could not start' : 'DuckDB CSV execution failed',
      ...identity,
    });
  }

  let observed;
  try {
    observed = JSON.parse(String(executed.stdout || '').trim());
  } catch {
    return Object.freeze({
      status: 'UNAVAILABLE',
      reason: 'DuckDB runner returned malformed output',
      ...identity,
    });
  }
  if (!observed || Array.isArray(observed) || typeof observed !== 'object') {
    return Object.freeze({
      status: 'UNAVAILABLE',
      reason: 'DuckDB runner returned malformed output',
      ...identity,
    });
  }
  if (observed.peer_version !== requirement?.version) {
    return Object.freeze({
      status: 'UNAVAILABLE',
      reason: `incompatible DuckDB version: ${observed.peer_version ?? '<missing>'}`,
      ...identity,
    });
  }
  if (!/^[0-9a-f]{64}$/.test(observed.distribution_sha256 ?? '')) {
    return Object.freeze({
      status: 'UNAVAILABLE',
      reason: 'DuckDB distribution hash is missing or malformed',
      ...identity,
    });
  }
  if (observed.threads !== threads) {
    return Object.freeze({
      status: 'UNAVAILABLE',
      reason: `DuckDB thread contract mismatch: ${observed.threads ?? '<missing>'}`,
      ...identity,
    });
  }
  if (JSON.stringify(observed.projected_columns) !== JSON.stringify(['x', 'y'])) {
    return Object.freeze({
      status: 'UNAVAILABLE',
      reason: 'DuckDB plan did not prove exact x/y CSV projection',
      ...identity,
    });
  }
  if (!Number.isFinite(observed.result) || observed.result !== fixtureManifest.expected_sum) {
    return Object.freeze({
      status: 'UNAVAILABLE',
      reason: `correctness oracle mismatch: ${observed.result ?? '<missing>'}`,
      ...identity,
      peer_version: observed.peer_version,
      distribution_sha256: observed.distribution_sha256,
    });
  }
  return Object.freeze({
    status: 'AVAILABLE',
    ...identity,
    peer_version: observed.peer_version,
    distribution_sha256: observed.distribution_sha256,
    threads: observed.threads,
    projected_columns: Object.freeze([...observed.projected_columns]),
    result: observed.result,
  });
}

const readinessVerifiers = Object.freeze({
  vkf: verifyVkfRunner,
  polars: verifyPolarsRunner,
  duckdb: verifyDuckdbRunner,
});

export function buildReadinessReceipt({
  fixturePath,
  fixtureManifest,
  runners,
  revision,
  workRoot = join(dirname(fixturePath), 'runner-work'),
}) {
  const fixtureHash = sha256File(fixturePath);
  if (fixtureHash !== fixtureManifest.sha256) {
    throw new Error(`fixture SHA-256 changed: ${fixtureHash}; expected ${fixtureManifest.sha256}`);
  }
  const contract = loadContract();
  const availability = availabilityReport(runners, contract);
  const peers = { ...availability.peers };
  for (const peer of contract.peer_set.members) {
    if (peers[peer]?.status !== 'AVAILABLE') continue;
    const verifier = readinessVerifiers[peer];
    if (!verifier) {
      peers[peer] = Object.freeze({
        ...peers[peer],
        status: 'UNAVAILABLE',
        reason: 'correctness verifier not implemented',
      });
      continue;
    }
    peers[peer] = verifier({
      runner: runners[peer],
      fixturePath,
      fixtureManifest,
      workRoot: join(workRoot, peer),
      requirement: contract.peer_set.requirements?.[peer],
      threads: contract.workload.threads,
    });
  }
  return Object.freeze({
    ...availability,
    peers: Object.freeze(peers),
    contract_schema_version: contract.schema_version,
    workload: contract.workload.id,
    fixture: fixtureManifest,
    provenance: Object.freeze({
      revision,
      contract_sha256: sha256TextFile(contractPath),
      fixture_sha256: fixtureHash,
      source_sha256: sha256TextFile(sourcePath),
      runner_sha256: Object.fromEntries(contract.peer_set.members.map((peer) => [
        peer,
        peers[peer].runner_sha256 ?? null,
      ])),
      os: `${platform()} ${release()}`,
      architecture: arch(),
      cpu: cpus()[0]?.model ?? 'unknown',
      logical_cpus: cpus().length,
      memory_bytes: totalmem(),
      runtime_version: process.version,
      peer_version: null,
      threads: contract.workload.threads,
      os_cache: 'uncontrolled_reported',
    }),
  });
}

export function buildSamplingReceipt({
  fixturePath,
  fixtureManifest,
  runners,
  revision,
  rounds,
  timeoutMs,
  workRoot = join(dirname(fixturePath), 'runner-work'),
}) {
  const readinessWorkRoot = join(workRoot, 'readiness');
  const readiness = buildReadinessReceipt({
    fixturePath,
    fixtureManifest,
    runners,
    revision,
    workRoot: readinessWorkRoot,
  });
  const peerOrder = ['vkf', 'polars', 'duckdb'];
  const unavailable = peerOrder.find((peer) => readiness.peers[peer]?.status !== 'AVAILABLE');
  if (unavailable) {
    throw new Error(`${unavailable} is not ready for paired sampling`);
  }
  const vkfArtifact = join(
    readinessWorkRoot,
    'vkf',
    `project-transform-reduce${process.platform === 'win32' ? '.exe' : ''}`,
  );
  if (!existsSync(vkfArtifact)) throw new Error('verified VKF sampling artifact is missing');
  const peers = {
    vkf: Object.freeze({ command: vkfArtifact }),
    polars: Object.freeze({
      command: resolve(runners.polars),
      args: [polarsSourcePath, resolve(fixturePath), '--sample'],
      env: {
        POLARS_MAX_THREADS: String(loadContract().workload.threads),
        PYTHONDONTWRITEBYTECODE: '1',
      },
    }),
    duckdb: Object.freeze({
      command: resolve(runners.duckdb),
      args: [
        duckdbSourcePath,
        resolve(fixturePath),
        String(loadContract().workload.threads),
        '--sample',
      ],
      env: { PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1' },
    }),
  };
  const samples = collectPairedSamples({
    peers,
    fixtureManifest,
    rounds,
    timeoutMs,
    workRoot: join(workRoot, 'samples'),
  });
  return Object.freeze({
    ...readiness,
    status: 'sampled_non_gating',
    samples,
    comparisons: Object.freeze([]),
    provenance: Object.freeze({
      ...readiness.provenance,
      peer_version: Object.freeze({
        vkf: null,
        polars: readiness.peers.polars.peer_version,
        duckdb: readiness.peers.duckdb.peer_version,
      }),
    }),
    sampling: Object.freeze({
      rounds,
      timeout_ms: timeoutMs,
      peer_order: Object.freeze(peerOrder),
      order: 'paired_rotating_same_host',
      outliers: 'retain_all',
      os_cache: 'uncontrolled_reported',
    }),
  });
}

function parseArguments(argv) {
  const peers = loadContract().peer_set.members;
  const allowed = new Set([
    'fixture', 'rows', 'output', 'revision', 'sample-rounds', 'sample-timeout-ms',
    ...peers.map((peer) => `${peer}-runner`),
  ]);
  const values = new Map();
  for (const argument of argv) {
    if (!argument.startsWith('--') || !argument.includes('=')) {
      throw new Error(`expected --name=value, received ${argument}`);
    }
    const [name, ...rest] = argument.slice(2).split('=');
    if (!allowed.has(name)) throw new Error(`unknown option --${name}`);
    values.set(name, rest.join('='));
  }
  const rows = Number(values.get('rows') ?? 4096);
  if (!Number.isSafeInteger(rows) || rows < 1) throw new Error('--rows must be positive');
  const revision = values.get('revision');
  if (!revision) throw new Error('--revision is required');
  const sampleRounds = Number(values.get('sample-rounds') ?? 0);
  if (!Number.isSafeInteger(sampleRounds) || sampleRounds < 0) {
    throw new Error('--sample-rounds must be a nonnegative safe integer');
  }
  const sampleTimeoutMs = Number(values.get('sample-timeout-ms') ?? 60_000);
  if (!Number.isSafeInteger(sampleTimeoutMs) || sampleTimeoutMs < 1) {
    throw new Error('--sample-timeout-ms must be a positive safe integer');
  }
  const workRoot = join(benchmarkRoot, '.work');
  return {
    fixture: resolve(values.get('fixture') ?? join(workRoot, 'fixture.csv')),
    rows,
    output: resolve(values.get('output') ?? join(workRoot, 'readiness.json')),
    revision,
    sampleRounds,
    sampleTimeoutMs,
    runners: Object.fromEntries(peers
      .filter((peer) => values.has(`${peer}-runner`))
      .map((peer) => [peer, resolve(values.get(`${peer}-runner`))])),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    mkdirSync(dirname(options.fixture), { recursive: true });
    mkdirSync(dirname(options.output), { recursive: true });
    const fixtureManifest = writeFixture(options.fixture, { rows: options.rows });
    const receipt = options.sampleRounds > 0
      ? buildSamplingReceipt({
        fixturePath: options.fixture,
        fixtureManifest,
        runners: options.runners,
        revision: options.revision,
        rounds: options.sampleRounds,
        timeoutMs: options.sampleTimeoutMs,
      })
      : buildReadinessReceipt({
        fixturePath: options.fixture,
        fixtureManifest,
        runners: options.runners,
        revision: options.revision,
      });
    writeFileSync(options.output, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    process.stdout.write(`${options.output}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
