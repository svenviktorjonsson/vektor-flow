import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const repo = resolve(root, '..', '..');

const kernelSpecs = Object.freeze({
  'solve-general-96': { fixture: 'general-96', algorithm: 'partial-pivot Gaussian solve' },
  'least-squares-tall-96x48': { fixture: 'tall-96x48', algorithm: 'modified Gram-Schmidt QR solve' },
  'lu-general-96': { fixture: 'general-96', algorithm: 'partial-pivot LU' },
  'qr-tall-96x48': { fixture: 'tall-96x48', algorithm: 'modified Gram-Schmidt thin QR' },
  'cholesky-spd-96': { fixture: 'spd-96', algorithm: 'lower Cholesky' },
  'svd-tall-96x48': { fixture: 'tall-96x48', algorithm: 'Gram eigen thin SVD' },
  'eigen-symmetric-96': { fixture: 'spd-96', algorithm: 'Householder plus implicit QL symmetric eigen' },
});

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256File(path) {
  return sha256Bytes(readFileSync(path));
}

function parseArgs(argv) {
  const options = new Map();
  for (const item of argv) {
    if (!item.startsWith('--') || !item.includes('=')) throw new Error(`expected --name=value, got ${item}`);
    const [name, ...value] = item.slice(2).split('=');
    options.set(name, value.join('='));
  }
  return {
    compiler: resolve(options.get('compiler') ?? join(repo, 'build', 'native-compiler-clang', 'bin', 'vkf-strict.exe')),
    fixtureRoot: resolve(options.get('fixtures') ?? join(root, 'fixtures')),
    output: resolve(options.get('output') ?? join(repo, '.work', 'linalg-vkf-runners')),
    kernels: (options.get('kernels') ?? Object.keys(kernelSpecs).join(',')).split(',').filter(Boolean),
  };
}

function decodeFixture(fixtureRoot, manifest, name) {
  const spec = manifest.fixtures[name];
  const path = join(fixtureRoot, spec.file);
  const bytes = readFileSync(path);
  const actual = sha256Bytes(bytes);
  if (actual !== spec.sha256) throw new Error(`${name} fixture hash ${actual}; expected ${spec.sha256}`);
  const values = [];
  for (let offset = 0; offset < bytes.length; offset += 8) values.push(bytes.readDoubleLE(offset));
  const array = (key) => {
    const part = spec.arrays[key];
    if (!part) return undefined;
    return values.slice(part.offsetElements, part.offsetElements + part.length);
  };
  return { spec, matrix: array('matrix'), xTrue: array('x_true'), rhs: array('rhs') };
}

function scalar(value) {
  if (!Number.isFinite(value)) throw new Error(`non-finite fixture scalar ${value}`);
  if (Object.is(value, -0)) return '-0.0';
  const text = value.toString();
  return /[.eE]/.test(text) ? text : `${text}.0`;
}

function vector(values) {
  return `[${values.map(scalar).join(',')}]`;
}

function fixtureText(values) {
  const words = [];
  const bytes = Buffer.allocUnsafe(8);
  for (const value of values) {
    bytes.writeDoubleLE(value, 0);
    const bits = bytes.readBigUInt64LE(0);
    const sign = Number(bits >> 63n);
    const exponentBits = Number((bits >> 52n) & 0x7ffn);
    const fraction = bits & ((1n << 52n) - 1n);
    if (exponentBits === 0x7ff) throw new Error('linalg fixtures must be finite');
    const significand = exponentBits === 0 ? fraction : (1n << 52n) | fraction;
    const exponent = exponentBits === 0 ? -1074 : exponentBits - 1023 - 52;
    let remaining = significand;
    const digits = Array(4).fill(0);
    for (let index = 3; index >= 0; index -= 1) {
      digits[index] = Number(remaining & 0x3fffn);
      remaining >>= 14n;
    }
    const encodedExponent = (exponent + 1100) * 2 + sign;
    if (encodedExponent < 0 || encodedExponent >= 0x4000) throw new Error('f64 exponent encoding overflow');
    words.push(String.fromCodePoint(...digits.map((digit) => 0x4000 + digit), 0x4000 + encodedExponent));
  }
  return words.join('');
}

