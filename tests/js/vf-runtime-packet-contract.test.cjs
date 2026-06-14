const assert = require("node:assert/strict");
const contract = require("../../web/vf-ui/vf-runtime-packet-contract.js");

assert.equal(contract.PACKET_KINDS["scene.replace"], true);
assert.equal(contract.PACKET_KINDS["ui_state.replace"], true);
assert.equal(contract.PACKET_KINDS["display.replace"], true);
assert.equal(contract.PACKET_KINDS["geom.color.patch"], true);
assert.equal(contract.PACKET_KINDS["widget.append_text"], true);

assert.equal(contract.BOOTSTRAP_COALESCE_KINDS["scene.replace"], true);
assert.equal(contract.BOOTSTRAP_COALESCE_KINDS["geom.color.patch"], undefined);

assert.equal(contract.validatePacketPayload("scene.replace", { commands: [] }, "source"), "");
assert.equal(contract.validatePacketPayload("scene.replace", {}, "source"), "malformed scene.replace packet");
assert.equal(contract.validatePacketPayload("scene.replace", {}, "route"), "scene.replace packet missing commands");
assert.equal(contract.validatePacketPayload("legacy.unknown", {}, "route"), "unsupported packet kind legacy.unknown");

console.log("vf-runtime-packet-contract tests passed");
