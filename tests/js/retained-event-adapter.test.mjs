import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const contract = require("../../web/vf-ui/vf-runtime-packet-contract.js");
const adapterModule = require("../../web/vf-ui/vf-retained-event-adapter.js");

const program = {
  schema: "vektor-flow/retained-event-program",
  version: 1,
  rules: [{
    event: "SliderValueChanged",
    widget_id: "glass-alpha",
    actions: [{
      op: "retained_layer_patch",
      target: "frame_0",
      state: {
        geom: { meshes: [{ id: "glass", layer_id: "layer_0", alpha: 0.5 }] },
        mesh_id: "glass",
        layer_id: "layer_0",
        property: "alpha",
        value: { kind: "event_field", field: "value" },
      },
    }],
  }],
};

test("hostless retained events load once and route display patches", async () => {
  const packets = [];
  let fetches = 0;
  const adapter = adapterModule.createInternalRetainedEventAdapter({
    contract,
    fetchProgram: async () => {
      fetches += 1;
      return program;
    },
    applyRuntimePacket: (packet) => packets.push(packet),
  });

  assert.equal(await adapter.dispatch({
    event: "ButtonClicked", widget_id: "unknown", frame_id: "frame_0",
  }), false);
  assert.equal(await adapter.dispatch({
    event: "SliderValueChanged", widget_id: "glass-alpha", frame_id: "frame_0", value: 0.64,
  }), true);
  assert.equal(fetches, 1);
  assert.equal(packets.length, 1);
  assert.equal(packets[0].payload.display.geom.frame_0.meshes[0].alpha, 0.64);
});

test("hostless retained event failures are observable without packet application", async () => {
  const adapter = adapterModule.createInternalRetainedEventAdapter({
    contract,
    fetchProgram: async () => { throw new Error("missing program"); },
    applyRuntimePacket: () => assert.fail("must not apply a packet"),
  });
  await assert.rejects(
    adapter.dispatch({ event: "ButtonClicked", widget_id: "view-all", frame_id: "frame_0" }),
    /missing program/u,
  );
});
