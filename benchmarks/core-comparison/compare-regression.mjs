import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function parseArgs(argv) {
  const options = { before: null, after: null, reason: '' };
  for (const arg of argv) {
    const match = /^--(before|after|reason)=(.*)$/.exec(arg);
    if (!match) throw new Error(`unknown option: ${arg}`);
    options[match[1]] = match[2];
  }
  if (!options.before || !options.after) {
    throw new Error('usage: compare-regression --before=old.json --after=new.json [--reason=text]');
  }
  return options;
}
function environmentKey(payload) {
  const environment = payload.environment || {};
  return [environment.platform, environment.architecture, environment.cpu].join('|');
}

function vkfResults(payload) {
  return new Map(
    payload.results
      .filter((result) => result.language === 'vkf')
      .map((result) => [result.case, result])
  );
}

export function compareRegression(before, after, reason = '') {
  if (environmentKey(before) !== environmentKey(after)) {
    throw new Error('benchmark environments differ; regression comparison is invalid');
  }
  if (before.options?.compileRuns < 100 || before.options?.runs < 100 ||
      after.options?.compileRuns < 100 || after.options?.runs < 100) {
    throw new Error('regression comparison requires 100 compile and runtime samples');
  }
  const previous = vkfResults(before);
  const current = vkfResults(after);
  const rows = [];
  const regressions = [];
  for (const [caseId, candidate] of current) {
    const baseline = previous.get(caseId);
    if (!baseline) throw new Error(`missing baseline VKF case: ${caseId}`);
    if (!baseline.nativeRuntime || !candidate.nativeRuntime) {
      throw new Error(`missing raw machine-entry runtime for VKF case: ${caseId}`);
    }
    const compileDelta = candidate.compile.meanMs - baseline.compile.meanMs;
    const runtimeDelta = candidate.nativeRuntime.meanMs - baseline.nativeRuntime.meanMs;
    const identicalCode = Boolean(
      baseline.nativeCodeSha256 && baseline.nativeCodeSha256 === candidate.nativeCodeSha256
    );
    const compileRegression = compileDelta > 0;
    const runtimeRegression = runtimeDelta > 0 && !identicalCode;
    if (compileRegression || runtimeRegression) {
      regressions.push({ caseId, compileRegression, runtimeRegression });
    }
    rows.push({
      case: caseId,
      compileBeforeMs: baseline.compile.meanMs,
      compileAfterMs: candidate.compile.meanMs,
      compileDeltaMs: compileDelta,
      runtimeBeforeMs: baseline.nativeRuntime.meanMs,
      runtimeAfterMs: candidate.nativeRuntime.meanMs,
      runtimeDeltaMs: runtimeDelta,
      identicalCode
    });
  }
  if (regressions.length > 0 && !reason.trim()) {
    const cases = regressions.map(({ caseId }) => caseId).join(', ');
    throw new Error(`unexplained VKF performance regression: ${cases}`);
  }
  return { rows, acceptedReason: regressions.length > 0 ? reason.trim() : '' };
}

function formatDelta(value) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(6)}`;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const before = JSON.parse(readFileSync(resolve(options.before), 'utf8'));
  const after = JSON.parse(readFileSync(resolve(options.after), 'utf8'));
  const comparison = compareRegression(before, after, options.reason);
  for (const row of comparison.rows) {
    console.log(
      `${row.case}: compile ${row.compileAfterMs.toFixed(6)} ms (${formatDelta(row.compileDeltaMs)}); ` +
      `runtime ${row.runtimeAfterMs.toFixed(6)} ms (${formatDelta(row.runtimeDeltaMs)}); ` +
      `machine-code ${row.identicalCode ? 'identical' : 'changed'}`
    );
  }
  if (comparison.acceptedReason) console.log(`accepted reason: ${comparison.acceptedReason}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
