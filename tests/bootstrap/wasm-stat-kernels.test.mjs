import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const build = await mkdtemp(path.join(root, "build/wasm-stat-test-"));
const source = path.join(build, "generator.cpp");
const executable = path.join(build, "generator");
const artifact = path.join(build, "stat.wasm");
await writeFile(source, String.raw`
#include "compiler/native/vkf_wasm_vm_emitter.hpp"
#include "compiler/native/vkf_wasm_stat_kernels.hpp"
#include <fstream>
int main(int argc, char** argv) {
    using namespace vkf::wasm::vm::detail;
    using namespace vkf::wasm::stat_kernels;
    Writer module;
    for (auto byte : {0,0x61,0x73,0x6d,1,0,0,0}) module.u8(byte);
    Writer types;
    types.u32_leb(4);
    types.u8(0x60); types.u32_leb(1); types.u8(wasm_i32); types.u32_leb(1); types.u8(wasm_i32);
    types.u8(0x60); types.u32_leb(1); types.u8(wasm_f64); types.u32_leb(1); types.u8(wasm_i32);
    for (bool result : {false,true}) {
        types.u8(0x60); types.u32_leb(3);
        for (int i=0;i<3;++i) types.u8(wasm_i32);
        types.u32_leb(result ? 1 : 0); if(result) types.u8(wasm_i32);
    }
    append_section(module,1,types.take());
    Writer funcs; funcs.u32_leb(9);
    for(auto type : {0,1,2,3,3,3,3,3,3}) funcs.u32_leb(type);
    append_section(module,3,funcs.take());
    Writer memory; memory.u32_leb(1); memory.u8(0); memory.u32_leb(16);
    append_section(module,5,memory.take());
    Writer globals; globals.u32_leb(1); globals.u8(wasm_i32); globals.u8(1);
    i32_const(globals,65536); globals.u8(0x0b); append_section(module,6,globals.take());
    Writer exports; exports.u32_leb(7);
    exports.name("memory"); exports.u8(2); exports.u32_leb(0);
    unsigned index=3;
    for(auto name : {"sum","mean","variance","std","range","count"}) {
        exports.name(name); exports.u8(0); exports.u32_leb(index++);
    }
    append_section(module,7,exports.take());
    Writer code; code.u32_leb(9);
    Writer alloc; alloc.u32_leb(0); alloc.u8(0x23); alloc.u32_leb(0);
    alloc.u8(0x23); alloc.u32_leb(0); local_get(alloc,0); alloc.u8(0x6a);
    alloc.u8(0x24); alloc.u32_leb(0); alloc.u8(0x0b); code.raw(encoded_body(std::move(alloc)));
    Writer number; number.u32_leb(1); number.u32_leb(1); number.u8(wasm_i32);
    i32_const(number,16); number.u8(0x10); number.u32_leb(0); local_set(number,1);
    local_get(number,1); i32_const(number,2); i32_store(number);
    local_get(number,1); local_get(number,0); f64_store(number);
    local_get(number,1); number.u8(0x0b); code.raw(encoded_body(std::move(number)));
    code.raw(emit_numeric_visit_function<Writer>(2));
    for(auto op : {Reduction::Sum,Reduction::Mean,Reduction::Variance,Reduction::StdDev,Reduction::Range,Reduction::Count})
        code.raw(emit_reduction_function<Writer>(0,1,2,op));
    append_section(module,10,code.take());
    const auto bytes=module.take(); std::ofstream output(argv[1],std::ios::binary);
    output.write(reinterpret_cast<const char*>(bytes.data()),bytes.size());
}
`);
const compiled = spawnSync(process.env.CXX ?? "g++", ["-std=c++17", "-O0", `-I${root}`, source, "-o", executable],
  { encoding: "utf8", timeout: 120_000 });
assert.equal(compiled.status, 0, compiled.stderr);
const generated = spawnSync(executable, [artifact], { encoding: "utf8", timeout: 30_000 });
assert.equal(generated.status, 0, generated.stderr);
const module = new WebAssembly.Module(await readFile(artifact));
assert.deepEqual(WebAssembly.Module.imports(module), []);
function instance() { return new WebAssembly.Instance(module).exports; }
function invoke(api, name, value, ddof = 0, flags = 1) {
  const memory = new DataView(api.memory.buffer);
  let cursor = 32;
  function encode(value) {
    const slot=cursor; cursor+=16;
    if(Array.isArray(value)) {
      const payload=cursor; cursor+=value.length*4; cursor=(cursor+7)&~7;
      memory.setUint32(slot,4,true); memory.setUint32(slot+4,value.length,true);
      memory.setUint32(slot+8,payload,true);
      value.forEach((item,index)=>memory.setUint32(payload+index*4,encode(item),true));
    } else {
      memory.setUint32(slot,2,true); memory.setFloat64(slot+8,value,true);
    }
    return slot;
  }
  return memory.getFloat64(api[name](encode(value),ddof,flags)+8,true);
}

test("numeric reductions execute canonical stat values and nested row-major sums", () => {
  const api=instance(), values=[2,4,4,4,5,5,7,9];
  for(const [name,expected] of [["sum",40],["mean",5],["variance",4],["std",2],["range",7],["count",8]])
    assert.equal(invoke(api,name,values),expected);
  assert.equal(invoke(api,"sum",[[1,2,3],[4,5,6]]),21);
  assert.equal(invoke(api,"sum",[2,3,4]),9);
  assert.deepEqual([[1,2],[3,4],[5,6]].map(row=>invoke(api,"sum",row)),[3,7,11]);
});

