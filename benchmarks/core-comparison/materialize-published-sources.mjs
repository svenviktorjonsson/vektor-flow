import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const programs = resolve(root, 'programs');
const published = resolve(root, 'published');

const languages = Object.freeze([
  ['vkf', 'vkf'],
  ['c', 'c'],
  ['rust', 'rs'],
  ['zig', 'zig'],
  ['go', 'go'],
  ['julia', 'jl'],
  ['python-efficient', 'py']
]);

const cases = Object.freeze([
  { id: 'startup', template: 'startup', count: null },
  { id: 'scalar-control-small', template: 'scalar-control', count: 20_000 },
  { id: 'fixed-vector-medium', template: 'fixed-vector', count: 75_000, python: 'numpy.py' },
  { id: 'record-value-medium', template: 'record-value', count: 75_000, python: 'numpy.py' }
]);

for (const benchmarkCase of cases) {
  const destination = resolve(published, benchmarkCase.id);
  mkdirSync(destination, { recursive: true });
  for (const [language, normalExtension] of languages) {
    const templateExtension = language === 'python-efficient'
      ? benchmarkCase.python || normalExtension
      : normalExtension;
    const source = readFileSync(
      resolve(programs, `${benchmarkCase.template}.${templateExtension}`),
      'utf8'
    ).replaceAll('{{COUNT}}', String(benchmarkCase.count));
    if (source.includes('{{')) {
      throw new Error(`${benchmarkCase.id}/${language} contains an unresolved placeholder`);
    }
    writeFileSync(resolve(destination, `${language}.${normalExtension}`), source, 'utf8');
  }
}

console.log(`materialized ${cases.length * languages.length} exact benchmark sources`);
