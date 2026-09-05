import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {createSharedCompiler} from '../../web/playground/vkf-shared-compiler.mjs';
import {compareNativeOutput} from './shared-native-output.mjs';

const module = new WebAssembly.Module(await readFile(new URL('../../build/shared-compiler/vkf-compiler.wasm', import.meta.url)));
const compiler = createSharedCompiler({instance: new WebAssembly.Instance(module)});

test('implicit multiplication preserves all 101 range samples and edited values', () => {
  for (const scale of [0.1, 0.2]) {
    const source = `x: ${scale}[..100]\n:: x\n`;
    compareNativeOutput(compiler, source);
    const checks = Array.from({length:101}, (_, index) => `(x.${index} == ${scale * index})?!`).join('\n');
    compareNativeOutput(compiler, `x: ${scale}[..100]\n(stat.count(x) == 101)?!\n${checks}\n`, '');
  }
});

test('ordinary vector arithmetic is elementwise at each vector layer', () => {
  compareNativeOutput(compiler, ':: [1, 2, 3] + [4, 5, 6]\n', '[5, 7, 9]\n');
  compareNativeOutput(compiler, ':: [[1, 2], [3, 4]] * 3\n', '[[3, 6], [9, 12]]\n');
});

test('the sine curve evaluates every edited sample through the math intrinsic', () => {
  const checks = Array.from({length:101}, (_, index) =>
    `(abs(actual.${index} - ${Math.sin(0.1 * index)}) <= 0.000000000001)?!`).join('\n');
  compareNativeOutput(compiler,
    `:.math\nx: 0.1[..100]\nactual: sin(x)\n(stat.count(actual) == 101)?!\n${checks}\n`, '');
});

test('named axes distinguish aligned multiplication from independent dimensions', async () => {
  const source = await readFile(new URL('../../examples/introduction/named-axes.vkf', import.meta.url), 'utf8');
  compareNativeOutput(compiler, source,
    '[[1, 2, 3], [2, 4, 6], [3, 6, 9]]\n[4, 10, 18]\n[[[15, 18], [20, 24]], [[30, 36], [40, 48]]]\n');
});
