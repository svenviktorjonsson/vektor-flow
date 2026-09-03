import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const nativeBin = process.env.VKF_NATIVE_COMPILER_BIN;
const require = createRequire(import.meta.url);
const runtimeContract = require("../../web/vf-ui/vf-runtime-packet-contract.js");
const runtimeBridge = require("../../web/vf-ui/vf-compiled-runtime-bridge.js");
const workRoot = path.join(repositoryRoot, ".work", `040-u21-${process.pid}`);

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

function inputPacket(seq, x) {
  return {
    seq,
    kind: "input.event",
    payload: {
      event: {
        event: "ButtonClicked",
        widget_id: "button-0",
        frame_id: "frame-0",
        x,
      },
    },
  };
}

function eventLoopPlans(typedIr) {
  return typedIr.body
    .filter(({ expr }) => expr?.kind === "ui_owner_event_loop")
    .map(({ expr: loop }) => ({
      binding: loop.binding,
      poll: loop.poll,
      event_types: loop.arms.map(({ event_type: eventType }) => eventType),
    }));
}

const sourceText = [
  ": .ui.display",
  "button: Button()",
  "display: Display(dim:2)",
  "(event: button.events.get())??>",
  "    ButtonEvent => :: event",
  "    ButtonClicked => :: event",
  "(display_event: display.events.get())??>",
  "    ButtonEvent => :: display_event",
].join("\n");

test("event-drain loops bind specific and general Button events before null termination", () => {
  const typedIr = compileSource(sourceText);
  const loops = typedIr.body
    .filter(({ kind }) => kind === "expr_stmt")
    .map(({ expr }) => expr)
    .filter(({ kind }) => kind === "ui_owner_event_loop");

  assert.equal(loops.length, 2);
  assert.deepEqual(loops.map(({ binding, poll, arms }) => ({
    binding,
    ownerKind: poll.owner_kind,
    pollType: poll.type,
    eventTypes: arms.map(({ event_type }) => event_type),
    boundTypes: arms.map(({ body }) => body.body[0].expr.args[0].type),
  })), [
    {
      binding: "event",
      ownerKind: "Button",
      pollType: "ButtonEvent|null",
      eventTypes: ["ButtonEvent", "ButtonClicked"],
      boundTypes: ["ButtonEvent", "ButtonClicked"],
    },
    {
      binding: "display_event",
      ownerKind: "Display",
      pollType: "DisplayEvent|null",
      eventTypes: ["ButtonEvent"],
      boundTypes: ["ButtonEvent"],
    },
  ]);
});

test("compiled event-loop plans drain FIFO events and complete defaults without callbacks", async () => {
  await mkdir(workRoot, { recursive: true });
  const typedIr = compileSource(sourceText);
  const source = path.join(workRoot, "owner-event-loop.vkf");
  const typedIrPath = path.join(workRoot, "owner-event-loop.typed-ir.json");
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
  const plans = JSON.parse(runtime.readBinding("$ui$owner$event$loops"));
  assert.deepEqual(plans.map(({ binding, poll, event_types: eventTypes }) => ({
    binding,
    ownerKind: poll.owner_kind,
    eventTypes,
  })), [
    { binding: "event", ownerKind: "Button", eventTypes: ["ButtonEvent", "ButtonClicked"] },
    { binding: "display_event", ownerKind: "Display", eventTypes: ["ButtonEvent"] },
  ]);

  const queues = runtimeContract.createInternalButtonClickedOwnerQueues({
    buttonId: "button-0",
    frameId: "frame-0",
    displayId: "display-0",
  });
  queues.consumeRuntimePacket(inputPacket(1, 10));
  queues.consumeRuntimePacket(inputPacket(2, 20));

  const buttonLoop = runtimeContract.createInternalOwnerEventLoopExecution(plans[0], queues);
  const first = buttonLoop.next();
  assert.deepEqual(
    { binding: first.binding, eventType: first.event_type, branch: first.branch_index, x: first.event.x },
    { binding: "event", eventType: "ButtonClicked", branch: 1, x: 10 },
  );
  assert.equal(queues.takeInternalDefaultEvent(), null);
  buttonLoop.complete();
  const second = buttonLoop.next();
  assert.equal(second.event.x, 20);
  buttonLoop.complete();
  assert.equal(buttonLoop.next(), null);

  // The owner ledger holds the default until every later owner has consumed the
  // same interaction. A branch completes before the next FIFO event is exposed.
  for (const x of [10, 20]) {
    assert.equal(queues.frame.events.get().x, x);
    queues.completeInternalOwnerEvent(queues.frame);
  }
  const displayLoop = runtimeContract.createInternalOwnerEventLoopExecution(plans[1], queues);
  for (const x of [10, 20]) {
    const delivery = displayLoop.next();
    assert.equal(delivery.event.x, x);
    assert.equal(delivery.branch_index, 0);
    displayLoop.complete();
  }
  assert.equal(displayLoop.next(), null);
  assert.deepEqual(
    [queues.takeInternalDefaultEvent().x, queues.takeInternalDefaultEvent().x],
    [10, 20],
  );
  assert.equal(queues.takeInternalDefaultEvent(), null);
});

