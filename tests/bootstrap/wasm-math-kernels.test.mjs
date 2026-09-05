import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const build = await mkdtemp(path.join(root, "build/wasm-math-test-"));
const source = path.join(build, "generator.cpp");
const executable = path.join(build, "generator");
const artifact = path.join(build, "math.wasm");
await writeFile(source, String.raw`
#include "compiler/native/vkf_wasm_vm_emitter.hpp"
#include <cmath>
#include <fstream>
#include <iostream>
int main(int argc, char** argv) {
    if (argc == 2 && std::string(argv[1]) == "--power-oracle") {
        double input[2];
        while (std::cin.read(reinterpret_cast<char*>(input), sizeof(input))) {
            const double output[] = {std::pow(input[0], input[1]), std::exp(input[0])};
            std::cout.write(reinterpret_cast<const char*>(output), sizeof(output));
        }
        return 0;
    }
    if (argc == 2 && std::string(argv[1]) == "--oracle") {
        double input;
        while (std::cin.read(reinterpret_cast<char*>(&input), sizeof(input))) {
            const double output[] = {std::sin(input), std::cos(input), std::log(input)};
            std::cout.write(reinterpret_cast<const char*>(output), sizeof(output));
        }
        return 0;
    }
    using namespace vkf::wasm::vm::detail;
    const unsigned prefix = argc == 3 ? 130 : 0;
    Writer module;
    for (auto byte : {0x00,0x61,0x73,0x6d,0x01,0x00,0x00,0x00}) module.u8(byte);
    Writer types;
    types.u32_leb(3);
    for (auto input : {wasm_f64, wasm_i32}) {
        types.u8(0x60); types.u32_leb(1); types.u8(input); types.u32_leb(1); types.u8(wasm_i32);
    }
    types.u8(0x60); types.u32_leb(2); types.u8(wasm_i32); types.u8(wasm_i32);
    types.u32_leb(1); types.u8(wasm_i32);
    append_section(module, 1, types.take());
    Writer functions;
    functions.u32_leb(6 + prefix);
    for (unsigned i=0; i<prefix; ++i) functions.u32_leb(0);
    for (auto type : {0,1,1,1,1,2}) functions.u32_leb(type);
    append_section(module, 3, functions.take());
    Writer memory;
    memory.u32_leb(1); memory.u8(0); memory.u32_leb(1);
    append_section(module, 5, memory.take());
    Writer exports;
    exports.u32_leb(6);
    exports.name("memory"); exports.u8(2); exports.u32_leb(0);
    unsigned index=1 + prefix;
    for (const auto name : {"sine", "cosine", "logarithm", "exponential", "power"}) {
        exports.name(name); exports.u8(0); exports.u32_leb(index++);
    }
    append_section(module, 7, exports.take());
    Writer code;
    code.u32_leb(6 + prefix);
    for (unsigned i=0; i<prefix; ++i) {
        Writer dummy; dummy.u32_leb(0); i32_const(dummy,0); dummy.u8(0x0b);
        code.raw(encoded_body(std::move(dummy)));
    }
    Writer make_number;
    make_number.u32_leb(0);
    i32_const(make_number,16); local_get(make_number,0); f64_store(make_number);
    i32_const(make_number,16); make_number.u8(0x0b);
    code.raw(encoded_body(std::move(make_number)));
    code.raw(emit_sine_function(prefix,0.0));
    code.raw(emit_sine_function(prefix,1.5707963267948966192));
    code.raw(emit_natural_log_function(prefix));
    code.raw(emit_exponential_function(prefix));
    code.raw(emit_power_function(prefix));
    append_section(module,10,code.take());
    const auto bytes=module.take();
    std::ofstream output(argv[1],std::ios::binary);
    output.write(reinterpret_cast<const char*>(bytes.data()),bytes.size());
}
`);
const compiled = spawnSync(process.env.CXX ?? "g++", ["-std=c++17", "-O0", `-I${root}`,
  source, "-o", executable], { encoding: "utf8", timeout: 120_000 });
