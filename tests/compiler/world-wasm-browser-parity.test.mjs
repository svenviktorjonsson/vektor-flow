import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { createServer as createTcpServer } from "node:net";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const runtimeBridge = require("../../web/vf-ui/vf-compiled-runtime-bridge.js");
const compilerBin = process.env.VKF_NATIVE_COMPILER_BIN;
const wasmArtifact = process.env.VKF_WASM_ARTIFACT;
const nativeSceneStager = process.env.VKF_NATIVE_SCENE_STAGER;
const edgeExecutable = process.env.VF_EDGE_PATH ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const workRoot = path.join(repositoryRoot, ".work", `u14-world-${process.pid}`);

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function removeTree(target) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!["EBUSY", "EPERM"].includes(error?.code) || attempt === 199) throw error;
      await delay(200);
    }
  }
}

after(() => removeTree(workRoot));

function executable(directory, name) {
  assert.ok(directory, "VKF_NATIVE_COMPILER_BIN must name the focused compiler directory");
  return path.join(directory, process.platform === "win32" ? `${name}.exe` : name);
}

function run(command, args = [], input) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    input,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || `${command} failed without diagnostics`);
  return result.stdout;
}

function runFailure(command, args = []) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.notEqual(result.status, 0, "invalid typed World presentation unexpectedly emitted WASM");
  return `${result.stdout}\n${result.stderr}`;
}

function compileSource(source) {
  const normalized = source.replace(/\r\n/gu, "\n");
  const tokens = run(executable(compilerBin, "vkf_lexer_cursor_smoke"), [normalized]);
  const ast = run(executable(compilerBin, "vkf_parser_token_stream_smoke"), [], tokens);
  return JSON.parse(run(executable(compilerBin, "vkf_ast_to_ir_smoke"), [], ast));
}

function connectWebSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.onopen = () => resolve(socket);
    socket.onerror = reject;
  });
}

function routeMessages(socket, state) {
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data.toString());
    const receive = message.id && state.pending.get(message.id);
    if (!receive) return;
    state.pending.delete(message.id);
    receive(message);
  };
}

