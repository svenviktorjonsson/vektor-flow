import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { createRequire } from "node:module";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const compilerBin = process.env.VKF_NATIVE_COMPILER_BIN;
const require = createRequire(import.meta.url);
const runtimeContract = require("../../web/vf-ui/vf-runtime-packet-contract.js");
const runtimeBridge = require("../../web/vf-ui/vf-compiled-runtime-bridge.js");
const workRoot = path.join(repositoryRoot, ".work", `040-slider-events-${process.pid}`);

after(() => rm(workRoot, { recursive: true, force: true }));

function executable(name) {
  assert.ok(compilerBin, "VKF_NATIVE_COMPILER_BIN must name the focused compiler directory");
  return path.join(compilerBin, process.platform === "win32" ? `${name}.exe` : name);
}

function stage(name, input, args = []) {
  const result = spawnSync(executable(name), args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    input,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || `${name} failed without diagnostics`);
  return result.stdout;
}

function compileSource(source) {
  const tokens = stage("vkf_lexer_cursor_smoke", undefined, [source]);
  const ast = stage("vkf_parser_token_stream_smoke", tokens);
  return JSON.parse(stage("vkf_ast_to_ir_smoke", ast));
}

test("native compiler treats CRLF and LF VKF source identically", () => {
  const source = [
    ": .ui.display",
    "slider: Input()",
    "event: slider.events.get()",
  ].join("\n");
  assert.deepEqual(compileSource(source.replaceAll("\n", "\r\n")), compileSource(source));
});

test("Input range owners expose SliderEvent and SliderValueChanged specificity", () => {
  const typedIr = compileSource([
    ": .ui.display",
    "slider: Input()",
    "event: slider.events.get()",
    "(change: slider.events.get())??>",
    "    SliderEvent => :: change",
    "    SliderValueChanged => :: change",
  ].join("\n"));

  const event = typedIr.body.find(({ kind, name }) => kind === "store_binding" && name === "event");
  assert.deepEqual(event.value, {
    kind: "ui_owner_event_get",
    owner: { kind: "load", name: "slider", type: "ui_component<Input>" },
    owner_kind: "Input",
    type: "SliderEvent|null",
  });
  assert.equal(event.type, "SliderEvent|null");

  const loop = typedIr.body.find(({ kind, expr }) =>
    kind === "expr_stmt" && expr?.kind === "ui_owner_event_loop").expr;
  assert.deepEqual(loop.arms.map(({ event_type }) => event_type), [
    "SliderEvent",
    "SliderValueChanged",
  ]);

  const queues = runtimeContract.createInternalSliderValueChangedOwnerQueues({
    inputId: "detail",
    frameId: "controls",
    displayId: "display-0",
  });
  queues.consumeRuntimePacket({
    seq: 1,
    kind: "input.event",
    payload: {
      event: {
        event: "SliderValueChanged",
        widget_id: "detail",
        frame_id: "controls",
        value: 0.75,
      },
    },
  });
  assert.equal(runtimeContract.executeInternalOwnerEventPoll(event.value, {
    slider: queues.input,
  }).value, 0.75);
  assert.equal(runtimeContract.executeInternalOwnerEventPoll(event.value, {
    slider: queues.input,
  }), null);
});

test("the script-free overlay fixture compiles both component event loops", async () => {
  const source = await readFile(path.join(
    repositoryRoot,
    "tests",
    "fixtures",
    "transparent-overlay-acceptance",
    "app.vkf",
  ), "utf8");
  const typedIr = compileSource(source);
  const loops = typedIr.body
    .filter(({ kind, expr }) => kind === "expr_stmt" && expr?.kind === "ui_owner_event_loop")
    .map(({ expr }) => ({
      owner: expr.poll.owner_kind,
      events: expr.arms.map(({ event_type: eventType }) => eventType),
    }));
  assert.deepEqual(loops, [
    { owner: "Button", events: ["ButtonEvent", "ButtonClicked"] },
    { owner: "Input", events: ["SliderEvent", "SliderValueChanged"] },
  ]);
});

test("WASM exports the target-neutral Slider event poll and loop", async () => {
  await mkdir(workRoot, { recursive: true });
  const sourceText = [
    ": .ui.display",
    "slider: Input()",
    "event: slider.events.get()",
    "(change: slider.events.get())??>",
    "    SliderEvent => :: change",
    "    SliderValueChanged => :: change",
  ].join("\n");
  const typedIr = compileSource(sourceText);
  const source = path.join(workRoot, "slider-events.vkf");
  const typedIrPath = path.join(workRoot, "slider-events.typed-ir.json");
  await Promise.all([
    writeFile(source, `${sourceText}\n`, "utf8"),
    writeFile(typedIrPath, `${JSON.stringify(typedIr)}\n`, "utf8"),
  ]);

  const summary = JSON.parse(stage("vkf_wasm_artifact_smoke", undefined, [
    "--source", source,
    "--typed-ir", typedIrPath,
  ]));
  const [bytes, manifest] = await Promise.all([
    readFile(summary.artifact_path),
    readFile(summary.manifest_path, "utf8").then(JSON.parse),
  ]);
  const runtime = runtimeBridge.instantiateWasmRuntime({ bytes, manifest });
  const polls = JSON.parse(runtime.readBinding("$ui$owner$event$polls"));
  const loops = JSON.parse(runtime.readBinding("$ui$owner$event$loops"));

  assert.equal(polls[0].poll.type, "SliderEvent|null");
  assert.deepEqual(loops[0].event_types, ["SliderEvent", "SliderValueChanged"]);
});
