const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-runtime-flow.js"),
  "utf8"
);

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function createHarness(config = {}) {
  const scheduled = [];
  const frames = [];
  const trace = [];
  const jobs = new Map();
  const sandbox = {
    Promise,
    console,
    setTimeout(callback) {
      scheduled.push(callback);
      return scheduled.length;
    },
    clearTimeout() {},
    requestAnimationFrame(callback) {
      frames.push(callback);
      return frames.length;
    },
  };
  vm.runInNewContext(source, sandbox, { filename: "vf-runtime-flow.js" });
  const packets = [{ seq: 1, kind: "scene.replace", payload: { commands: [] } }];
  const flow = sandbox.VfRuntimeFlow.createFlow({
    config,
    state: {},
    createRuntimeDependencies: () => ({
      display: {
        redrawCurrentDisplay() { trace.push("present"); },
      },
    }),
    applySceneCommands() { trace.push("poll"); },
    getRuntimeSource: () => ({
      loadPackets: async () => packets.splice(0),
    }),
    __internalRunPureDemand(plan) {
      trace.push(`start:${plan.id}`);
      const job = deferred();
      jobs.set(plan.id, job);
      return job.promise;
    },
  });
  return { flow, frames, jobs, packets, scheduled, trace };
}

const replaySafe = {
  deterministic: true,
  replay_safe: true,
  partition_candidate: true,
  requires_ordered_effects: false,
  external_process_boundary: false,
};

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

(async () => {
  const { flow, frames, jobs, packets, scheduled, trace } = createHarness();

  assert.equal(
    flow.__internalEnqueuePureDemand({
      id: "first",
      event_seq: 10,
      safety: replaySafe,
      commit(value) { trace.push(`commit:${value}`); },
    }),
    true
  );
  assert.equal(
    flow.__internalEnqueuePureDemand({
      id: "second",
      event_seq: 11,
      safety: replaySafe,
      commit(value) { trace.push(`commit:${value}`); },
    }),
    true
  );

  // Enqueueing a heavy pure demand must not execute it in the event handler.
  assert.deepEqual(trace, []);
  assert.equal(frames.length, 1);
  assert.equal(scheduled.length, 0);

  await flow.loadRuntimePackets();
  flow.displayRefresh();
  assert.deepEqual(trace, ["poll", "present"]);

  // The private executor may use a worker/backend. Completion order must not
  // change the event-order commit sequence.
  frames.shift()();
  assert.equal(scheduled.length, 1);
  assert.deepEqual(trace, ["poll", "present"]);
  scheduled.shift()();
  await flushMicrotasks();
  assert.deepEqual(trace, ["poll", "present", "start:first", "start:second"]);

  packets.push({ seq: 2, kind: "scene.replace", payload: { commands: [] } });
  await flow.loadRuntimePackets();
  flow.displayRefresh();
  assert.deepEqual(trace, [
    "poll",
    "present",
    "start:first",
    "start:second",
    "poll",
    "present",
  ]);
  jobs.get("second").resolve("second");
  await flushMicrotasks();
  assert.deepEqual(trace, [
    "poll",
    "present",
    "start:first",
    "start:second",
    "poll",
    "present",
  ]);
  jobs.get("first").resolve("first");
  await flushMicrotasks();
  assert.deepEqual(trace, [
    "poll",
    "present",
    "start:first",
    "start:second",
    "poll",
    "present",
    "commit:first",
    "commit:second",
  ]);

  // Ordered output and synchronous process operations remain barriers. The
  // private runtime must refuse to defer them rather than weakening ordering.
  assert.equal(flow.__internalEnqueuePureDemand({
    id: "print",
    event_seq: 12,
    safety: { ...replaySafe, requires_ordered_effects: true },
    commit() {},
  }), false);
  assert.equal(flow.__internalEnqueuePureDemand({
    id: "process.run",
    event_seq: 13,
    safety: { ...replaySafe, external_process_boundary: true },
    commit() {},
  }), false);
  assert.equal(scheduled.length, 0);

  const bounded = createHarness({ __internalPureDemandQueueLimit: 1 });
  assert.equal(bounded.flow.__internalEnqueuePureDemand({
    id: "bounded-first",
    event_seq: 1,
    safety: replaySafe,
    commit() {},
  }), true);
  assert.equal(bounded.flow.__internalEnqueuePureDemand({
    id: "bounded-second",
    event_seq: 2,
    safety: replaySafe,
    commit() {},
  }), false);

  console.log("vf-runtime-flow latency-priority tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
