import { createHash } from 'node:crypto';
import { closeSync, openSync, writeSync } from 'node:fs';

const DEFAULT_ROWS = 4096;
const MAX_ROWS = 10_000_000;
const UNUSED_COLUMNS = Object.freeze([
  'unused_a',
  'unused_b',
  'unused_c',
  'unused_d',
  'unused_e',
  'unused_f',
]);

function validateRows(rows) {
  if (!Number.isSafeInteger(rows) || rows < 1 || rows > MAX_ROWS) {
    throw new Error(`fixture rows must be an integer from 1 through ${MAX_ROWS}`);
  }
}

function rowValues(index) {
  const x = (index * 17) % 101 - 50;
  const y = (index * 31) % 89 - 44;
  const unused = UNUSED_COLUMNS.map((_, column) => (
    (index * (column * 12 + 7) + column * 19) % 997 - 498
  ));
  return { x, y, unused };
}

export function expectedSum(rows) {
  validateRows(rows);
  let sum = 0n;
  for (let index = 0; index < rows; index += 1) {
    const { x, y } = rowValues(index);
    const transformed = BigInt(2 * x - y);
    sum += transformed * transformed;
  }
  if (sum > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('fixture oracle exceeds exact f64 integer range');
  }
  return Number(sum);
}

export function* fixtureTextChunks({ rows = DEFAULT_ROWS, rowsPerChunk = 1024 } = {}) {
  validateRows(rows);
  if (!Number.isSafeInteger(rowsPerChunk) || rowsPerChunk < 1) {
    throw new Error('rowsPerChunk must be a positive safe integer');
  }
  yield `${['row_id', 'x', 'y', ...UNUSED_COLUMNS].join(',')}\n`;
  for (let start = 0; start < rows; start += rowsPerChunk) {
    const lines = [];
    const end = Math.min(rows, start + rowsPerChunk);
    for (let index = start; index < end; index += 1) {
      const { x, y, unused } = rowValues(index);
      lines.push([
        index,
        `${x}.0`,
        `${y}.0`,
        ...unused.map((value) => `${value}.0`),
      ].join(','));
    }
    yield `${lines.join('\n')}\n`;
  }
}

function manifestFor(rows, sha256) {
  return Object.freeze({
    schema_version: 1,
    workload: 'csv-project-transform-reduce-v1',
    rows,
    columns: Object.freeze(['row_id', 'x', 'y', ...UNUSED_COLUMNS]),
    demanded_columns: Object.freeze(['x', 'y']),
    unused_columns: UNUSED_COLUMNS,
    expression: 'sum((2*x-y)^2)',
    precision: 'f64',
    expected_sum: expectedSum(rows),
    sha256,
  });
}

export function materializeFixture(options = {}) {
  const rows = options.rows ?? DEFAULT_ROWS;
  const hash = createHash('sha256');
  const chunks = [];
  for (const text of fixtureTextChunks({ ...options, rows })) {
    const bytes = Buffer.from(text, 'utf8');
    hash.update(bytes);
    chunks.push(bytes);
  }
  const bytes = Buffer.concat(chunks);
  return Object.freeze({ bytes, manifest: manifestFor(rows, hash.digest('hex')) });
}

export function writeFixture(path, options = {}) {
  const rows = options.rows ?? DEFAULT_ROWS;
  const hash = createHash('sha256');
  const descriptor = openSync(path, 'w');
  try {
    for (const text of fixtureTextChunks({ ...options, rows })) {
      const bytes = Buffer.from(text, 'utf8');
      hash.update(bytes);
      let offset = 0;
      while (offset < bytes.length) offset += writeSync(descriptor, bytes, offset);
    }
  } finally {
    closeSync(descriptor);
  }
  return manifestFor(rows, hash.digest('hex'));
}