test("source order, two-pass variance, ddof, and native signed-zero seeds are preserved", () => {
  const api=instance();
  assert.equal(invoke(api,"sum",[1e16,1,-1e16]),0);
  assert.equal(invoke(api,"sum",[1e16,-1e16,1]),1);
  assert.equal(invoke(api,"variance",[2,4,4,4,5,5,7,9],1),32/7);
  assert.equal(invoke(api,"std",[2,4,4,4,5,5,7,9],1),Math.sqrt(32/7));
  assert.ok(Object.is(invoke(api,"sum",[-0],0,1),-0));
  assert.ok(Object.is(invoke(api,"sum",[-0],0,0),0));
  assert.ok(Object.is(invoke(api,"mean",[-0],0,1),-0));
});

test("empty dynamic sum/count succeed; native invalid reduction boundaries trap", () => {
  const api=instance();
  assert.equal(invoke(api,"sum",[],0,2),0);
  assert.equal(invoke(api,"count",[],0,2),0);
  for(const name of ["sum","count","mean","variance","std","range"])
    assert.throws(()=>invoke(api,name,[]),WebAssembly.RuntimeError);
  for(const name of ["mean","variance","std","range"])
    assert.throws(()=>invoke(api,name,[],0,2),WebAssembly.RuntimeError);
  for(const name of ["variance","std"])
    assert.throws(()=>invoke(api,name,[1,2],2),WebAssembly.RuntimeError);
});

test("range preserves native SSE unordered and later-operand behavior", () => {
  const api=instance();
  assert.equal(invoke(api,"range",[NaN,1,3]),2);
  assert.ok(Number.isNaN(invoke(api,"range",[1,3,NaN])));
  assert.equal(invoke(api,"range",[1,NaN,3]),0);
  assert.ok(Number.isNaN(invoke(api,"variance",[Infinity,1])));
});

test("canonical stat example native executable remains the oracle", async () => {
  const nativeSource=path.join(build,"canonical.vkf");
  await writeFile(nativeSource,await readFile(path.join(root,"examples/generated/readme/stdlib/02-stat.vkf")));
  const result=spawnSync(process.env.VKF_NATIVE_COMPILER ?? path.join(root,"build/native-compiler-docker/bin/vkf-strict"),
    [nativeSource],{encoding:"utf8",timeout:30_000});
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stdout,"5\n4\n2\n7\n21\n[5, 7, 9]\n[6, 15]\n");
});

test("runtime reductions agree with compiled native reductions for small and large fixed inputs", async () => {
  const nativeSource=path.join(build,"native-parity.vkf");
  const datasets=[
    [0.125,-3.25,17.5,0.0625,-1.25],
    [1e16,1,-1e16],
    [1e16,-1e16,1],
    Array.from({length:101},(_,index)=>((index*37)%103-51)/8),
    [[1.25,2.5,-3.125],[4.0625,-5.5,6.75]],
  ];
  const calls=[];
  const text=[];
  for(const name of ["sum","mean","variance","std","range","count"])
    text.push(`fixed_${name}(values:[num:101]) -> num: stat.${name}(values)`);
  datasets.forEach((values,index)=> {
    text.push(`values_${index}: ${JSON.stringify(values)}`);
    for(const name of ["sum","mean","variance","std","range","count"]) {
      text.push(`:: stat.${name}(values_${index})`);
      calls.push({name,values,flags:values.flat(Infinity).length>=16?0:1});
    }
  });
  for(const name of ["sum","mean","variance","std","range","count"]) {
    text.push(`:: fixed_${name}(values_3)`);
    calls.push({name,values:datasets[3],flags:0});
  }
  await writeFile(nativeSource,text.join("\n")+"\n");
  const result=spawnSync(process.env.VKF_NATIVE_COMPILER ?? path.join(root,"build/native-compiler-docker/bin/vkf-strict"),
    [nativeSource],{encoding:"utf8",timeout:30_000});
  assert.equal(result.status,0,result.stderr);
  const expected=result.stdout.trim().split("\n").map(Number);
  assert.equal(expected.length,calls.length,result.stdout);
  const api=instance();
  calls.forEach(({name,values,flags},index)=>assert.equal(invoke(api,name,values,0,flags),expected[index],
    `${name} dataset ${Math.floor(index/6)}`));
});

test("native borrowed aggregate reductions use their argument storage in both passes",async()=>{
  const nativeSource=path.join(build,"borrowed-parity.vkf");
  const operations=["sum","mean","variance","std","range","count"];
  await writeFile(nativeSource,operations.map(name=>`fixed_${name}(values:[num:101]) -> num: stat.${name}(values)`).join("\n")
    +"\nvalues: 0.1[..100]\n"+operations.map(name=>`:: fixed_${name}(values)`).join("\n")+"\n");
  const values=Array.from({length:101},(_,index)=>0.1*index);
  const api=instance();
  const result=spawnSync(process.env.VKF_NATIVE_COMPILER ?? path.join(root,"build/native-compiler-docker/bin/vkf-strict"),
    [nativeSource],{encoding:"utf8",timeout:30_000});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(result.stdout.trim().split("\n").map(Number),operations.map(name=>invoke(api,name,values,0,0)));
});
