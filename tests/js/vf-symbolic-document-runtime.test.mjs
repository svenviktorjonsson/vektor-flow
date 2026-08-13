import test from 'node:test';
import assert from 'node:assert/strict';
import { createSymbolicDocumentRuntime } from '../../web/vf-ui/vf-symbolic-document-runtime.mjs';

test('symbolic document runtime publishes definitions between document islands', () => {
  const plans = [];
  const compiled = [];
  const compiler = {
    setDefinitions: (plan) => plans.push(structuredClone(plan)),
    previewScoped() {},
    compileScoped(source) {
      compiled.push(source);
      return { classification: source.includes('=') ? 'definition' : 'curve' };
    }
  };
  const runtime = createSymbolicDocumentRuntime({
    compiler,
    definitions: () => ({ global: ['g=1'], local: {} }),
    normalizeMath: (source) => source.replace('ax', 'a*x'),
    segmentDocument(_source, options) {
      options.compileMath('a=2');
      options.compileMath('ax');
      return { ok: true };
    }
  });
  assert.deepEqual(runtime.compile('a=2 then ax', { scopeId: 'label' }), { ok: true });
  assert.deepEqual(compiled, ['a=2', 'a*x']);
  assert.deepEqual(plans.at(-1), { global: ['g=1'], local: { label: ['a=2'] } });
});
