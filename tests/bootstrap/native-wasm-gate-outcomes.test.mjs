import assert from 'node:assert/strict';
import test from 'node:test';
import {compareTestOutcome} from '../../tools/verify-native-wasm-tests.mjs';

const native = {status: 0, stdout: '', stderr: ''};
const positive = {expectedCompileError: null, compatible: true};

test('same-suite gate rejects unsupported execution, missing stdout and false diagnostic positives', () => {
  assert.equal(compareTestOutcome(positive, native, {ok: true, result: {values: []}}).passed, false);
  assert.equal(compareTestOutcome(positive, native, {ok: true, result: {stdout: '', stderr: ''}}).passed, true);
  assert.equal(compareTestOutcome(positive, native, {ok: false, phase: 'lowering', diagnostic: 'unsupported'}).passed, false);
  assert.equal(compareTestOutcome(positive, native, {ok: true, result: {values: [42]}}).passed, false);
  assert.equal(compareTestOutcome(positive, {...native, stdout: '42\n'},
    {ok: true, result: {values: [42], stdout: '42\n'}}).passed, false);
  assert.equal(compareTestOutcome(positive, {...native, stdout: '42\n'},
    {ok: true, result: {stdout: '42\n', stderr: ''}}).passed, true);
  assert.equal(compareTestOutcome(positive, {...native, status: 1}, {ok: true, result: {values: []}}).passed, false);
  const negative = {expectedCompileError: 'exact expected diagnostic'};
  assert.equal(compareTestOutcome(negative, native,
    {ok: false, phase: 'frontend', diagnostic: 'exact expected diagnostic'}).passed, true);
  assert.equal(compareTestOutcome(negative, native,
    {ok: false, phase: 'runtime', diagnostic: 'exact expected diagnostic'}).passed, false);
  assert.equal(compareTestOutcome({...negative, expectedCompileError: ''}, native,
    {ok: false, phase: 'lowering', diagnostic: 'anything'}).passed, false);
});