function decodeFixtureText(text) {
  const codepoints = [...text].map((value) => value.codePointAt(0) - 0x4000);
  if (codepoints.length % 5 !== 0) throw new Error('invalid packed f64 fixture length');
  const bytes = Buffer.allocUnsafe((codepoints.length / 5) * 8);
  for (let offset = 0; offset < codepoints.length; offset += 5) {
    let significand = 0n;
    for (let digit = 0; digit < 4; digit += 1) {
      significand = significand * 0x4000n + BigInt(codepoints[offset + digit]);
    }
    const packedExponent = codepoints[offset + 4];
    const sign = packedExponent % 2 === 0 ? 1 : -1;
    const exponent = Math.floor(packedExponent / 2) - 1100;
    bytes.writeDoubleLE(sign * Number(significand) * (2 ** exponent), (offset / 5) * 8);
  }
  return bytes;
}

function quotedPath(path) {
  return JSON.stringify(path.replaceAll('\\', '/'));
}

function commonSource(fixture, hash, dataPath) {
  const { rows, columns } = fixture.spec;
  const total = fixture.matrix.length + (fixture.xTrue?.length ?? 0) + (fixture.rhs?.length ?? 0);
  return `:.linalg
:.math
:.time
io: .io

_bench_vector_sum(values:[num:n]) -> num:
    total: 0
    values.length() > 0?
        ..values.length() - 1 >>
            .total+: values.($)
    total

_bench_vector_norm(values:[num:n]) -> num:
    sqrt(dot(values, values))

_bench_matrix_norm(values:[[num:c]:r]) -> num:
    total: 0
    values.length() > 0?
        ..values.length() - 1 >>
            row: $
            values.0.length() > 0?
                ..values.0.length() - 1 >>
                    .total+: values.(row, $) * values.(row, $)
    sqrt(total)

_bench_matrix_sum(values:[[num:c]:r]) -> num:
    total: 0
    values.length() > 0?
        ..values.length() - 1 >>
            .total+: _bench_vector_sum(values.($))
    total

_bench_relative(value:num, scale:num) -> num:
    scale = 0? @: value
    value / scale

_bench_max(left:num, right:num) -> num:
    left > right? @: left
    right

_bench_orthogonality(values:[[num:c]:r]) -> num:
    gram: matmul(transpose(values), values)
    identity: gram * 0.0
    identity.length() > 0?
        ..identity.length() - 1 >>
            identity.($, $): 1
    _bench_relative(_bench_matrix_norm(gram - identity), identity.length())

fixture_text: io.read_text(${quotedPath(dataPath)})
fixture_values: [0.0:${total}]
fixture_index: 0
fixture_component: 0
fixture_significand: 0
fixture_sign: 1
fixture_exponent: 0
fixture_code: 0
fixture_text >>
    .fixture_code: int($) - 16384
    fixture_component < 4?
        .fixture_significand: fixture_significand * 16384 + fixture_code
    fixture_component = 4?
        .fixture_sign: 1
        fixture_code % 2 = 1? .fixture_sign: -1
        .fixture_exponent: fixture_code // 2 - 1100
        fixture_values.(fixture_index): fixture_sign * fixture_significand * 2^fixture_exponent
        .fixture_index+: 1
        .fixture_component: -1
        .fixture_significand: 0
        .fixture_sign: 1
        .fixture_exponent: 0
    .fixture_component+: 1
    $
(fixture_index = ${total})?! "linalg fixture text has the wrong value count"
[[num:${columns}]:${rows}] matrix: [[0.0:${columns}]:${rows}]
..${rows - 1} >>
    row: $
    ..${columns - 1} >>
        matrix.(row, $): fixture_values.(row * ${columns} + $)
input_sha256: "${hash}"
`;
}

