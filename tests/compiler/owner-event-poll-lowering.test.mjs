import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test, { after } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const require = createRequire(import.meta.url);
const runtimeContract = require("../../web/vf-ui/vf-runtime-packet-contract.js");
const runtimeBridge = require("../../web/vf-ui/vf-compiled-runtime-bridge.js");
const nativeBin = process.env.VKF_NATIVE_COMPILER_BIN;
const workRoot = path.join(repositoryRoot, ".work", `040-u05-${process.pid}`);

after(async () => {
  await rm(workRoot, { recursive: true, force: true });
});

function compilerTool(name) {
  assert.ok(nativeBin, "VKF_NATIVE_COMPILER_BIN must name the focused native build directory");
  return path.join(nativeBin, process.platform === "win32" ? `${name}.exe` : name);
}

function runCompilerStage(name, input, args = []) {
  const result = spawnSync(compilerTool(name), args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    input,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || `${name} failed without diagnostics`);
  return result.stdout;
}

function compileSource(source) {
  const tokens = runCompilerStage("vkf_lexer_cursor_smoke", undefined, [source]);
  const ast = runCompilerStage("vkf_parser_token_stream_smoke", tokens);
  return JSON.parse(runCompilerStage("vkf_ast_to_ir_smoke", ast));
}

function buttonClickedPacket() {
  return {
    seq: 1,
    kind: "input.event",
    payload: {
      event: {
        event: "ButtonClicked",
        widget_id: "button-0",
        frame_id: "frame-0",
      },
    },
  };
}

test("compiled button.events.get returns ButtonEvent then null", () => {
  const typedIr = compileSource([
    ": .ui.display",
    "button: Button()",
    "event: button.events.get()",
  ].join("\n"));
  const button = typedIr.body.find(({ kind, name }) => kind === "store_binding" && name === "button");
  const event = typedIr.body.find(({ kind, name }) => kind === "store_binding" && name === "event");

  assert.equal(button.type, "ui_component<Button>");
  assert.deepEqual(event.value, {
    kind: "ui_owner_event_get",
    owner: { kind: "load", name: "button", type: "ui_component<Button>" },
    owner_kind: "Button",
    type: "ButtonEvent|null",
  });
  assert.equal(event.type, "ButtonEvent|null");

  const queues = runtimeContract.createInternalButtonClickedOwnerQueues({
    buttonId: "button-0",
    frameId: "frame-0",
    displayId: "display-0",
  });
  queues.consumeRuntimePacket(buttonClickedPacket());
  assert.equal(runtimeContract.executeInternalOwnerEventPoll(event.value, queues).event, "ButtonClicked");
  assert.equal(runtimeContract.executeInternalOwnerEventPoll(event.value, queues), null);
});

test("malformed owner poll rejects before consuming ButtonClicked", () => {
  const typedIr = compileSource([
    ": .ui.display",
    "button: Button()",
    "event: button.events.get()",
  ].join("\n"));
  const poll = typedIr.body.find(
    ({ kind, name }) => kind === "store_binding" && name === "event",
  ).value;
  const queues = runtimeContract.createInternalButtonClickedOwnerQueues({
    buttonId: "button-0",
    frameId: "frame-0",
    displayId: "display-0",
  });
  queues.consumeRuntimePacket(buttonClickedPacket());

  assert.throws(
    () => runtimeContract.executeInternalOwnerEventPoll(
      { ...poll, owner: { ...poll.owner, name: "other" } },
      queues,
    ),
    /owner event poll is malformed/,
  );
  assert.equal(runtimeContract.executeInternalOwnerEventPoll(poll, queues).event, "ButtonClicked");
});

test("WASM exports the same target-neutral owner poll lowered by the native compiler", async () => {
  await mkdir(workRoot, { recursive: true });
  const sourceText = [
    ": .ui.display",
    "button: Button()",
    "event: button.events.get()",
  ].join("\n");
  const typedIr = compileSource(sourceText);
  const event = typedIr.body.find(
    ({ kind, name }) => kind === "store_binding" && name === "event",
  );
  const source = path.join(workRoot, "owner-poll.vkf");
  const typedIrPath = path.join(workRoot, "owner-poll.typed-ir.json");
  await Promise.all([
    writeFile(source, `${sourceText}\n`, "utf8"),
    writeFile(typedIrPath, `${JSON.stringify(typedIr)}\n`, "utf8"),
  ]);

  const summary = JSON.parse(runCompilerStage(
    "vkf_wasm_artifact_smoke",
    undefined,
    ["--source", source, "--typed-ir", typedIrPath],
  ));
  const [bytes, manifest] = await Promise.all([
    readFile(summary.artifact_path),
    readFile(summary.manifest_path, "utf8").then(JSON.parse),
  ]);
  const runtime = runtimeBridge.instantiateWasmRuntime({ bytes, manifest });
  const exportedPolls = JSON.parse(runtime.readBinding("$ui$owner$event$polls"));

  assert.deepEqual(exportedPolls, [{ binding: "event", poll: event.value }]);
});
