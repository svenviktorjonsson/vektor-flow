"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "web", "vf-ui", "geom", "vf-geom-ledger-transport.js"),
  "utf8",
);

const window = {
  console,
  JSON,
  Date,
  SharedArrayBuffer,
  Atomics,
  Int32Array,
  Uint8Array,
  window: null,
  self: null,
};
window.window = window;
window.self = window;

vm.runInNewContext(source, window, { filename: "vf-geom-ledger-transport.js" });

assert.ok(window.VfGeomLedgerTransport);
assert.strictEqual(typeof window.VfGeomLedgerTransport.createInlineTransport, "function");
assert.strictEqual(typeof window.VfGeomLedgerTransport.createSharedBufferTransport, "function");
assert.strictEqual(window.VfGeomLedgerTransport.HEADER_SLOT_COUNT, 6);

const inline = window.VfGeomLedgerTransport.createInlineTransport({
  state: { value: 2 },
  buildSnapshot(state) {
    return { doubled: state.value * 2 };
  },
});

assert.strictEqual(inline.kind(), "inline");
assert.deepStrictEqual(JSON.parse(JSON.stringify(inline.readHeader())), {
  kind: "inline",
  revision: 0,
  presentedRevision: -1,
  source: "inline",
  error: "",
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(inline.readSnapshot())), { doubled: 4 });
inline.mutate((state) => { state.value = 5; });
assert.strictEqual(inline.readHeader().revision, 1);
assert.deepStrictEqual(JSON.parse(JSON.stringify(inline.readSnapshot())), { doubled: 10 });
inline.ackPresented(1);
assert.strictEqual(inline.readHeader().presentedRevision, 1);

const headerBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * window.VfGeomLedgerTransport.HEADER_SLOT_COUNT);
const stateBuffer = new SharedArrayBuffer(32);
const header = new Int32Array(headerBuffer);
const stateView = new Uint8Array(stateBuffer);
header[window.VfGeomLedgerTransport.HEADER_SLOT_REVISION] = 7;
header[window.VfGeomLedgerTransport.HEADER_SLOT_PRESENTED_REVISION] = 3;
header[window.VfGeomLedgerTransport.HEADER_SLOT_STATE_BYTE_LENGTH] = stateView.byteLength;
header[window.VfGeomLedgerTransport.HEADER_SLOT_STATE_FORMAT] = 42;
header[window.VfGeomLedgerTransport.HEADER_SLOT_FLAGS] = 9;
header[window.VfGeomLedgerTransport.HEADER_SLOT_ERROR_CODE] = 0;
stateView[0] = 11;
stateView[1] = 12;

const shared = window.VfGeomLedgerTransport.createSharedBufferTransport({
  headerBuffer,
  stateBuffer,
});

assert.strictEqual(shared.kind(), "shared-buffer");
assert.deepStrictEqual(JSON.parse(JSON.stringify(shared.readHeader())), {
  kind: "shared-buffer",
  revision: 7,
  presentedRevision: 3,
  stateByteLength: 32,
  stateFormat: 42,
  flags: 9,
  errorCode: 0,
});
assert.strictEqual(shared.readStateView()[0], 11);
assert.strictEqual(shared.readStateView()[1], 12);
shared.ackPresented(8);
assert.strictEqual(header[window.VfGeomLedgerTransport.HEADER_SLOT_PRESENTED_REVISION], 8);
shared.writeRevision(9);
assert.strictEqual(header[window.VfGeomLedgerTransport.HEADER_SLOT_REVISION], 9);

const hostHeaderBuffer = new ArrayBuffer(Int32Array.BYTES_PER_ELEMENT * window.VfGeomLedgerTransport.HEADER_SLOT_COUNT);
const hostStateBuffer = new ArrayBuffer(16);
const hostHeader = new Int32Array(hostHeaderBuffer);
hostHeader[window.VfGeomLedgerTransport.HEADER_SLOT_REVISION] = 2;
hostHeader[window.VfGeomLedgerTransport.HEADER_SLOT_PRESENTED_REVISION] = 1;
hostHeader[window.VfGeomLedgerTransport.HEADER_SLOT_STATE_BYTE_LENGTH] = hostStateBuffer.byteLength;
hostHeader[window.VfGeomLedgerTransport.HEADER_SLOT_STATE_FORMAT] = 1001;
hostHeader[window.VfGeomLedgerTransport.HEADER_SLOT_FLAGS] = 0;
hostHeader[window.VfGeomLedgerTransport.HEADER_SLOT_ERROR_CODE] = 0;
const hostTransport = window.VfGeomLedgerTransport.createSharedBufferTransport({
  headerBuffer: hostHeaderBuffer,
  stateBuffer: hostStateBuffer,
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(hostTransport.readHeader())), {
  kind: "shared-buffer",
  revision: 2,
  presentedRevision: 1,
  stateByteLength: 16,
  stateFormat: 1001,
  flags: 0,
  errorCode: 0,
});
hostTransport.ackPresented(3);
hostTransport.writeRevision(4);
assert.strictEqual(hostHeader[window.VfGeomLedgerTransport.HEADER_SLOT_PRESENTED_REVISION], 3);
assert.strictEqual(hostHeader[window.VfGeomLedgerTransport.HEADER_SLOT_REVISION], 4);

console.log("ok");
