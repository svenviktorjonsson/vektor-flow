import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(root, 'fixtures');

function raw(row, column, salt) {
  let value = Math.imul(row + 1, 0x9e3779b1) ^ Math.imul(column + 1, 0x85ebca6b) ^ Math.imul(salt, 0xc2b2ae35);
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x80000000 - 1;
}

function matvec(matrix, rows, columns, vector) {
  return Array.from({ length: rows }, (_, row) => {
    let sum = 0;
    for (let column = 0; column < columns; column += 1) sum += matrix[row * columns + column] * vector[column];
    return sum;
  });
}

function generalFixture(size) {
  const matrix = Array.from({ length: size * size }, (_, index) => {
    const row = Math.floor(index / size);
    const column = index % size;
    return raw(row, column, 1) / 64 + (row === column ? 2 : 0);
  });
  const xTrue = Array.from({ length: size }, (_, index) => raw(index, 0, 2));
  return { arrays: { matrix, x_true: xTrue, rhs: matvec(matrix, size, size, xTrue) }, rows: size, columns: size };
}

function tallFixture(rows, columns) {
  const half = rows / 2;
  const halfMatrix = Array.from({ length: half * columns }, (_, index) => raw(
    Math.floor(index / columns), index % columns, 3,
  ));
  const matrix = [...halfMatrix, ...halfMatrix];
  const xTrue = Array.from({ length: columns }, (_, index) => raw(index, 0, 4));
  const residualHalf = Array.from({ length: half }, (_, index) => raw(index, 0, 5) / 32);
  const residual = [...residualHalf, ...residualHalf.map((value) => -value)];
  const exact = matvec(matrix, rows, columns, xTrue);
  const rhs = exact.map((value, index) => value + residual[index]);
  return { arrays: { matrix, x_true: xTrue, rhs }, rows, columns };
}

function spdFixture(size) {
  const lower = Array(size * size).fill(0);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      lower[row * size + column] = row === column ? 2 + (row % 7) / 16 : raw(row, column, 6) / 64;
    }
  }
  const matrix = Array(size * size).fill(0);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      let sum = 0;
      for (let k = 0; k <= Math.min(row, column); k += 1) sum += lower[row * size + k] * lower[column * size + k];
      matrix[row * size + column] = sum;
    }
  }
  return { arrays: { matrix }, rows: size, columns: size };
}

function encode(fixture) {
  const descriptors = {};
  const values = [];
  for (const [name, array] of Object.entries(fixture.arrays)) {
    descriptors[name] = { offsetElements: values.length, length: array.length };
    values.push(...array);
  }
  const bytes = Buffer.allocUnsafe(values.length * 8);
  values.forEach((value, index) => bytes.writeDoubleLE(value, index * 8));
  return { bytes, descriptors };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function materialized() {
  const definitions = {
    'general-96': generalFixture(96),
    'tall-96x48': tallFixture(96, 48),
    'spd-96': spdFixture(96),
  };
  const files = {};
  const fixtures = {};
  for (const [name, fixture] of Object.entries(definitions)) {
    const encoded = encode(fixture);
    const file = `${name}.f64le`;
    files[file] = encoded.bytes;
    fixtures[name] = {
      file,
      sha256: sha256(encoded.bytes),
      rows: fixture.rows,
      columns: fixture.columns,
      layout: 'row-major f64 little-endian',
      arrays: encoded.descriptors,
    };
  }
  const manifest = `${JSON.stringify({
    schema: 'vkf.linalg-fixtures',
    schemaVersion: 1,
    generator: 'deterministic 32-bit integer mix; version 2',
    fixtures,
  }, null, 2)}\n`;
  return { files, manifest };
}

function main() {
  const check = process.argv.includes('--check');
  const generated = materialized();
  if (check) {
    for (const [file, bytes] of Object.entries(generated.files)) {
      const path = join(fixtureRoot, file);
      if (!existsSync(path) || !readFileSync(path).equals(bytes)) throw new Error(`${file} is stale`);
    }
    const manifestPath = join(fixtureRoot, 'manifest.json');
    const checkedManifest = existsSync(manifestPath)
      ? readFileSync(manifestPath, 'utf8').replaceAll('\r\n', '\n')
      : null;
    if (checkedManifest !== generated.manifest) {
      throw new Error('manifest.json is stale');
    }
    return;
  }
  mkdirSync(fixtureRoot, { recursive: true });
  for (const [file, bytes] of Object.entries(generated.files)) writeFileSync(join(fixtureRoot, file), bytes);
  writeFileSync(join(fixtureRoot, 'manifest.json'), generated.manifest);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
