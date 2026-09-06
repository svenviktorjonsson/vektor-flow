import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {createSharedCompiler} from '../../web/playground/vkf-shared-compiler.mjs';
import {compareNativeOutput} from './shared-native-output.mjs';

const module=new WebAssembly.Module(await readFile(
  new URL('../../build/shared-compiler/vkf-compiler.wasm',import.meta.url)));
const compiler=createSharedCompiler({instance:new WebAssembly.Instance(module)});

test('README recursion and closure example executes unchanged',()=>{
  compareNativeOutput(compiler,`factorial(n:int) -> int:
    n <= 1?
        @: 1
    n * factorial(n - 1)

make_offset(offset:num) -> num->num:
    add(value:num) -> num: value + offset
    add

add_two: make_offset(2)

:: factorial(6)
:: add_two(5)
`,'720\n7\n');
});

test('README higher-order and lambda example executes unchanged',()=>{
  compareNativeOutput(compiler,`apply_twice(f:int->int, value:int) -> int: f(f(value))

increment(value:int) -> int: value + 3

square: (value): value^2

:: apply_twice(increment, 4)
:: square(5)
:: ((value): value + 1)(8)
`,'10\n25\n9\n');
});