test("compiled loops pass prevent-default and stop-propagation into the shared owner ledger", () => {
  const [buttonPlan, displayPlan] = eventLoopPlans(compileSource(sourceText));

  const prevented = runtimeContract.createInternalButtonClickedOwnerQueues({
    buttonId: "button-0",
    frameId: "frame-0",
    displayId: "display-0",
  });
  prevented.consumeRuntimePacket(inputPacket(1, 40));
  const preventedButtonLoop = runtimeContract.createInternalOwnerEventLoopExecution(
    buttonPlan,
    prevented,
  );
  assert.equal(preventedButtonLoop.next().event.x, 40);
  preventedButtonLoop.complete({ preventDefault: true });
  assert.equal(prevented.frame.events.get().x, 40);
  prevented.completeInternalOwnerEvent(prevented.frame);
  const preventedDisplayLoop = runtimeContract.createInternalOwnerEventLoopExecution(
    displayPlan,
    prevented,
  );
  assert.equal(preventedDisplayLoop.next().event.x, 40);
  preventedDisplayLoop.complete();
  assert.equal(prevented.takeInternalDefaultEvent(), null);

  const stopped = runtimeContract.createInternalButtonClickedOwnerQueues({
    buttonId: "button-0",
    frameId: "frame-0",
    displayId: "display-0",
  });
  stopped.consumeRuntimePacket(inputPacket(1, 50));
  const stoppedButtonLoop = runtimeContract.createInternalOwnerEventLoopExecution(
    buttonPlan,
    stopped,
  );
  assert.equal(stoppedButtonLoop.next().event.x, 50);
  stoppedButtonLoop.complete({ stopPropagation: true });
  assert.equal(stopped.frame.events.get(), null);
  assert.equal(stopped.display.events.get(), null);
  assert.equal(stopped.takeInternalDefaultEvent().x, 50);
  assert.equal(stopped.takeInternalDefaultEvent(), null);
});

test("a malformed event-loop plan rejects atomically before its owner queue is drained", () => {
  const typedIr = compileSource(sourceText);
  const [plan] = eventLoopPlans(typedIr);
  const queues = runtimeContract.createInternalButtonClickedOwnerQueues({
    buttonId: "button-0",
    frameId: "frame-0",
    displayId: "display-0",
  });
  queues.consumeRuntimePacket(inputPacket(1, 30));

  assert.throws(
    () => runtimeContract.createInternalOwnerEventLoopExecution(
      { ...plan, callback: "not-allowed" },
      queues,
    ),
    /owner event loop is malformed/,
  );
  assert.equal(runtimeContract.executeInternalOwnerEventPoll(plan.poll, queues).x, 30);
});

test("unsupported typed arms reject instead of silently dropping the runtime loop", async () => {
  const unsupportedSource = [
    ": .ui.display",
    "button: Button()",
    "(event: button.events.get())??>",
    "    MouseButtonClicked => :: event",
  ].join("\n");
  const tokens = runCompilerStage("vkf_lexer_cursor_smoke", undefined, [unsupportedSource]);
  const ast = runCompilerStage("vkf_parser_token_stream_smoke", tokens);
  const compileResult = spawnSync(compilerTool("vkf_ast_to_ir_smoke"), [], {
    cwd: repositoryRoot,
    encoding: "utf8",
    input: ast,
    windowsHide: true,
  });
  assert.notEqual(compileResult.status, 0);
  assert.equal(compileResult.stdout, "");
  assert.match(
    compileResult.stderr,
    /^<ast-to-ir>:1:1: owner event loop currently supports ButtonEvent, ButtonClicked, SliderEvent, and SliderValueChanged branches\r?\n$/u,
  );

  // Stale typed IR from before this diagnostic must also fail atomically in the
  // WASM boundary, rather than compiling a module with no event-loop binding.
  const staleIr = compileSource(sourceText);
  const statement = staleIr.body.find(({ expr }) => expr?.kind === "ui_owner_event_loop");
  const loop = statement.expr;
  statement.expr = {
    kind: "match_stmt",
    discriminant: {
      kind: "bind_expr",
      name: loop.binding,
      type: loop.poll.type,
      update_only: false,
      value: loop.poll,
    },
    arms: [{
      kind: "match_arm",
      condition: { kind: "load", name: "MouseButtonClicked", type: "any" },
      body: loop.arms[0].body,
    }],
    loop: true,
    catch: false,
    type: "any",
  };
  const unsupportedRoot = path.join(workRoot, "unsupported");
  const source = path.join(unsupportedRoot, "unsupported-owner-event-loop.vkf");
  const typedIrPath = path.join(unsupportedRoot, "unsupported-owner-event-loop.typed-ir.json");
  await mkdir(unsupportedRoot, { recursive: true });
  await Promise.all([
    writeFile(source, `${unsupportedSource}\n`, "utf8"),
    writeFile(typedIrPath, `${JSON.stringify(staleIr)}\n`, "utf8"),
  ]);
  const wasmResult = spawnSync(
    compilerTool("vkf_wasm_artifact_smoke"),
    ["--source", source, "--typed-ir", typedIrPath],
    { cwd: repositoryRoot, encoding: "utf8", windowsHide: true },
  );
  assert.notEqual(wasmResult.status, 0);
  assert.equal(wasmResult.stdout, "");
  assert.match(
    wasmResult.stderr,
    /^<wasm-artifact-smoke>:1:1: unsupported internal owner event loop\r?\n$/u,
  );
  await assert.rejects(access(path.join(unsupportedRoot, ".vkfbuild")));
});
