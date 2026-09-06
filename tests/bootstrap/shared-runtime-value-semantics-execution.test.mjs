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

test('README complex example preserves native arithmetic and display',()=>{
  compareNativeOutput(compiler,`z: num(1, 2)
:: str(z)
:: str(z * z)
`,'1 + 2i\n-3 + 4i\n');
});

test('README collections example preserves map and mutable queue behavior',()=>{
  compareNativeOutput(compiler,`collections: .collections
values: collections.list(1, 2, 3)
point: collections.map(name:"origin", x:1, y:2)
queue: collections.queue()
queue.put(10)

:: values
:: point.name
:: queue.get()
:: queue.empty()
`,'[1, 2, 3]\norigin\n10\ntrue\n');
});

test('runtime chr encodes a computed Unicode scalar inside emitted WASM',()=>{
  compareNativeOutput(compiler,`ascii: 120
emoji: 128512
:: chr(ascii)
:: chr(emoji)
`,'x\n😀\n');
});

test('symbolic KaTeX preserves computed UTF-8 symbol names',()=>{
  compareNativeOutput(compiler,`:.symbolic

x: R
y: R
claim: y = sin(x) => y <= 1

:: katex(claim)
`,'y = \\sin\\left(x\\right) \\Rightarrow y \\le 1\n');
});

test('README regex example preserves named and positional captures',()=>{
  compareNativeOutput(compiler,`regex: .regex
named: regex.match("vektor", '^(?P<word>[a-z]+)$')
positional: regex.groups("vkf-101", '([a-z]+)-([0-9]+)')
:: named.word
:: positional.0
:: positional.1
`,'vektor\nvkf\n101\n');
});
