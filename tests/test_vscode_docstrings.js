"use strict";

const assert = require("assert");
const { findFunctionSymbolAt, parseFunctionSymbols } = require("../vscode/docIndex");

const source = `
f(x:num):
  "square plus one"
  x^2 + 1

g(x) -> num:
  """square: plus one"""
  x + 1
`;

const symbols = parseFunctionSymbols(source);
assert.strictEqual(symbols.length, 2);
assert.strictEqual(symbols[0].name, "f");
assert.strictEqual(symbols[0].docstring, "square plus one");
assert.strictEqual(symbols[1].name, "g");
assert.strictEqual(symbols[1].docstring, "square: plus one");
assert.strictEqual(symbols[0].signature, "f(x:num) -> any");
assert.strictEqual(symbols[1].signature, "g(x:any) -> num");

const hover = findFunctionSymbolAt(source, 1, 0);
assert.ok(hover);
assert.strictEqual(hover.name, "f");
assert.strictEqual(hover.signature, "f(x:num) -> any");

console.log("ok");