function output(lines, algorithm) {
  return `${lines}
:: "elapsed_ms=" & str(elapsed_ms)
:: "checksum=" & str(checksum)
${Object.entries(lines.metrics ?? {}).map(([name, expression]) => `:: "${name}=" & str(${expression})`).join('\n')}
:: "input_sha256=" & input_sha256
:: "implementation=VKF .linalg"
:: "backend=direct native machine code; one thread"
:: "algorithm=${algorithm}"
`;
}

function fixtureVector(fixture, key) {
  const part = fixture.spec.arrays[key];
  return `[..${part.length - 1} >> fixture_values.(${part.offsetElements} + $)]`;
}

function kernelBody(id, fixture) {
  if (id === 'solve-general-96') return output(Object.assign(`
x_true: ${fixtureVector(fixture, 'x_true')}
rhs: ${fixtureVector(fixture, 'rhs')}
warmup: solve(matrix, rhs)
started: monotonic()
result: solve(matrix, rhs)
elapsed_ms: (monotonic() - started) * 1000
difference: dot(matrix, result) - rhs
residual: _bench_relative(
    _bench_vector_norm(difference),
    _bench_matrix_norm(matrix) * _bench_vector_norm(result) + _bench_vector_norm(rhs)
)
solution_error: _bench_relative(_bench_vector_norm(result - x_true), _bench_vector_norm(x_true))
checksum: _bench_vector_sum(result)`, { metrics: { residual: 'residual', solution_error: 'solution_error' } }), kernelSpecs[id].algorithm);

  if (id === 'least-squares-tall-96x48') return output(Object.assign(`
x_true: ${fixtureVector(fixture, 'x_true')}
rhs: ${fixtureVector(fixture, 'rhs')}
warmup: least_squares(matrix, rhs)
started: monotonic()
result: least_squares(matrix, rhs)
elapsed_ms: (monotonic() - started) * 1000
difference: dot(matrix, result) - rhs
normal_difference: dot(transpose(matrix), difference)
residual: _bench_relative(
    _bench_vector_norm(normal_difference),
    _bench_matrix_norm(matrix) * _bench_vector_norm(difference)
)
solution_error: _bench_relative(_bench_vector_norm(result - x_true), _bench_vector_norm(x_true))
checksum: _bench_vector_sum(result)`, { metrics: { residual: 'residual', solution_error: 'solution_error' } }), kernelSpecs[id].algorithm);

  if (id === 'lu-general-96') return output(Object.assign(`
warmup: lu(matrix)
started: monotonic()
result: lu(matrix)
elapsed_ms: (monotonic() - started) * 1000
permuted: matrix * 0.0
..matrix.length() - 1 >>
    row: $
    ..matrix.0.length() - 1 >>
        permuted.(row, $): matrix.(int(result.permutation.(row)), $)
reconstructed: matmul(result.lower, result.upper)
reconstruction: _bench_relative(_bench_matrix_norm(permuted - reconstructed), _bench_matrix_norm(matrix))
checksum: _bench_vector_sum(result.permutation) + _bench_matrix_sum(result.lower) + _bench_matrix_sum(result.upper)`, { metrics: { reconstruction: 'reconstruction' } }), kernelSpecs[id].algorithm);

  if (id === 'qr-tall-96x48') return output(Object.assign(`
warmup: qr(matrix)
started: monotonic()
result: qr(matrix)
elapsed_ms: (monotonic() - started) * 1000
reconstruction: _bench_relative(_bench_matrix_norm(matrix - matmul(result.q, result.r)), _bench_matrix_norm(matrix))
orthogonality: _bench_orthogonality(result.q)
checksum: _bench_matrix_sum(result.q) + _bench_matrix_sum(result.r)`, { metrics: { reconstruction: 'reconstruction', orthogonality: 'orthogonality' } }), kernelSpecs[id].algorithm);

  if (id === 'cholesky-spd-96') return output(Object.assign(`
warmup: cholesky(matrix)
started: monotonic()
result: cholesky(matrix)
elapsed_ms: (monotonic() - started) * 1000
reconstruction: _bench_relative(_bench_matrix_norm(matrix - matmul(result, transpose(result))), _bench_matrix_norm(matrix))
checksum: _bench_matrix_sum(result)`, { metrics: { reconstruction: 'reconstruction' } }), kernelSpecs[id].algorithm);

  if (id === 'svd-tall-96x48') return output(Object.assign(`
warmup: svd(matrix, 0.000000000001, 64, false)
started: monotonic()
result: svd(matrix, 0.000000000001, 64, false)
elapsed_ms: (monotonic() - started) * 1000
reconstructed: matmul(matmul(result.u, diag(result.s)), result.vh)
reconstruction: _bench_relative(_bench_matrix_norm(matrix - reconstructed), _bench_matrix_norm(matrix))
left_orthogonality: _bench_orthogonality(result.u)
right_orthogonality: _bench_orthogonality(transpose(result.vh))
orthogonality: _bench_max(left_orthogonality, right_orthogonality)
checksum: _bench_vector_sum(result.s)`, { metrics: { reconstruction: 'reconstruction', orthogonality: 'orthogonality' } }), kernelSpecs[id].algorithm);

  if (id === 'eigen-symmetric-96') return output(Object.assign(`
warmup: eigen(matrix, 0.000000000001, 64, false)
started: monotonic()
result: eigen(matrix, 0.000000000001, 64, false)
elapsed_ms: (monotonic() - started) * 1000
scaled_vectors: matmul(result.vectors, diag(result.values))
residual: _bench_relative(_bench_matrix_norm(matmul(matrix, result.vectors) - scaled_vectors), _bench_matrix_norm(matrix))
reconstruction: _bench_relative(_bench_matrix_norm(matrix - matmul(scaled_vectors, transpose(result.vectors))), _bench_matrix_norm(matrix))
orthogonality: _bench_orthogonality(result.vectors)
checksum: _bench_vector_sum(result.values)`, { metrics: { residual: 'residual', reconstruction: 'reconstruction', orthogonality: 'orthogonality' } }), kernelSpecs[id].algorithm);

  throw new Error(`VKF runner is not implemented for ${id}`);
}

