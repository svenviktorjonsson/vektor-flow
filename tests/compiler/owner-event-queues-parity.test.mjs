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
  fifoObservation.displayEmpty = fifo.display.events.get();
  fifoObservation.defaults = [
    fifo.takeInternalDefaultEvent().x,
    fifo.takeInternalDefaultEvent().x,
  ];
  fifoObservation.defaultEmpty = fifo.takeInternalDefaultEvent();

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
  malformed.consumeRuntimePacket(packet(1, 11));
  malformedObservation.recovered = [
    summarize(malformed.button.events.get()),
    summarize(malformed.frame.events.get()),
    summarize(malformed.display.events.get()),
  ];
  malformed.completeInternalOwnerEvent(malformed.display);
  malformedObservation.defaultEvent = summarize(malformed.takeInternalDefaultEvent());

  const prevented = contract.createInternalButtonClickedOwnerQueues({
    buttonId: "button-0",
    frameIds: ["frame-inner", "frame-outer"],
    displayId: "display-0",
  });
  prevented.consumeRuntimePacket(packet(1, 30, { frame_id: "frame-inner" }));
  const preventedButton = prevented.button.events.get();
  prevented.completeInternalOwnerEvent(prevented.button, { preventDefault: true });
  const preventedInner = prevented.frames[0].events.get();
  prevented.completeInternalOwnerEvent(prevented.frames[0]);
  const preventedOuter = prevented.frames[1].events.get();
  prevented.completeInternalOwnerEvent(prevented.frames[1]);
  const preventedDisplay = prevented.display.events.get();
  prevented.completeInternalOwnerEvent(prevented.display);
  const preventedObservation = {
    owners: [preventedButton, preventedInner, preventedOuter, preventedDisplay].map(summarize),
    defaultEvent: summarize(prevented.takeInternalDefaultEvent()),
  };

  const stopped = contract.createInternalButtonClickedOwnerQueues({
    buttonId: "button-0",
    frameIds: ["frame-inner", "frame-outer"],
    displayId: "display-0",
  });
  stopped.consumeRuntimePacket(packet(1, 40, { frame_id: "frame-inner" }));
  const stoppedButton = stopped.button.events.get();
  stopped.completeInternalOwnerEvent(stopped.button, { stopPropagation: true });
  const stoppedObservation = {
    button: summarize(stoppedButton),
    inner: summarize(stopped.frames[0].events.get()),
    outer: summarize(stopped.frames[1].events.get()),
    display: summarize(stopped.display.events.get()),
    defaultEvent: summarize(stopped.takeInternalDefaultEvent()),
    defaultEmpty: summarize(stopped.takeInternalDefaultEvent()),
  };

  const normal = contract.createInternalButtonClickedOwnerQueues({
    buttonId: "button-0",
    frameIds: ["frame-inner", "frame-outer"],
    displayId: "display-0",
  });
  normal.consumeRuntimePacket(packet(1, 50, { frame_id: "frame-inner" }));
  normal.button.events.get();
  normal.completeInternalOwnerEvent(normal.button);
  normal.frames[0].events.get();
  normal.completeInternalOwnerEvent(normal.frames[0]);
  normal.frames[1].events.get();
  normal.completeInternalOwnerEvent(normal.frames[1]);
  normal.display.events.get();
  normal.completeInternalOwnerEvent(normal.display);
  const normalObservation = {
    defaultEvent: summarize(normal.takeInternalDefaultEvent()),
    defaultEmpty: summarize(normal.takeInternalDefaultEvent()),
  };

  const completion = contract.createInternalButtonClickedOwnerQueues({
    buttonId: "button-0",
    frameId: "frame-0",
    displayId: "display-0",
  });
  const foreign = contract.createInternalButtonClickedOwnerQueues({
    buttonId: "button-0",
    frameId: "frame-0",
    displayId: "display-0",
  });
  completion.consumeRuntimePacket(packet(1, 60));
  completion.button.events.get();
  let completionRejected = false;
  try {
    completion.completeInternalOwnerEvent(foreign.button, { stopPropagation: true });
  } catch (error) {
    completionRejected = Boolean(error);
  }
  completion.completeInternalOwnerEvent(completion.button, { stopPropagation: true });
  const completionObservation = {
    rejected: completionRejected,
    frame: summarize(completion.frame.events.get()),
    display: summarize(completion.display.events.get()),
    defaultEvent: summarize(completion.takeInternalDefaultEvent()),
    defaultEmpty: summarize(completion.takeInternalDefaultEvent()),
  };

  return JSON.parse(JSON.stringify({
    fanout: fanoutObservation,
    fifo: fifoObservation,
    malformed: malformedObservation,
    prevented: preventedObservation,
    stopped: stoppedObservation,
    normal: normalObservation,
    completion: completionObservation,
  }));
}

test("ButtonClicked owner queues share propagation, cancellation, and default parity", () => {
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
    displayEmpty: null,
    defaults: [10, 20],
    defaultEmpty: null,
  });
  assert.deepEqual(browserObservation.malformed, {
    rejected: true,
    buttonEmpty: null,
    frameEmpty: null,
    displayEmpty: null,
    recovered: [
      { event: "ButtonClicked", widget_id: "button-0", frame_id: "frame-0", x: 11 },
      { event: "ButtonClicked", widget_id: "button-0", frame_id: "frame-0", x: 11 },
      { event: "ButtonClicked", widget_id: "button-0", frame_id: "frame-0", x: 11 },
    ],
    defaultEvent: { event: "ButtonClicked", widget_id: "button-0", frame_id: "frame-0", x: 11 },
  });
  assert.deepEqual(browserObservation.prevented, {
    owners: [
      { event: "ButtonClicked", widget_id: "button-0", frame_id: "frame-inner", x: 30 },
      { event: "ButtonClicked", widget_id: "button-0", frame_id: "frame-inner", x: 30 },
      { event: "ButtonClicked", widget_id: "button-0", frame_id: "frame-inner", x: 30 },
      { event: "ButtonClicked", widget_id: "button-0", frame_id: "frame-inner", x: 30 },
    ],
    defaultEvent: null,
  });
  assert.deepEqual(browserObservation.stopped, {
    button: { event: "ButtonClicked", widget_id: "button-0", frame_id: "frame-inner", x: 40 },
    inner: null,
    outer: null,
    display: null,
    defaultEvent: { event: "ButtonClicked", widget_id: "button-0", frame_id: "frame-inner", x: 40 },
    defaultEmpty: null,
  });
  assert.deepEqual(browserObservation.normal, {
    defaultEvent: { event: "ButtonClicked", widget_id: "button-0", frame_id: "frame-inner", x: 50 },
    defaultEmpty: null,
  });
  assert.deepEqual(browserObservation.completion, {
    rejected: true,
    frame: null,
    display: null,
    defaultEvent: { event: "ButtonClicked", widget_id: "button-0", frame_id: "frame-0", x: 60 },
    defaultEmpty: null,
  });
});
