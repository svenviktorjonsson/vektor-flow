import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const runtimeContract = require("../../web/vf-ui/vf-runtime-packet-contract.js");
const nativeBin = process.env.VKF_NATIVE_COMPILER_BIN;

function compilerTool(name) {
  assert.ok(nativeBin, "VKF_NATIVE_COMPILER_BIN must name the focused native build directory");
  return path.join(nativeBin, process.platform === "win32" ? `${name}.exe` : name);
}

function compileSource(source) {
  const run = (name, input, args = []) => {
    const result = spawnSync(compilerTool(name), args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      input,
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr || `${name} failed without diagnostics`);
    return result.stdout;
  };
  const tokens = run("vkf_lexer_cursor_smoke", undefined, [source]);
  const ast = run("vkf_parser_token_stream_smoke", tokens);
  return JSON.parse(run("vkf_ast_to_ir_smoke", ast));
}

function geometryPacket(seq, target) {
  return {
    seq,
    kind: "input.event",
    payload: { event: { event: "MouseButtonPressed", target } },
  };
}

test("compiled Display events poll one geometry pick with its public Layer target", () => {
  const typedIr = compileSource([
    ": .ui.display",
    "display: Display(dim:2)",
    "event: display.events.get()",
  ].join("\n"));
  const event = typedIr.body.find(
    ({ kind, name }) => kind === "store_binding" && name === "event",
  );
  assert.deepEqual(event.value, {
    kind: "ui_owner_event_get",
    owner: { kind: "load", name: "display", type: "Display<2>" },
    owner_kind: "Display",
    type: "DisplayEvent|null",
  });

  const queues = runtimeContract.createInternalGeometryPickOwnerQueues({
    layerId: 7,
    displayId: "display-0",
  });
  queues.consumeRuntimePacket(geometryPacket(1, {
    layer_id: 7,
    type: "Face",
    u: 2,
    v: 5,
  }));
  assert.throws(
    () => runtimeContract.executeInternalOwnerEventPoll({
      ...event.value,
      owner: { ...event.value.owner, name: "other" },
    }, { display: queues.display }),
    /owner event poll is malformed/u,
  );
  const picked = runtimeContract.executeInternalOwnerEventPoll(event.value, {
    display: queues.display,
  });
  assert.equal(Object.hasOwn(picked, "event"), false);
  assert.deepEqual(picked.target, {
    layer_id: 7,
    type: "Face",
    u: 2,
    v: 5,
  });
  assert.equal(runtimeContract.executeInternalOwnerEventPoll(event.value, {
    display: queues.display,
  }), null);
});

test("geometry pick validation is atomic and preserves independent owner queues", () => {
  const queues = runtimeContract.createInternalGeometryPickOwnerQueues({
    layerId: 7,
    frameId: "frame-0",
    displayId: "display-0",
  });
  for (const target of [{
      layer_id: 8,
      type: "Face",
      u: 2,
      v: 5,
    }, {
      layer_id: 7,
      type: "Cell",
      u: 2,
      v: 5,
    }, {
      layer_id: 7,
      type: "Face",
      u: 2.5,
      v: 5,
    }]) {
    assert.throws(
      () => queues.consumeRuntimePacket(geometryPacket(1, target)),
      /geometry pick target/u,
    );
  }
  assert.equal(queues.frame.events.get(), null);
  assert.equal(queues.display.events.get(), null);

  queues.consumeRuntimePacket(geometryPacket(1, {
    layer_id: 7,
    type: "Face",
    u: 2,
    v: 5,
  }));
  const frameEvent = queues.frame.events.get();
  const displayEvent = queues.display.events.get();
  assert.notEqual(frameEvent, displayEvent);
  assert.notEqual(frameEvent.target, displayEvent.target);
  assert.deepEqual([frameEvent.target, displayEvent.target], [
    { layer_id: 7, type: "Face", u: 2, v: 5 },
    { layer_id: 7, type: "Face", u: 2, v: 5 },
  ]);
  queues.consumeRuntimePacket(geometryPacket(2, {
    layer_id: 7,
    type: "Edge",
    edge: 3,
  }));
  queues.consumeRuntimePacket(geometryPacket(3, {
    layer_id: 7,
    type: "Vertex",
    vertex: 4,
  }));
  assert.deepEqual([
    queues.display.events.get().target,
    queues.display.events.get().target,
  ], [
    { layer_id: 7, type: "Edge", edge: 3 },
    { layer_id: 7, type: "Vertex", vertex: 4 },
  ]);
  assert.deepEqual([
    queues.frame.events.get().target,
    queues.frame.events.get().target,
  ], [
    { layer_id: 7, type: "Edge", edge: 3 },
    { layer_id: 7, type: "Vertex", vertex: 4 },
  ]);
});