function compile(compiler, source, executable) {
  const result = spawnSync(compiler, ['-b', source, '-o', executable], {
    cwd: repo, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${compiler} failed for ${source}:\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const fixtureManifest = JSON.parse(readFileSync(join(options.fixtureRoot, 'manifest.json'), 'utf8'));
  mkdirSync(options.output, { recursive: true });
  const manifest = {
    schema: 'vkf.linalg-runners', schemaVersion: 1,
    compiler: options.compiler, compilerSha256: sha256File(options.compiler), runners: {},
  };
  for (const id of options.kernels) {
    const spec = kernelSpecs[id];
    if (!spec) throw new Error(`unknown or unsupported VKF linalg kernel ${id}`);
    const fixture = decodeFixture(options.fixtureRoot, fixtureManifest, spec.fixture);
    const sourcePath = join(options.output, `${id}.vkf`);
    const executablePath = join(options.output, process.platform === 'win32' ? `${id}.exe` : id);
    const dataPath = join(options.output, `${spec.fixture}.f64.vkftxt`);
    const allValues = [fixture.matrix, fixture.xTrue, fixture.rhs].filter(Boolean).flat();
    const text = fixtureText(allValues);
    if (sha256Bytes(decodeFixtureText(text)) !== fixture.spec.sha256) {
      throw new Error(`${spec.fixture} packed text is not byte-identical to the f64 fixture`);
    }
    writeFileSync(dataPath, text);
    const source = `${commonSource(fixture, fixture.spec.sha256, dataPath)}${kernelBody(id, fixture)}`;
    writeFileSync(sourcePath, source);
    process.stderr.write(`compiling ${id}\n`);
    compile(options.compiler, sourcePath, executablePath);
    manifest.runners[id] = {
      executable: executablePath, executableSha256: sha256File(executablePath),
      source: sourcePath, sourceSha256: sha256File(sourcePath),
      derivedFixture: dataPath, derivedFixtureSha256: sha256File(dataPath),
      fixture: spec.fixture, fixtureSha256: fixture.spec.sha256,
    };
  }
  const path = join(options.output, 'manifest.json');
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${path}\n`);
}

main();
