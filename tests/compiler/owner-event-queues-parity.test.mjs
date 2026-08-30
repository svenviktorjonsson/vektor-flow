import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const contractSource = readFileSync(
  path.join(repositoryRoot, "web", "vf-ui", "vf-runtime-packet-contract.js"),
  "utf8",
);
const nativeOwnerEventTest = process.env.VKF_OWNER_EVENT_NATIVE_TEST;

function packet(seq, x, overrides = {}) {
  return {
    seq,
    kind: "input.event",
    payload: {
      event: {
        event: "ButtonClicked",
        widget_id: "button-0",
        frame_id: "frame-0",
        x,
        ...overrides,
      },
    },
  };
}

function summarize(event) {
  return event === null
    ? null
    : { event: event.event, widget_id: event.widget_id, frame_id: event.frame_id, x: event.x };
}

function observe(contract) {
  const fanout = contract.createInternalButtonClickedOwnerQueues({
    buttonId: "button-0",
    frameId: "frame-0",
    displayId: "display-0",
  });
  fanout.consumeRuntimePacket(packet(1, 10));
  const fanoutObservation = {
    button: summarize(fanout.button.events.get()),
    buttonEmpty: fanout.button.events.get(),
    frame: summarize(fanout.frame.events.get()),
    frameEmpty: fanout.frame.events.get(),
    display: summarize(fanout.display.events.get()),
    displayEmpty: fanout.display.events.get(),
  };

  const fifo = contract.createInternalButtonClickedOwnerQueues({
    buttonId: "button-0",
    frameId: "frame-0",
    displayId: "display-0",
  });
  fifo.consumeRuntimePacket(packet(1, 10));
  fifo.consumeRuntimePacket(packet(2, 20));
  const fifoObservation = {
    button: [fifo.button.events.get().x, fifo.button.events.get().x],
    frame: [fifo.frame.events.get().x, fifo.frame.events.get().x],
    display: [fifo.display.events.get().x, fifo.display.events.get().x],
  };

  const malformed = contract.createInternalButtonClickedOwnerQueues({
    buttonId: "button-0",
    frameId: "frame-0",
    displayId: "display-0",
  });
  let rejected = false;
  try {
    malformed.consumeRuntimePacket(packet(1, 10, { frame_id: "other-frame" }));
  } catch (error) {
    rejected = Boolean(error);
  }
  const malformedObservation = {
    rejected,
    buttonEmpty: malformed.button.events.get(),
    frameEmpty: malformed.frame.events.get(),
    displayEmpty: malformed.display.events.get(),
  };

  return JSON.parse(JSON.stringify({
    fanout: fanoutObservation,
    fifo: fifoObservation,
    malformed: malformedObservation,
  }));
}

test("ButtonClicked owner queues have native/browser FIFO and atomic rejection parity", () => {
  assert.ok(nativeOwnerEventTest, "VKF_OWNER_EVENT_NATIVE_TEST must name the native parity executable");

  const sandbox = { console, globalThis: null };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(contractSource, sandbox, { filename: "vf-runtime-packet-contract.js" });
  const identityQueues = sandbox.VfRuntimePacketContract.createInternalButtonClickedOwnerQueues({
    buttonId: "button-0",
    frameId: "frame-0",
    displayId: "display-0",
  });
  identityQueues.consumeRuntimePacket(packet(1, 10));
  const buttonEvent = identityQueues.button.events.get();
  const frameEvent = identityQueues.frame.events.get();
  const displayEvent = identityQueues.display.events.get();
  assert.notStrictEqual(buttonEvent, frameEvent);
  assert.notStrictEqual(buttonEvent, displayEvent);
  assert.notStrictEqual(frameEvent, displayEvent);

  const browserObservation = observe(sandbox.VfRuntimePacketContract);

  const native = spawnSync(nativeOwnerEventTest, [], {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(native.status, 0, native.stderr || "native owner-event parity executable failed");
  const nativeObservation = JSON.parse(native.stdout);

  assert.deepEqual(nativeObservation, browserObservation);
  assert.deepEqual(browserObservation.fanout, {
    button: { event: "ButtonClicked", widget_id: "button-0", frame_id: "frame-0", x: 10 },
    buttonEmpty: null,
    frame: { event: "ButtonClicked", widget_id: "button-0", frame_id: "frame-0", x: 10 },
    frameEmpty: null,
    display: { event: "ButtonClicked", widget_id: "button-0", frame_id: "frame-0", x: 10 },
    displayEmpty: null,
  });
  assert.deepEqual(browserObservation.fifo, {
    button: [10, 20],
    frame: [10, 20],
    display: [10, 20],
  });
  assert.deepEqual(browserObservation.malformed, {
    rejected: true,
    buttonEmpty: null,
    frameEmpty: null,
    displayEmpty: null,
  });
});