assert.equal(compiled.status, 0, compiled.stderr);
const generated = spawnSync(executable, [artifact], { encoding: "utf8", timeout: 30_000 });
assert.equal(generated.status, 0, generated.stderr);
const module = new WebAssembly.Module(await readFile(artifact));
assert.deepEqual(WebAssembly.Module.imports(module), []);
const api = (await WebAssembly.instantiate(module)).exports;
function invoke(name, value) {
  const memory = new DataView(api.memory.buffer);
  memory.setFloat64(8, value, true);
  return memory.getFloat64(api[name](0) + 8, true);
}
function power(base, exponent) {
  const memory=new DataView(api.memory.buffer);
  memory.setFloat64(8,base,true); memory.setFloat64(40,exponent,true);
  return memory.getFloat64(api.power(0,32)+8,true);
}

test("generated power runtime records its canonical source hash", async()=>{
  const kernel=await readFile(path.join(root,"compiler/native/runtime/vkf_pow_kernel.c"));
  const header=await readFile(path.join(root,"compiler/native/runtime/vkf_pow_kernel.generated.hpp"),"utf8");
  assert.ok(header.includes(createHash("sha256").update(kernel).digest("hex")));
});

test("numeric kernel relocation preserves branches, locals and multi-byte function indices",async()=>{
  const shifted=path.join(build,"shifted.wasm");
  const generated=spawnSync(executable,[shifted,"--shifted"],{encoding:"utf8",timeout:30_000});
  assert.equal(generated.status,0,generated.stderr);
  const module=new WebAssembly.Module(await readFile(shifted));
  assert.deepEqual(WebAssembly.Module.imports(module),[]);
  const shiftedApi=(await WebAssembly.instantiate(module)).exports;
  const memory=new DataView(shiftedApi.memory.buffer);
  for(const [x,y] of [[11.5,4.5],[Number.MIN_VALUE,-0.25],[-3,3],[0,-2],[NaN,0]]) {
    memory.setFloat64(8,x,true); memory.setFloat64(40,y,true);
    assert.equal(memory.getFloat64(shiftedApi.power(0,32)+8,true),power(x,y));
  }
  memory.setFloat64(8,9.2,true);
  assert.equal(memory.getFloat64(shiftedApi.exponential(0)+8,true),invoke("exponential",9.2));
});

test("fractional powers retain their exponent instead of truncating to an integer",()=>{
  for(const [base,exponent] of [[11.5,4.5],[9,0.5],[27,1/3],[2,0.25]]) {
    const expected=Math.pow(base,exponent), actual=power(base,exponent);
    assert.ok(Math.abs(actual-expected)<=1e-12,`${base}^${exponent}=${actual}, native=${expected}`);
  }
});

test("exponential IEEE boundaries terminate without integer-conversion traps",()=>{
  assert.equal(invoke("exponential",Infinity),Infinity);
  assert.equal(invoke("exponential",-Infinity),0);
  assert.ok(Number.isNaN(invoke("exponential",NaN)));
  assert.equal(invoke("exponential",Number.MAX_VALUE),Infinity);
  assert.equal(invoke("exponential",-Number.MAX_VALUE),0);
});

function nativePowerOracle(points) {
  const input=Buffer.alloc(points.length*16);
  points.forEach(([x,y],index)=>{input.writeDoubleLE(x,index*16); input.writeDoubleLE(y,index*16+8);});
  const result=spawnSync(executable,["--power-oracle"],{input,timeout:30_000,maxBuffer:input.length+1024});
  assert.equal(result.status,0,result.stderr?.toString());
  assert.equal(result.stdout.length,input.length);
  return points.map((_,index)=>[result.stdout.readDoubleLE(index*16),result.stdout.readDoubleLE(index*16+8)]);
}

