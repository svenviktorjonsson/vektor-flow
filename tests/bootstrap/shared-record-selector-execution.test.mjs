import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {createSharedCompiler} from '../../web/playground/vkf-shared-compiler.mjs';
import {compareNativeOutput} from './shared-native-output.mjs';

const module=new WebAssembly.Module(await readFile(
  new URL('../../build/shared-compiler/vkf-compiler.wasm',import.meta.url)));
const compiler=createSharedCompiler({instance:new WebAssembly.Instance(module)});

test('dynamic record selectors preserve authored result order',()=>{
  compareNativeOutput(compiler,`SelectorPoint(x:num, y:num): (x:x, y:y)
select_coordinate(point:SelectorPoint, name:str) -> num:
    point.(name)
point: SelectorPoint(7, 8)
:: [select_coordinate(point, "y"), select_coordinate(point, "x")]
`,'[8, 7]\n');
});

test('dynamic record selectors preserve string values and local records',()=>{
  compareNativeOutput(compiler,`StringPair(first:str, second:str): (first:first, second:second)
select_text(pair:StringPair, name:str) -> str:
    picked: pair.(name)
    picked
select_local(name:str) -> str:
    pair: StringPair("local-left", "local-right")
    pair.(name)
pair: StringPair("left", "right")
:: [select_text(pair, "first"), select_text(pair, "second"), select_local("second")]
`,'[left, right, local-right]\n');
});

test('dynamic record selector missing keys preserve the canonical error message',()=>{
  compareNativeOutput(compiler,`SelectorPoint(x:num, y:num): (x:x, y:y)
point: SelectorPoint(7, 8)
name: "missing"
message: "none"
point.(name)!?
    errors.Error => .message: $.message
:: message
`,'unknown record selector key\n');
});

test('dynamic record selectors prefer real fields before compiler-resolved fallback',()=>{
  compareNativeOutput(compiler,`FallbackPair: (x:num, y:num)
.(pair:FallbackPair, key:str) -> num:
    key == "left"? @: pair.x
    @: 0
select(pair:FallbackPair, key:str) -> num:
    pair.(key)
FallbackPair pair: (x:9, y:10)
:: [select(pair, "x"), select(pair, "left"), select(pair, "missing")]
`,'[9, 9, 0]\n');
});

test('heterogeneous and reflected selectors retain tuple value equality',()=>{
  compareNativeOutput(compiler,`SelectorRow(label:str, count:num): (label:label, count:count)
row: SelectorRow("three", 3)
(row.(["count", "label"]) == (3.0, "three"))?!
(row.([:row]) == ("three", 3.0))?!
:: "ok"
`,'ok\n');
});
