import {readFile, writeFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';

const [beforePath, afterPath, outputPath] = process.argv.slice(2);
if (!beforePath || !afterPath || !outputPath) {
  throw new Error('usage: node tools/compare-native-wasm-evidence.mjs before.json after.json output.json');
}
const before = JSON.parse(await readFile(beforePath, 'utf8'));
const after = JSON.parse(await readFile(afterPath, 'utf8'));
const differences = [];
if (before.entries.length !== after.entries.length) differences.push({field:'entry count'});
for (let index=0; index<Math.max(before.entries.length,after.entries.length); index++) {
  const left=before.entries[index],right=after.entries[index];
  for (const field of ['file','name','expectedCompileError','sourceSha256','native','wasm','passed','reason']) {
    if (!isDeepStrictEqual(left?.[field],right?.[field])) {
      differences.push({index,file:right?.file,name:right?.name,field,before:left?.[field],after:right?.[field]});
    }
  }
}
for (const field of ['files','cases','emptyFiles','discoveryErrors','passed','failed']) {
  if (!isDeepStrictEqual(before[field],after[field])) differences.push({field,before:before[field],after:after[field]});
}
const report={
  scope:'Exact test order, source hashes, native result objects, WASM result/error objects and pass/fail reasons. No diagnostic or numeric normalization.',
  before:beforePath,after:afterPath,
  beforeCompilerWasmSha256:before.compilerWasmSha256,afterCompilerWasmSha256:after.compilerWasmSha256,
  beforeNativeCompilerSha256:before.nativeCompilerSha256,afterNativeCompilerSha256:after.nativeCompilerSha256,
  entries:after.entries.length,failedCases:after.entries.filter(entry=>!entry.passed).length,
  exact: differences.length===0,differences,
};
await writeFile(outputPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({entries:report.entries,failedCases:report.failedCases,exact:report.exact,differences:differences.length}));
if (!report.exact) process.exitCode=1;
