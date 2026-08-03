import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createSymbolicKernel } from '../../web/vf-ui/vf-symbolic-kernel-runtime.mjs';
import { createSymbolicCompiler } from '../../web/vf-ui/vf-symbolic-plot-controller.mjs';

const artifactRoot = new URL('../../web/vf-ui/artifacts/', import.meta.url);

async function createCompiler() {
  const wasm = await readFile(new URL('vkf-symbolic-kernel.wasm', artifactRoot));
  const manifest = JSON.parse(
    await readFile(new URL('vkf-symbolic-kernel.json', artifactRoot), 'utf8')
  );
  const { instance } = await WebAssembly.instantiate(wasm);
  const kernel = createSymbolicKernel({ instance, manifest });
  return createSymbolicCompiler({ kernel });
}

test('compiles prose and executable mathematics as one symbolic document', async () => {
  const compiler = await createCompiler();
  const document = compiler.compileDocument('This function x^2 has 2 roots.', {
    profile: 'platonic'
  });

  assert.equal(
    document.latex,
    '\\mathrm{This\\ function\\ }{x}^{2}\\mathrm{\\ has\\ 2\\ roots.}'
  );
  assert.equal(document.complete, true);
  assert.equal(document.recoverable, true);
  assert.equal(document.plottable, true);
  assert.deepEqual(document.diagnostics, []);
  assert.equal(document.programs.length, 1);
  assert.equal(document.programs[0].source, 'x^2');
  assert.equal(document.programs[0].start, 14);
  assert.equal(document.programs[0].end, 17);
  assert.equal(document.programs[0].result.classification, 'y-of-x');
  assert.equal(document.programs[0].program.variants.length, 1);
  assert.deepEqual(
    document.spans.map(({ kind, source }) => ({ kind, source })),
    [
      { kind: 'text', source: 'This function ' },
      { kind: 'math', source: 'x^2' },
      { kind: 'text', source: ' has 2 roots.' }
    ]
  );
  assert.deepEqual(compiler.compileDocumentPrograms(
    'This function x^2 has 2 roots.',
    { profile: 'platonic' }
  ), document.programs);
});

test('preserves opaque KaTeX and slash commands as non-executable math presentation', async () => {
  const compiler = await createCompiler();
  const integral = compiler.compileDocument(String.raw`\int_V f(r)\,dV`, {
    profile: 'platonic'
  });
  assert.equal(integral.latex, String.raw`\int_V f(r)\,dV`);
  assert.equal(integral.plottable, false);
  assert.equal(integral.programs.length, 0);
  assert.equal(integral.spans[0].kind, 'raw-katex');

  const alpha = compiler.compileDocument('/alpha', { profile: 'platonic' });
  assert.equal(alpha.latex, String.raw`\alpha`);
  assert.equal(alpha.plottable, false);
});

test('uses the Platonic profile for xy and groups multiple executable islands', async () => {
  const compiler = await createCompiler();
  const xy = compiler.compileDocument('xy', { profile: 'platonic' });
  assert.equal(xy.programs[0].result.classification, 'scalar-field');
  assert.deepEqual(xy.programs[0].result.variables, ['x', 'y']);

  const mixed = compiler.compileDocument('Compare x^2 and y^2', { profile: 'platonic' });
  assert.equal(mixed.programs.length, 2);
  assert.equal(mixed.result.classification, 'plot-group');
  assert.equal(mixed.plottable, true);
});

test('preserves coordinate alias spelling while compiling its semantic meaning', async () => {
  const compiler = await createCompiler();
  const radial = compiler.compileDocument('r', { profile: 'platonic' });

  assert.equal(radial.source, 'r');
  assert.equal(radial.latex, 'r');
  assert.equal(radial.spans[0].source, 'r');
  assert.deepEqual(radial.programs[0].result.variables, ['x', 'y']);
  assert.equal(radial.programs[0].result.classification, 'scalar-field');
});

test('keeps prose upright and exposes explicit italic letter modifiers', async () => {
  const compiler = await createCompiler();
  const document = compiler.compileDocument('a /a /i /I', { profile: 'platonic' });

  assert.equal(document.latex, String.raw`\mathrm{a\ }a\mathrm{\ }i\mathrm{\ }I`);
  assert.equal(document.programs.length, 0);
  assert.deepEqual(document.spans.map(({ kind }) => kind), [
    'text', 'raw-katex', 'text', 'raw-katex', 'text', 'raw-katex'
  ]);
});
