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
  { id: 'spectral-norm-small', template: 'spectral-norm', count: 100, python: 'numpy.py' },
  { id: 'spectral-norm-medium', template: 'spectral-norm', count: 250, python: 'numpy.py' },
  { id: 'spectral-norm-large', template: 'spectral-norm', count: 500, python: 'numpy.py' },
  { id: 'fannkuch-redux-small', template: 'fannkuch-redux', count: 7 },
  { id: 'fannkuch-redux-medium', template: 'fannkuch-redux', count: 8 },
  { id: 'fannkuch-redux-large', template: 'fannkuch-redux', count: 9 },
  { id: 'n-body-small', template: 'n-body', count: 1_000 },
  { id: 'n-body-medium', template: 'n-body', count: 10_000 },
  { id: 'n-body-large', template: 'n-body', count: 50_000 }
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
