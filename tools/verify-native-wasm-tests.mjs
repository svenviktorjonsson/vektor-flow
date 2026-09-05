import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile, readdir, writeFile, mkdir, mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Worker, isMainThread, parentPort, workerData} from 'node:worker_threads';
import {createSharedCompiler} from '../web/playground/vkf-shared-compiler.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const deadline = 30_000;

export function compareTestOutcome(entry, native, wasm) {
  if (native.error) return {passed: false, reason: `native: ${native.error}`};
  if (entry.expectedCompileError !== null) {
    const expected = entry.expectedCompileError;
    const matched = expected.length > 0 && !wasm.ok
      && ['frontend', 'lowering'].includes(wasm.phase) && wasm.diagnostic.includes(expected);
    return {passed: native.status === 0 && matched,
      reason: native.status !== 0 ? 'native expected-diagnostic gate failed'
        : matched ? undefined : 'WASM did not produce the native expected compile diagnostic'};
  }
  if (!entry.compatible) return {passed: false, reason: entry.incompatibility};
  if (native.status !== 0) return {passed: false, reason: 'native test failed'};
  if (!wasm.ok) return {passed: false, reason: `WASM ${wasm.phase}: ${wasm.diagnostic}`};
  if (Object.hasOwn(wasm.result, 'values')) {
    return {passed: false, reason: 'WASM exposed language values instead of the output-only host boundary'};
  }
  const stdout = typeof wasm.result.stdout === 'string' ? wasm.result.stdout : undefined;
  if (stdout === undefined) return {passed: false, reason: 'exact native stdout transport is not yet implemented for this result'};
  if (stdout !== native.stdout) return {passed: false, reason: 'native/WASM stdout differs'};
  if ((wasm.result.stderr ?? '') !== native.stderr) return {passed: false, reason: 'native/WASM stderr differs'};
  return {passed: true};
}

async function executeWasm(module, source) {
  return new Promise(resolve => {
    const worker = new Worker(new URL(import.meta.url), {workerData: {module, source}});
    let settled = false;
    const finish = async result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      await worker.terminate();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ok: false, phase: 'timeout', diagnostic: 'execution exceeded 30000 ms'}), deadline);
    worker.once('message', finish);
    worker.once('error', error => finish({ok: false, phase: 'worker', diagnostic: error.message}));
    worker.once('exit', code => { if (!settled) finish({ok: false, phase: 'worker', diagnostic: `worker exited ${code}`}); });
  });
}

async function main() {
  const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const nativeCompiler = path.resolve(root, option('native') ?? 'build/native-compiler-docker/bin/vkf-strict');
  const bytes = await readFile(path.join(root, 'build/shared-compiler/vkf-compiler.wasm'));
  const module = new WebAssembly.Module(bytes);
  if (WebAssembly.Module.imports(module).length) throw new Error('compiler imports host capabilities');
  const compiler = createSharedCompiler({instance: new WebAssembly.Instance(module)});
  const files = [];
  async function enumerate(directory) {
    for (const entry of await readdir(path.join(root, directory), {withFileTypes: true})) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await enumerate(relative);
      else if (entry.isFile()) files.push(relative);
    }
  }
  await enumerate('tests/vkf');
  const selected = compiler.selectTestFiles(files);
  const cases = [];
  const discoveryErrors = [];
  const emptyFiles = [];
  for (const file of selected) {
    const source = await readFile(path.join(root, file), 'utf8');
    try {
      const suite = compiler.describeTests(source, file);
      if (suite.expectedCompileError !== null) {
        cases.push({file, name: '<expected compile error>', expectedCompileError: suite.expectedCompileError, source: suite.source});
      } else {
        if (!suite.tests.length) emptyFiles.push(file);
        for (const test of suite.tests) cases.push({file, ...test, expectedCompileError: null});
      }
    } catch (error) { discoveryErrors.push({file, diagnostic: error.message}); }
  }
  const report = {
    scope: 'Same tests/vkf selection, generated assertion source and expected compile-error rules as vkf-strict -t. No unsupported-test exclusions.',
    compilerWasmSha256: createHash('sha256').update(bytes).digest('hex'),
    files: selected.length, cases: cases.length, emptyFiles, discoveryErrors,
    inventoryOnly: process.argv.includes('--inventory-only'), entries: [],
  };
  let runDirectory;
  if (!report.inventoryOnly) {
    const parent = path.join(root, 'build/native-wasm-suite');
    await mkdir(parent, {recursive: true});
    runDirectory = await mkdtemp(path.join(parent, 'run-'));
    report.nativeCompilerSha256 = createHash('sha256').update(await readFile(nativeCompiler)).digest('hex');
    report.nativeArtifactDirectory = path.relative(root, runDirectory).replaceAll('\\', '/');
    report.freshNativeArtifacts = true;
  }
  console.log(`Native/WASM shared inventory: ${report.cases} cases in ${report.files} files; ${discoveryErrors.length} discovery errors.`);
  for (const entry of cases) {
    const {source, ...identity} = entry;
    const sourceSha256 = createHash('sha256').update(source).digest('hex');
    if (report.inventoryOnly) { report.entries.push({...identity, sourceSha256}); continue; }
    // A fresh output path prevents a prior native executable cache entry from
    // bypassing the compiler being compared in this run. Negative fixtures use
    // native -t's compile-only error gate, not runtime failure as a substitute.
    let args;
    if (entry.expectedCompileError !== null) {
      args = ['-t', path.join(root, entry.file)];
    } else {
      const unit = path.join(runDirectory, `case-${report.entries.length}.vkf`);
      await writeFile(unit, source);
      args = [unit, '-o', path.join(runDirectory, `case-${report.entries.length}${process.platform === 'win32' ? '.exe' : ''}`)];
    }
    const processResult = spawnSync(nativeCompiler, args, {cwd: root, encoding: 'utf8',
      timeout: deadline, maxBuffer: 64 * 1024 * 1024, windowsHide: true});
    const native = {status: processResult.status, stdout: processResult.stdout ?? '',
      stderr: processResult.stderr ?? '', error: processResult.error?.message, signal: processResult.signal};
    const wasm = await executeWasm(module, source);
    const outcome = compareTestOutcome(entry, native, wasm);
    report.entries.push({...identity, sourceSha256, native, wasm, ...outcome});
    console.log(`${outcome.passed ? 'PASS' : 'FAIL'} ${entry.file}::${entry.name}${outcome.reason ? `: ${outcome.reason}` : ''}`);
  }
  if (!report.inventoryOnly) {
    const finalNativeSha256 = createHash('sha256').update(await readFile(nativeCompiler)).digest('hex');
    report.nativeCompilerStable = finalNativeSha256 === report.nativeCompilerSha256;
    report.passed = report.entries.filter(entry => entry.passed).length;
    report.failed = report.entries.length - report.passed + discoveryErrors.length + (report.nativeCompilerStable ? 0 : 1);
    console.log(`Shared native/WASM test gate: ${report.passed}/${report.cases}; ${report.failed} failures.`);
  }
  if (option('output')) await writeFile(path.resolve(root, option('output')), `${JSON.stringify(report, null, 2)}\n`);
  if (discoveryErrors.length || report.failed) process.exitCode = 1;
}

if (!isMainThread) {
  try {
    const compiler = createSharedCompiler({instance: new WebAssembly.Instance(workerData.module)});
    parentPort.postMessage({ok: true, result: compiler.run(workerData.source)});
  } catch (error) {
    parentPort.postMessage({ok: false, phase: error.phase ?? 'runtime', diagnostic: error.message});
  }
} else if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
