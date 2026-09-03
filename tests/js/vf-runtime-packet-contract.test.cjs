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
assert.equal(contract.PACKET_KINDS["__vf_internal_html.patch"], true);
assert.equal(contract.validatePacketPayload("__vf_internal_html.patch", {
  __vf_internal_retained_html_patch: {
    version: 1,
    owner: { kind: "frame", id: "frame-0" },
    target: 0,
    mutation: { tag: 1, name: "", value: "Ready" },
  },
}, "route"), "");
assert.equal(contract.validatePacketPayload("__vf_internal_html.patch", {
  __vf_internal_retained_html_patch: {
    version: 1,
    owner: { kind: "frame", id: "frame-0" },
    target: 0,
    mutation: { tag: 2, name: "onclick", value: "unsafe()" },
  },
}, "route"), "private retained HTML patch is malformed");
assert.equal(contract.validatePacketPayload("__vf_internal_html.patch", {
  __vf_internal_retained_html_patch: {
    version: 1,
    owner: { kind: "frame", id: "frame-0" },
    target: 0,
    mutation: { tag: 1, name: "", value: "Ready", extra: true },
  },
}, "route"), "private retained HTML patch is malformed");

console.log("vf-runtime-packet-contract tests passed");
