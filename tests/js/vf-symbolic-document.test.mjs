import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createSymbolicKernel } from '../../web/vf-ui/vf-symbolic-kernel-runtime.mjs';
import { createSymbolicCompiler } from '../../web/vf-ui/vf-symbolic-plot-controller.mjs';

const artifactRoot = new URL('../../web/vf-ui/artifacts/', import.meta.url);

async function createKernel() {
  const wasm = await readFile(new URL('vkf-symbolic-kernel.wasm', artifactRoot));
  const manifest = JSON.parse(
    await readFile(new URL('vkf-symbolic-kernel.json', artifactRoot), 'utf8')
  );
  const { instance } = await WebAssembly.instantiate(wasm);
  return createSymbolicKernel({ instance, manifest });
}

async function createCompiler() {
  return createSymbolicCompiler({ kernel: await createKernel() });
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

test('classifies prose, executable math, and incomplete math as independent spans', async () => {
  const compiler = await createCompiler();
  const document = compiler.compileDocument(
    'Text sin(x) middle r=2 end y+',
    { profile: 'platonic' }
  );

  assert.deepEqual(document.spans.map(({ kind, source }) => ({ kind, source })), [
    { kind: 'text', source: 'Text ' },
    { kind: 'math', source: 'sin(x)' },
    { kind: 'text', source: ' middle ' },
    { kind: 'math', source: 'r=2' },
    { kind: 'text', source: ' end ' },
    { kind: 'math-draft', source: 'y+' }
  ]);
  assert.equal(document.complete, false);
  assert.equal(document.recoverable, true);
  assert.equal(document.plottable, true);
  assert.deepEqual(document.programs.map(({ source }) => source), ['sin(x)', 'r=2']);
  assert.deepEqual(document.programs.map(({ result }) => result.classification), [
    'y-of-x', 'implicit-curve'
  ]);
  assert.doesNotMatch(document.spans[5].latex, /\\mathrm/);
});

test('keeps identifier-like prose intact around multiple executable expressions', async () => {
  const compiler = await createCompiler();
  const document = compiler.compileDocument(
    'The curves x^2 and y^2 meet r=2',
    { profile: 'platonic' }
  );

  assert.deepEqual(document.spans.map(({ kind, source }) => ({ kind, source })), [
    { kind: 'text', source: 'The curves ' },
    { kind: 'math', source: 'x^2' },
    { kind: 'text', source: ' and ' },
    { kind: 'math', source: 'y^2' },
    { kind: 'text', source: ' meet ' },
    { kind: 'math', source: 'r=2' }
  ]);
  assert.deepEqual(document.programs.map(({ result }) => result.variables), [
    ['x'], ['y'], ['x', 'y']
  ]);

  const prose = compiler.compileDocument('syntax text time', { profile: 'platonic' });
  assert.deepEqual(prose.spans.map(({ kind, source }) => ({ kind, source })), [
    { kind: 'text', source: 'syntax text time' }
  ]);
  assert.equal(prose.programs.length, 0);
});

test('evaluates every compiled expression in a mixed document through the VKF kernel', async () => {
  const kernel = await createKernel();
  const compiler = await createSymbolicCompiler({ kernel });
  const document = compiler.compileDocument(
    'First x^2 then y^2 finally x+y',
    { profile: 'platonic' }
  );
  const expectations = new Map([
    ['x^2', 9],
    ['y^2', 16],
    ['x+y', 7]
  ]);

  assert.equal(document.programs.length, expectations.size);
  for (const { source, result } of document.programs) {
    const compiled = kernel.compile(source);
    assert.deepEqual(result.diagnostics, [], source);
    assert.equal(kernel.evaluate(compiled.handle, 3, 4), expectations.get(source), source);
  }
});

test('keeps non-executable mathematical presentation out of upright prose', async () => {
  const compiler = await createCompiler();
  const cases = [
    [String.raw`\int_V f(r)\,dV`, 'raw-katex'],
    ['x,,y', 'math-draft'],
    ['sum(k,0,4,k^2', 'math-draft'],
    ['[1,2', 'math-draft']
  ];

  for (const [source, expectedKind] of cases) {
    const document = compiler.compileDocument(source, { profile: 'platonic' });
    assert.equal(document.spans[0].kind, expectedKind, source);
    assert.equal(document.programs.length, 0, source);
    assert.equal(document.plottable, false, source);
    assert.doesNotMatch(document.latex, /\\mathrm/, source);
  }
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

test('keeps recoverable mathematical prefixes as math until they become executable', async () => {
  const compiler = await createCompiler();
  const incomplete = compiler.compileDocument('r=', { profile: 'platonic' });

  assert.equal(incomplete.latex, 'r = ');
  assert.equal(incomplete.complete, false);
  assert.equal(incomplete.recoverable, true);
  assert.equal(incomplete.plottable, false);
  assert.equal(incomplete.programs.length, 0);
  assert.equal(incomplete.spans[0].kind, 'math-draft');
  assert.equal(incomplete.spans[0].source, 'r=');
  assert.doesNotMatch(incomplete.latex, /\\mathrm/);

  const sum = compiler.compileDocument('x+', { profile: 'platonic' });
  assert.equal(sum.latex, 'x + ');
  assert.equal(sum.spans[0].kind, 'math-draft');

  const mixed = compiler.compileDocument('This function x+', { profile: 'platonic' });
  assert.equal(mixed.latex, '\\mathrm{This\\ function\\ }x + ');
  assert.equal(mixed.complete, false);
  assert.equal(mixed.plottable, false);
  assert.deepEqual(mixed.spans.map(({ kind }) => kind), ['text', 'math-draft']);
  const uncompiled = compiler.compileDocument('x,,y', { profile: 'platonic' });
  assert.equal(uncompiled.spans[0].kind, 'math-draft');
  assert.equal(uncompiled.plottable, false);
  assert.doesNotMatch(uncompiled.latex, /\\mathrm/);
  const complete = compiler.compileDocument('r=1', { profile: 'platonic' });
  assert.equal(complete.complete, true);
  assert.equal(complete.spans[0].kind, 'math');
  assert.equal(complete.programs.length, 1);

  const prose = compiler.compileDocument('hello', { profile: 'platonic' });
  assert.equal(prose.complete, true);
  assert.equal(prose.spans[0].kind, 'text');
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
