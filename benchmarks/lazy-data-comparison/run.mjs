import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeFixture } from './materialize-fixture.mjs';

const benchmarkRoot = dirname(fileURLToPath(import.meta.url));
const contractPath = join(benchmarkRoot, 'contract.json');
const sourcePath = join(benchmarkRoot, 'programs', 'project-transform-reduce.vkf');

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

export function buildReadinessReceipt({ fixturePath, fixtureManifest, runners, revision }) {
  const fixtureHash = sha256File(fixturePath);
  if (fixtureHash !== fixtureManifest.sha256) {
    throw new Error(`fixture SHA-256 changed: ${fixtureHash}; expected ${fixtureManifest.sha256}`);
  }
  const contract = loadContract();
  const availability = availabilityReport(runners, contract);
  return Object.freeze({
    ...availability,
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
        availability.peers[peer].runner_sha256 ?? null,
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

function parseArguments(argv) {
  const peers = loadContract().peer_set.members;
  const allowed = new Set([
    'fixture', 'rows', 'output', 'revision', ...peers.map((peer) => `${peer}-runner`),
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
  const workRoot = join(benchmarkRoot, '.work');
  return {
    fixture: resolve(values.get('fixture') ?? join(workRoot, 'fixture.csv')),
    rows,
    output: resolve(values.get('output') ?? join(workRoot, 'readiness.json')),
    revision,
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
    const receipt = buildReadinessReceipt({
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
