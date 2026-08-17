import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  TEXTMATE_GRAMMAR_SHA256,
  registerVektorFlowPrism,
} from '../../web/editor/prism-vektorflow.mjs';

test('Prism grammar is pinned to the VS Code TextMate grammar', async () => {
  const grammar = await readFile(new URL('../../vscode/syntaxes/vektorflow.tmLanguage.json', import.meta.url));
  assert.equal(createHash('sha256').update(grammar).digest('hex'), TEXTMATE_GRAMMAR_SHA256);
});

test('Prism grammar registers VKF aliases and language-specific tokens', () => {
  const Prism = { languages: {} };
  const grammar = registerVektorFlowPrism(Prism);

  assert.equal(Prism.languages.vkf, grammar);
  assert.match(':.math', grammar.module.pattern);
  assert.match('math.sin(', grammar['stdlib-call'].pattern);
  assert.match('value: 3', grammar.binding.pattern);
  assert.match(':::', grammar['line-print-sugar'].pattern);
  assert.match('native_scene', grammar.variable);
});
