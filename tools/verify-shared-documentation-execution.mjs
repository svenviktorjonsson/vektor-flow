import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Worker, isMainThread, parentPort, workerData} from 'node:worker_threads';
import {documentationSources} from './verify-browser-frontend-parity.mjs';
import {createSharedCompiler} from '../web/playground/vkf-shared-compiler.mjs';

if (!isMainThread) {
  try {
    const compiler = createSharedCompiler({instance: new WebAssembly.Instance(workerData.module)});
    const result = compiler.run(workerData.source);
    parentPort.postMessage({executed: true, result});
  } catch (error) {
    parentPort.postMessage({executed: false, diagnostic: error.message});
  }
} else {
  const bytes = await readFile(new URL('../build/shared-compiler/vkf-compiler.wasm', import.meta.url));
  const module = new WebAssembly.Module(bytes);
  if (WebAssembly.Module.imports(module).length) throw new Error('compiler imports host capabilities');
  const unique = new Map();
  for (const entry of await documentationSources()) {
    const source = entry.source.replaceAll('\r\n', '\n').trimEnd();
    if (!unique.has(source)) unique.set(source, []);
    unique.get(source).push({document: entry.document, line: entry.line, sourcePath: entry.sourcePath});
  }
  const entries = [];
  const nativeArgument = process.argv.find(arg => arg.startsWith('--native='));
  const native = nativeArgument?.slice(9);
  for (const [source, locations] of unique) {
    const result = await new Promise(resolve => {
      const worker = new Worker(new URL(import.meta.url), {workerData: {module, source}});
      let settled = false;
      const finish = async result => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        await worker.terminate();
        resolve(result);
      };
      const timer = setTimeout(() => finish({executed: false, diagnostic: 'execution exceeded 30000 ms'}), 30_000);
      worker.once('message', finish);
      worker.once('error', error => finish({executed: false, diagnostic: error.message}));
      worker.once('exit', code => { if (!settled) finish({executed: false, diagnostic: `worker exited ${code}`}); });
    });
    let nativeResult = null;
    if (native) {
      const nativeDirectory = mkdtempSync(path.join(tmpdir(), 'vkf-documentation-exact-'));
      try {
        symlinkSync(path.resolve('compiler'), path.join(nativeDirectory, 'compiler'), 'dir');
        nativeResult = spawnSync(path.resolve(native), ['-e', source], {
          cwd: nativeDirectory, encoding: 'utf8', timeout: 120_000,
        });
      } finally {
        rmSync(nativeDirectory, {recursive: true, force: true});
      }
    }
    const exact = nativeResult !== null
      && nativeResult.status === 0
      && result.executed
      && result.result?.kind === 'console'
      && result.result.stdout === nativeResult.stdout
      && result.result.stderr === nativeResult.stderr;
    entries.push({
      locations,
      sourceSha256: createHash('sha256').update(source).digest('hex'),
      ...result,
      ...(nativeResult === null ? {} : {
        native: {status: nativeResult.status, stdout: nativeResult.stdout, stderr: nativeResult.stderr},
        exact,
      }),
    });
    console.log(`${result.executed ? 'EXECUTED' : 'FAIL'} ${locations[0].sourcePath ?? locations[0].document}:${locations[0].line}${result.diagnostic ? `: ${result.diagnostic}` : ''}`);
  }
  const report = {
    scope: 'Execution smoke only. Successful return does not verify stdout, UI, edits, refresh, or native parity.',
    compilerWasmSha256: createHash('sha256').update(bytes).digest('hex'),
    uniqueSources: entries.length,
    executed: entries.filter(entry => entry.executed).length,
    ...(native ? {exact: entries.filter(entry => entry.exact).length} : {}),
    entries,
  };
  const destination = process.argv.find(arg => arg.startsWith('--output='));
  if (destination) await writeFile(destination.slice(9), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Execution smoke: ${report.executed}/${report.uniqueSources}; not an acceptance percentage.`);
  if (native) console.log(`Exact native/WASM console parity: ${report.exact}/${report.uniqueSources}.`);
  if (report.executed !== report.uniqueSources) process.exitCode = 1;
}
