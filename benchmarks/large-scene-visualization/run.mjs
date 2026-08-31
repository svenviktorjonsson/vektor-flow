import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { evaluateReport } from './contract.mjs';
import { verifyManifestFixtures } from './materialize-fixtures.mjs';

const root = dirname(fileURLToPath(import.meta.url));

function options(argv) {
  const result = {
    manifest: resolve(root, 'manifest.json'),
    report: resolve(root, 'results', 'scaffold.json'),
  };
  for (const argument of argv) {
    const match = /^--(manifest|report)=(.+)$/.exec(argument);
    if (!match) throw new Error(`expected --manifest=path or --report=path; received ${argument}`);
    result[match[1]] = resolve(match[2]);
  }
  return result;
}

export function run(argv = []) {
  const selected = options(argv);
  const manifest = JSON.parse(readFileSync(selected.manifest, 'utf8'));
  const report = JSON.parse(readFileSync(selected.report, 'utf8'));
  verifyManifestFixtures(manifest);
  const result = evaluateReport(manifest, report);
  const lines = [`verified ${manifest.workloads.length} generated point fixtures`];
  if (!result.hasPublishedClaims) {
    lines.push('scaffold only: 0 published comparisons; no performance claim');
  } else {
    for (const row of result.rows) {
      lines.push(`${row.workload}: VKF / ${row.peer} = ${row.ratio.toFixed(3)}x`);
    }
    lines.push(`0.4.0 gate: every comparable row is below ${result.gate.maxVkfToPeerRatioExclusive.toFixed(3)}x`);
  }
  return lines;
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invoked) {
  try {
    console.log(run(process.argv.slice(2)).join('\n'));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