test("power matches native integer, negative-base, zero and non-finite semantics",()=>{
  const edges=[NaN,Infinity,-Infinity,-0,0,1,-1,2,-2,0.5,-0.5];
  const exponents=[NaN,Infinity,-Infinity,-0,0,0.5,-0.5,1,-1,2,-2,3,-3,2147483648,9007199254740991,9007199254740992,Number.MAX_VALUE];
  const points=edges.flatMap(x=>exponents.map(y=>[x,y]));
  points.push([2,-1074],[2,-1075],[2,1023],[2,1024],[3,12],[3,-12]);
  const expected=nativePowerOracle(points);
  points.forEach(([x,y],index)=>{
    const actual=power(x,y), reference=expected[index][0];
    if(Number.isNaN(reference)) assert.ok(Number.isNaN(actual),`pow(${x},${y})=${actual}, expected NaN`);
    else if(!Number.isFinite(reference)||reference===0) assert.ok(Object.is(actual,reference),`pow(${x},${y})=${actual}, expected ${reference}`);
    else assert.ok(Math.abs(actual-reference)<=1e-12,`pow(${x},${y})=${actual}, native=${reference}`);
  });
});

test("finite exponential and fractional-power samples retain the existing accuracy gate",()=>{
  const points=[];
  for(let index=0;index<=200;index++) points.push([(index-100)/10,0.5]);
  for(const x of [Number.MIN_VALUE,0.001,0.1,0.25,0.9,1,1.01,2,3,8,11.5,100])
    for(const y of [-1.25,-0.5,-0.25,0.1,0.25,0.5,0.75,1.25]) points.push([x,y]);
  const expected=nativePowerOracle(points);
  points.forEach(([x,y],index)=>{
    const reference=expected[index][0],actual=power(x,y);
    if(Number.isNaN(reference)) assert.ok(Number.isNaN(actual));
    else if(!Number.isFinite(reference)) assert.equal(actual,reference);
    else assert.ok(Math.abs(actual-reference)<=1e-12,`pow(${x},${y})=${actual}, native=${reference}`);
    if(x>=-10&&x<=10) {
      const result=invoke("exponential",x),oracle=expected[index][1];
      assert.ok(Math.abs(result-oracle)<=1e-12,`exp(${x})=${result}, native=${oracle}`);
    }
  });
});

test("compiled sine returns exactly one at pi/2", () => {
  assert.equal(invoke("sine", Math.PI / 2), 1);
});

test("all 101 canonical sine samples preserve the existing 1e-12 tolerance", () => {
  for (let index = 0; index <= 100; index++) {
    const x = 0.1 * index;
    const actual = invoke("sine", x);
    assert.ok(Math.abs(actual - Math.sin(x)) <= 1e-12, `${index}: sin(${x})=${actual}, expected ${Math.sin(x)}`);
  }
});

test("negative samples and quadrant neighbors use the same trigonometric kernel", () => {
  const points = [-0, ...Array.from({length:201}, (_, index) => (index - 100) / 10)];
  for (let multiple = -8; multiple <= 8; multiple++) {
    points.push(multiple * Math.PI / 2 - 1e-10, multiple * Math.PI / 2, multiple * Math.PI / 2 + 1e-10);
  }
  for (const x of points) {
    for (const [name, oracle] of [["sine", Math.sin], ["cosine", Math.cos]]) {
      const actual = invoke(name, x);
      assert.ok(Math.abs(actual - oracle(x)) <= 1e-12, `${name}(${x})=${actual}, expected ${oracle(x)}`);
    }
  }
  assert.ok(Object.is(invoke("sine", -0), -0));
  assert.equal(invoke("cosine", 0), 1);
  assert.equal(invoke("cosine", -0), 1);
  for (const x of [Infinity, -Infinity, NaN]) {
    assert.ok(Number.isNaN(invoke("sine", x)));
    assert.ok(Number.isNaN(invoke("cosine", x)));
  }
});