function cdp(socket, state, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++state.nextId;
    state.pending.set(id, (message) => {
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function openPort() {
  return new Promise((resolve, reject) => {
    const server = createTcpServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function terminateBrowserTree(processId) {
  if (!processId || process.platform !== "win32") return;
  await new Promise((resolve) => {
    const terminator = spawn("taskkill.exe", ["/PID", String(processId), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    terminator.once("error", resolve);
    terminator.once("exit", resolve);
  });
}

async function observeStagedWorld(overlayWeb, pageRel) {
  const server = createServer(async (request, response) => {
    try {
      const relative = decodeURIComponent((request.url || "/").split("?")[0].slice(1));
      const target = path.resolve(overlayWeb, ...relative.split("/"));
      if (target !== path.resolve(overlayWeb) &&
          !target.startsWith(`${path.resolve(overlayWeb)}${path.sep}`)) {
        response.writeHead(404).end();
        return;
      }
      const contentType = target.endsWith(".json") ? "application/json"
        : target.endsWith(".css") ? "text/css"
        : target.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8";
      const bytes = await readFile(target);
      response.writeHead(200, { "content-type": contentType, "cache-control": "no-store" })
        .end(bytes);
    } catch {
      if (!response.headersSent) response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const pageUrl = `http://127.0.0.1:${server.address().port}/${pageRel}`;
  const debugPort = await openPort();
  const profile = path.join(workRoot, "edge-profile");
  const edge = spawn(edgeExecutable, [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${debugPort}`,
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--edge-skip-compat-layer-relaunch",
    pageUrl,
  ], { cwd: repositoryRoot, stdio: "ignore", windowsHide: true });
  const exited = new Promise((resolve) => edge.once("exit", resolve));
  let pageSocket;
  let browserSocket;
  let browserProcessId;
  try {
    let target;
    let version;
    for (let attempt = 0; attempt < 100 && (!target || !version); attempt += 1) {
      try {
        const [targets, nextVersion] = await Promise.all([
          fetch(`http://127.0.0.1:${debugPort}/json/list`).then((value) => value.json()),
          fetch(`http://127.0.0.1:${debugPort}/json/version`).then((value) => value.json()),
        ]);
        target = targets.find(({ url }) => url === pageUrl);
        version = nextVersion;
      } catch {}
      if (!target || !version) await delay(100);
    }
    assert.ok(target, "World browser page did not open");
    [pageSocket, browserSocket] = await Promise.all([
      connectWebSocket(target.webSocketDebuggerUrl),
      connectWebSocket(version.webSocketDebuggerUrl),
    ]);
    const pageState = { nextId: 0, pending: new Map() };
    const browserState = { nextId: 0, pending: new Map() };
    routeMessages(pageSocket, pageState);
    routeMessages(browserSocket, browserState);
    const processInfo = await cdp(browserSocket, browserState, "SystemInfo.getProcessInfo").catch(() => undefined);
    browserProcessId = processInfo?.processInfo?.find(({ type }) => type === "browser")?.id;
    await cdp(pageSocket, pageState, "Runtime.enable");
    for (let attempt = 0; attempt < 240; attempt += 1) {
      const evaluated = await cdp(pageSocket, pageState, "Runtime.evaluate", {
        expression: `(()=>{const frame=document.querySelector('[data-vf-frame-id="world_0_view_0"]');const canvas=frame&&frame.querySelector('canvas');return frame&&canvas?{frameId:frame.dataset.vfFrameId,canvas:canvas.localName}:null})()`,
        returnByValue: true,
      });
      if (evaluated.result?.value) return evaluated.result.value;
      await delay(50);
    }
    throw new Error("World browser page did not mount its retained canvas");
  } finally {
    pageSocket?.close();
    browserSocket?.close();
    await terminateBrowserTree(browserProcessId);
    await terminateBrowserTree(edge.pid);
    edge.kill();
    await Promise.race([exited, delay(2000)]);
    await delay(250);
    await new Promise((resolve) => server.close(resolve));
    await removeTree(profile);
  }
}

test("typed World packets are identical in native, WASM, and real Edge", {
  skip: process.platform !== "win32",
  timeout: 120_000,
}, async () => {
  assert.ok(wasmArtifact, "VKF_WASM_ARTIFACT must name the focused WASM artifact emitter");
  assert.ok(nativeSceneStager, "VKF_NATIVE_SCENE_STAGER must name the focused native stager");
  await mkdir(workRoot, { recursive: true });
  const sourceText = await readFile(path.join(repositoryRoot, "examples", "115_world_embedding_native.vkf"), "utf8");
  const typedIr = compileSource(sourceText);
  const source = path.join(workRoot, "world.vkf");
  const typedIrPath = path.join(workRoot, "world.typed-ir.json");
  const overlayWeb = path.join(workRoot, "vf-ui");
  await Promise.all([
    writeFile(source, sourceText, "utf8"),
    writeFile(typedIrPath, `${JSON.stringify(typedIr)}\n`, "utf8"),
    cp(path.join(repositoryRoot, "web", "vf-ui"), overlayWeb, { recursive: true }),
  ]);

  const staged = JSON.parse(run(nativeSceneStager, [
    "--source", source, "--overlay-web", overlayWeb, "--typed-ir", typedIrPath,
  ]));
  const sessionDirectory = path.dirname(path.join(overlayWeb, ...staged.page_rel.split("/")));
  const runtimePacketsPath = path.join(sessionDirectory, "vf-runtime-packets.json");
  const nativePackets = JSON.parse(await readFile(runtimePacketsPath, "utf8"));
  const wasmSummary = JSON.parse(run(wasmArtifact, ["--source", source, "--typed-ir", typedIrPath]));
  const [wasmBytes, wasmManifest] = await Promise.all([
    readFile(wasmSummary.artifact_path),
    readFile(wasmSummary.manifest_path, "utf8").then(JSON.parse),
  ]);
  const wasmRuntime = runtimeBridge.instantiateWasmRuntime({ bytes: wasmBytes, manifest: wasmManifest });
  const wasmPackets = JSON.parse(wasmRuntime.readBinding("$ui$compiled$packets"));
  assert.deepEqual(wasmPackets, nativePackets);
  await writeFile(runtimePacketsPath, `${JSON.stringify(wasmPackets)}\n`, "utf8");
  assert.deepEqual(await observeStagedWorld(overlayWeb, staged.page_rel), {
    frameId: "world_0_view_0",
    canvas: "canvas",
  });
});

test("WASM rejects unsupported World effects before artifact emission", async () => {
  assert.ok(wasmArtifact, "VKF_WASM_ARTIFACT must name the focused WASM artifact emitter");
  const invalidRoot = path.join(workRoot, "invalid");
  await mkdir(invalidRoot, { recursive: true });
  const sourceText = await readFile(path.join(repositoryRoot, "examples", "115_world_embedding_native.vkf"), "utf8");
  const typedIr = compileSource(sourceText);
  typedIr.__vf_internal_world.worlds[0].gravity = true;
  const source = path.join(invalidRoot, "world-invalid.vkf");
  const typedIrPath = path.join(invalidRoot, "world-invalid.typed-ir.json");
  await Promise.all([
    writeFile(source, sourceText, "utf8"),
    writeFile(typedIrPath, `${JSON.stringify(typedIr)}\n`, "utf8"),
  ]);
  const diagnostic = runFailure(wasmArtifact, ["--source", source, "--typed-ir", typedIrPath]);
  assert.match(diagnostic, /requires `gravity:false`/u);
  assert.equal(existsSync(path.join(invalidRoot, ".vkfbuild")), false);
});
