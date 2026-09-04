import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createInlineRunner } from "../../web/inline-runner.mjs";
import { createInlineExampleController } from "../../web/inline-example-controller.mjs";

test("inline runner fetches only fixed static artifacts and sends bytes to a worker", async () => {
  const requests = [];
  const messages = [];
  class WorkerStub {
    constructor(url, options) {
      this.url = url;
      this.options = options;
      WorkerStub.instances.push(this);
    }
    postMessage(message) {
      messages.push(message);
      queueMicrotask(() => this.onmessage({ data: { id: message.id, status: "ok", output: 42 } }));
    }
    terminate() { this.terminated = true; }
  }
  WorkerStub.instances = [];
  const runner = createInlineRunner({
    fetchImpl: async (url) => {
      requests.push(String(url));
      return String(url).endsWith(".wasm")
        ? { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }
        : { ok: true, json: async () => ({ schema: "test" }) };
    },
    WorkerClass: WorkerStub,
    timeoutMs: 100,
  });

  assert.deepEqual(await runner.run(":: 40 + 2"), { output: 42, packets: null });
  assert.equal(requests.length, 2);
  assert.ok(requests.every((url) => /vkf-browser-compiler\.(?:wasm|json)$/u.test(url)));
  assert.equal(messages[0].source, ":: 40 + 2");
  assert.ok(messages[0].wasm instanceof ArrayBuffer);
  assert.equal(messages[0].imports, undefined);
  assert.equal(WorkerStub.instances[0].terminated, true);
});

test("inline runner terminates an unresponsive worker", async () => {
  class WorkerStub {
    constructor() { WorkerStub.instance = this; }
    postMessage() {}
    terminate() { this.terminated = true; }
  }
  const runner = createInlineRunner({
    fetchImpl: async (url) => String(url).endsWith(".wasm")
      ? { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }
      : { ok: true, json: async () => ({ schema: "test" }) },
    WorkerClass: WorkerStub,
    timeoutMs: 5,
  });

  await assert.rejects(() => runner.run(":: while true"), /timed out; worker terminated/u);
  assert.equal(WorkerStub.instance.terminated, true);
});

test("terminal always appears below the editor and Result appears only for validated visual output", async () => {
  const events = [];
  const view = {
    start: () => events.push("start"),
    showTerminal: (value) => events.push(["terminal", value]),
    hideResult: () => events.push("hide-result"),
    showResult: (packets) => events.push(["result", packets]),
    finish: () => events.push("finish"),
  };
  const consoleController = createInlineExampleController({
    runner: { run: async () => ({ output: 42, packets: null }) },
    view,
  });
  await consoleController.run(":: 40 + 2");
  assert.deepEqual(events, ["start", ["terminal", "42"], "hide-result", "finish"]);

  events.length = 0;
  const packets = [new Uint8Array([1, 2, 3])];
  const visualController = createInlineExampleController({
    runner: { run: async () => ({ output: { packets }, packets }) },
    view,
  });
  await visualController.run(": .ui.display");
  assert.deepEqual(events, ["start", ["terminal", "Program emitted UI output."], ["result", packets], "finish"]);
});

test("terminal renders VKF console values as one output line per emitted value", async () => {
  const terminal = [];
  const controller = createInlineExampleController({
    runner: {
      run: async () => ({
        output: { kind: "console", values: [[2, 4, 6], [[2, 4], [6, 8]]] },
        packets: null,
      }),
    },
    view: {
      start: () => {},
      showTerminal: (value) => terminal.push(value),
      hideResult: () => {},
      showResult: () => {},
      finish: () => {},
    },
  });

  await controller.run("complete README vector example");
  assert.deepEqual(terminal, ["[2,4,6]\n[[2,4],[6,8]]"]);
});

test("unsupported execution reports failure without a fallback Result", async () => {
  const events = [];
  const controller = createInlineExampleController({
    runner: { run: async () => { throw new Error("unsupported source"); } },
    view: {
      start: () => {},
      showTerminal: (value) => events.push(value),
      hideResult: () => events.push("hide-result"),
      showResult: () => events.push("result"),
      finish: () => {},
    },
  });

  await controller.run("not supported");
  assert.deepEqual(events, ["unsupported source. No fallback result was rendered.", "hide-result"]);
});

test("worker exposes no host capability imports or networking path", async () => {
  const worker = await readFile(new URL("../../web/inline-runner-worker.mjs", import.meta.url), "utf8");

  assert.match(worker, /WebAssembly\.Module\.imports\(module\)/u);
  assert.match(worker, /Object\.freeze\(\{\}\)/u);
  assert.doesNotMatch(worker, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|process|localhost)\b/u);
  assert.doesNotMatch(worker, /\b(?:window|document|navigator)\b/u);
});
