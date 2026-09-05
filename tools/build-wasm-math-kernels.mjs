// Run with Emscripten 4.0.14; generated runtime bytes have no host dependencies.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'compiler/native/runtime/vkf_pow_kernel.c');
const destination = path.join(root, 'compiler/native/runtime/vkf_pow_kernel.generated.hpp');
const build = path.join(root, 'build/wasm-math-kernels');
fs.mkdirSync(build, { recursive: true });
const compiler = process.env.EMCC || 'emcc';
const version = spawnSync(compiler, ['--version'], { encoding: 'utf8' });
if (version.status !== 0 || !version.stdout.includes('4.0.14')) throw new Error('Kernel generation requires Emscripten 4.0.14');
const artifact = path.join(build, 'pow.wasm');
const result = spawnSync(compiler, ['-O3', '-fno-math-errno', '-ffp-contract=off', '--no-entry', '-sSTANDALONE_WASM=1', '-sEXPORTED_FUNCTIONS=_vkf_pow_kernel', source, '-o', artifact], { encoding: 'utf8' });
if (result.status !== 0) throw new Error(result.stderr || result.error);
const bytes = fs.readFileSync(artifact);
if (!WebAssembly.validate(bytes)) throw new Error('Invalid generated kernel module');
class Reader {
  constructor(bytes) { this.bytes = bytes; this.pos = 0; }
  byte() { if (this.pos >= this.bytes.length) throw new Error('Truncated WASM'); return this.bytes[this.pos++]; }
  uleb() { let n = 0, shift = 0, b; do { b = this.byte(); n += (b & 127) * 2 ** shift; shift += 7; } while (b & 128); return n; }
  lebBytes() { const start = this.pos; while (this.byte() & 128) {} return this.bytes.subarray(start, this.pos); }
  take(n) { if (this.pos + n > this.bytes.length) throw new Error('Truncated WASM'); const out = this.bytes.subarray(this.pos, this.pos + n); this.pos += n; return out; }
  name() { return this.take(this.uleb()).toString(); }
}
function uleb(n) { const out = []; do { const b = n % 128; n = Math.floor(n / 128); out.push(b | (n ? 128 : 0)); } while (n); return out; }
const module = new Reader(bytes); module.take(8);
const sections = new Map();
while (module.pos < bytes.length) { const id = module.byte(); const section = module.take(module.uleb()); if (id) sections.set(id, section); }
if (sections.has(2)) throw new Error('Kernel module must not import anything');
const exports = new Reader(sections.get(7));
let index;
for (let n = exports.uleb(); n; --n) { const name = exports.name(), kind = exports.byte(), value = exports.uleb(); if (name === 'vkf_pow_kernel' && kind === 0) index = value; }
if (index === undefined) throw new Error('Missing power kernel');
const types = new Reader(sections.get(1)), signatures = [];
for (let n = types.uleb(); n; --n) { if (types.byte() !== 0x60) throw new Error('Unexpected type'); const params = [...types.take(types.uleb())], results = [...types.take(types.uleb())]; signatures.push({params, results}); }
const functions = new Reader(sections.get(3)), functionTypes = [];
for (let n = functions.uleb(); n; --n) functionTypes.push(functions.uleb());
if (JSON.stringify(signatures[functionTypes[index]]) !== JSON.stringify({params:[0x7c,0x7c],results:[0x7c]})) throw new Error('Unexpected kernel signature');
const code = new Reader(sections.get(10)), bodies = [];
for (let n = code.uleb(); n; --n) bodies.push(code.take(code.uleb()));
const body = new Reader(bodies[index]), groups = [];
for (let n = body.uleb(); n; --n) { const count = body.uleb(), type = body.byte(); if (![0x7f,0x7e,0x7d,0x7c].includes(type)) throw new Error('Non-numeric local'); groups.push(...uleb(count), type); }
// Tagged wrapper params occupy locals 0/1; original numeric params become 2/3.
const originalGroups = new Reader(bodies[index]).uleb();
const locals = [...uleb(originalGroups + 1), 2, 0x7c, ...groups];
const instructions = [0x02, 0x7c]; // Preserve original function label as an f64 result block.
let depth = 0;
while (body.pos < body.bytes.length) {
  const op = body.byte();
  if (op === 0x0b && depth === 0) { if (body.pos !== body.bytes.length) throw new Error('Trailing kernel bytes'); break; }
  if (op === 0x0f) { instructions.push(0x0c, ...uleb(depth)); continue; }
  instructions.push(op);
  if ([0x02,0x03,0x04].includes(op)) { instructions.push(...body.lebBytes()); depth++; }
  else if (op === 0x0b) depth--;
  else if ([0x20,0x21,0x22].includes(op)) instructions.push(...uleb(body.uleb() + 2));
  else if ([0x0c,0x0d].includes(op)) { const target = body.uleb(); if (target > depth) throw new Error('Escaping branch'); instructions.push(...uleb(target)); }
  else if (op === 0x0e) { const n = body.uleb(); instructions.push(...uleb(n)); for (let i = 0; i <= n; i++) { const target = body.uleb(); if (target > depth) throw new Error('Escaping branch table'); instructions.push(...uleb(target)); } }
  else if (op === 0x41 || op === 0x42) instructions.push(...body.lebBytes());
  else if (op === 0x43) instructions.push(...body.take(4));
  else if (op === 0x44) instructions.push(...body.take(8));
  else if (op === 0xfc) { const numeric = body.uleb(); if (numeric > 7) throw new Error('Non-numeric extended opcode'); instructions.push(...uleb(numeric)); }
  else if (![0x00,0x01,0x05,0x1a,0x1b].includes(op) && !(op >= 0x45 && op <= 0xc4)) throw new Error(`Kernel dependency or unsupported opcode 0x${op.toString(16)}`);
}
if (depth !== 0) throw new Error('Unbalanced kernel control flow');
instructions.push(0x0b);
const hash = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
const format = (values) => values.reduce((lines, value, i) => { if (i % 20 === 0) lines.push('    '); lines[lines.length-1] += `0x${value.toString(16).padStart(2,'0')},`; return lines; }, []).join('\n');
const header = `// Generated by tools/build-wasm-math-kernels.mjs; do not edit.\n// Emscripten 4.0.14; source SHA-256 ${hash}\n// Sun Microsystems 2004 permissive license: see vkf_pow_kernel.c.\n// musl MIT license: see LICENSE-musl.txt.\n#pragma once\n#include <cstdint>\nnamespace vkf::wasm::math_kernels::generated {\ninline constexpr std::uint8_t power_locals[] = {\n${format(locals)}\n};\ninline constexpr std::uint8_t power_instructions[] = {\n${format(instructions)}\n};\n}\n`;
if (process.argv.includes('--check')) {
  if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== header) throw new Error('Generated power kernel is stale');
} else if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== header) fs.writeFileSync(destination, header);
console.log(JSON.stringify({sourceSha256:hash, instructionBytes:instructions.length, dependencyFree:true}));
