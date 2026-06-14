const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-runtime-flow.js"),
  "utf8"
);

assert.ok(source.includes("var _packetContract = global.VfRuntimePacketContract || null;"));
assert.ok(source.includes("var FALLBACK_BOOTSTRAP_COALESCE_KINDS = {"));
assert.ok(source.includes("var BOOTSTRAP_COALESCE_KINDS = _packetContract && _packetContract.BOOTSTRAP_COALESCE_KINDS || FALLBACK_BOOTSTRAP_COALESCE_KINDS;"));
assert.ok(source.includes("function coalesceBootstrapPackets(packets)"));
assert.ok(source.includes("if (getPacketRuntimeState() !== PACKET_RUNTIME_STATES.BOOTSTRAP_ONLY) { return packets; }"));
assert.ok(source.includes('ordered.push(latestByKind["scene.replace"]);'));
assert.ok(source.includes('ordered.push(latestByKind["ui_state.replace"]);'));
assert.ok(source.includes('ordered.push(latestByKind["display.replace"]);'));
assert.ok(source.includes("var routedPackets = coalesceBootstrapPackets(packets);"));

console.log("vf-runtime-flow-bootstrap-coalescing tests passed");
