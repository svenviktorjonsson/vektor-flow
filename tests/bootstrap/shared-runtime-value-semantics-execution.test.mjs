import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {createSharedCompiler} from '../../web/playground/vkf-shared-compiler.mjs';
import {compareNativeOutput} from './shared-native-output.mjs';

const module=new WebAssembly.Module(await readFile(
  new URL('../../build/shared-compiler/vkf-compiler.wasm',import.meta.url)));
const compiler=createSharedCompiler({instance:new WebAssembly.Instance(module)});

test('README block example preserves nominal constructor display identity',()=>{
  compareNativeOutput(compiler,`make_message():
    first: "hello"
    first & " world"

make_base(x:int, y:int): :

make_colored(x:int, y:int, color:str): (x:x, y:y, color:color)

message: make_message()
base: make_base(3, 4)
colored: make_colored(3, 4, "red")

:: message
:: base
:: colored.x
:: colored.color
`,'hello world\nmake_base(x:3, y:4)\n3\nred\n');
});

test('README equality example displays bits with native numeric spelling',()=>{
  compareNativeOutput(compiler,`:: [1, 2] == [1, 2]
:: [1, 2] != [1, 3]
:: [1, 2] = [1, 2]
`,'1\n1\n[1, 1]\n');
});
