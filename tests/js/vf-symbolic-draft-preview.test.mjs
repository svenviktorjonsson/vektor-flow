import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createSymbolicKernel } from '../../web/vf-ui/vf-symbolic-kernel-runtime.mjs';
import {
  createSymbolicCompiler,
  createSymbolicEditorSession
} from '../../web/vf-ui/vf-symbolic-plot-controller.mjs';

const artifactRoot = new URL('../../web/vf-ui/artifacts/', import.meta.url);

async function loadKernel() {
  const wasm = await readFile(new URL('vkf-symbolic-kernel.wasm', artifactRoot));
  const manifest = JSON.parse(
    await readFile(new URL('vkf-symbolic-kernel.json', artifactRoot), 'utf8')
  );
  const { instance } = await WebAssembly.instantiate(wasm);
  return createSymbolicKernel({ instance, manifest });
}

test('emits recoverable draft LaTeX without making incomplete source executable', async () => {
  const kernel = await loadKernel();

  for (const [source, expectedLatex] of [
    ['x+', 'x + '],
    ['[1,2', '[1, 2'],
    ['(x+2', '(x + 2'],
    ['{x,y', '\\{x, y']
  ]) {
    const draft = kernel.compileDraft(source).value;
    assert.equal(draft.latex, expectedLatex, source);
    assert.equal(draft.complete, false, source);
    assert.equal(draft.recoverable, true, source);
    assert.ok(draft.diagnostics.length > 0, source);
  }
});

test('uses canonical LaTeX when the symbolic program is complete', async () => {
  const kernel = await loadKernel();
  const draft = kernel.compileDraft('x+2').value;

  assert.equal(draft.latex, 'x + 2');
  assert.equal(draft.complete, true);
  assert.equal(draft.recoverable, true);
  assert.deepEqual(draft.diagnostics, []);
});

test('renders known call structure incrementally without inventing sum execution', async () => {
  const kernel = await loadKernel();
  const partial = kernel.compileDraft('sum(k,0,4,k^2').value;

  assert.equal(partial.latex, '\\operatorname{sum}(k, 0, 4, k^{2}');
  assert.equal(partial.complete, false);
  assert.equal(partial.recoverable, true);

  const compiled = kernel.compile('sum(k,0,4,k^2)');
  assert.equal(compiled.value.latex, '\\operatorname{sum}\\left(k, 0, 4, {k}^{2}\\right)');
});

test('cancel rolls an invalid editor draft back to the latest valid executable expression', async () => {
  const kernel = await loadKernel();
  const compiler = await createSymbolicCompiler({ kernel });
  const editor = createSymbolicEditorSession({ compiler, source: 'x+2' });
  const initialProgram = editor.snapshot().program;

  editor.open();
  const incomplete = editor.update('x+');
  assert.equal(incomplete.editing, true);
  assert.equal(incomplete.source, 'x+');
  assert.equal(incomplete.latex, 'x + ');
  assert.equal(incomplete.committedSource, 'x+2');
  assert.equal(incomplete.program, initialProgram);

  const rolledBack = editor.cancel();
  assert.equal(rolledBack.editing, false);
  assert.equal(rolledBack.source, 'x+2');
  assert.equal(rolledBack.latex, 'x + 2');
  assert.equal(rolledBack.program, initialProgram);

  editor.open();
  const valid = editor.update('x+3');
  assert.equal(valid.committedSource, 'x+3');
  assert.notEqual(valid.program, initialProgram);
  editor.update('x+');

  const latestRollback = editor.cancel();
  assert.equal(latestRollback.source, 'x+3');
  assert.equal(latestRollback.latex, 'x + 3');
  assert.equal(latestRollback.program, valid.program);
});