test("existing finite positive logarithm accuracy is measured independently", () => {
  const points = [Number.MIN_VALUE, 1e-100, 0.1, 0.5, 1, 1.5, 2, 3, 8, 10, 1e100, Number.MAX_VALUE];
  for (let exponent = -1074; exponent <= 1023; exponent += 17) {
    for (const mantissa of [1, 1.1, 1.9]) points.push(mantissa * 2 ** exponent);
  }
  for (const x of points) {
    const actual = invoke("logarithm", x);
    assert.ok(Math.abs(actual - Math.log(x)) <= 1e-12, `ln(${x})=${actual}, expected ${Math.log(x)}`);
  }
});

test("logarithm preserves native boundary results and terminates on non-finite inputs", () => {
  assert.equal(invoke("logarithm", -0), -Infinity);
  assert.equal(invoke("logarithm", 0), -Infinity);
  assert.equal(invoke("logarithm", Infinity), Infinity);
  for (const x of [-1, -Infinity, NaN]) assert.ok(Number.isNaN(invoke("logarithm", x)));
});

test("large finite trigonometric arguments preserve the existing 1e-12 accuracy gate", (context) => {
  const observations = [];
  for (const x of [1e3, 1e6, 1e12, 1e20, 1e100, Number.MAX_VALUE]) {
    for (const [name, oracle] of [["sine", Math.sin], ["cosine", Math.cos]]) {
      const actual = invoke(name, x);
      observations.push({ function: name, x, actual: String(actual), expected: oracle(x),
        error: String(Math.abs(actual - oracle(x))), tolerancePassed: Math.abs(actual - oracle(x)) <= 1e-12 });
      assert.ok(Number.isFinite(actual) && Math.abs(actual - oracle(x)) <= 1e-12,
        `${name}(${x})=${actual}, expected ${oracle(x)}`);
    }
  }
  context.diagnostic(`Large finite input observations: ${JSON.stringify(observations)}`);
});

test("all binary64 exponent bands and seeded mantissas agree with native libm", (context) => {
  const bytes = new ArrayBuffer(8);
  const view = new DataView(bytes);
  let state = 0x3e271a55;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const points = [];
  for (let exponent = 0; exponent < 2047; exponent++) {
    for (const kind of ["zero", "ones", "random"]) {
      const low = kind === "zero" ? 0 : kind === "ones" ? 0xffffffff : next();
      const highMantissa = kind === "zero" ? 0 : kind === "ones" ? 0xfffff : next() & 0xfffff;
      for (const negative of [false, true]) {
        view.setUint32(0, low, true);
        view.setUint32(4, (negative ? 0x80000000 : 0) | (exponent << 20) | highMantissa, true);
        points.push(view.getFloat64(0, true));
      }
    }
  }
  const input = Buffer.alloc(points.length * 8);
  points.forEach((value, index) => input.writeDoubleLE(value, index * 8));
  const oracle = spawnSync(executable, ["--oracle"], { input, timeout: 30_000,
    maxBuffer: input.length * 4 });
  assert.equal(oracle.status, 0, oracle.stderr?.toString());
  assert.equal(oracle.stdout.length, points.length * 24);
  let maximumTrigError = 0;
  let maximumLogError = 0;
  for (const [index, x] of points.entries()) {
    for (const [offset, name] of ["sine", "cosine"].entries()) {
      const expected = oracle.stdout.readDoubleLE(index * 24 + offset * 8);
      const actual = invoke(name, x);
      const error = Math.abs(actual - expected);
      assert.ok(Number.isFinite(actual) && error <= 1e-12,
        `${name}(${x})=${actual}; native=${expected}; error=${error}`);
      maximumTrigError = Math.max(maximumTrigError, error);
    }
    if (x > 0) {
      const expected = oracle.stdout.readDoubleLE(index * 24 + 16);
      const actual = invoke("logarithm", x);
      const error = Math.abs(actual - expected);
      assert.ok(error <= 1e-12, `ln(${x})=${actual}; native=${expected}; error=${error}`);
      maximumLogError = Math.max(maximumLogError, error);
    }
  }
  context.diagnostic(JSON.stringify({ checkedInputs: points.length, maximumTrigError, maximumLogError }));
});
