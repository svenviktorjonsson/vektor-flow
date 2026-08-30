import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const nativeBin = process.env.VKF_NATIVE_COMPILER_BIN;
const nativeSceneStager = process.env.VKF_NATIVE_SCENE_STAGER;
const edgeExecutable = process.env.VF_EDGE_PATH ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const workRoot = path.join(repositoryRoot, ".work", `040-u06-${process.pid}`);
const sourceStem = `u06-${process.pid}`;
const wasmBuild = path.join(repositoryRoot, ".vkfbuild", sourceStem);

async function removeTree(target) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!["EBUSY", "EPERM"].includes(error?.code) || attempt === 29) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

after(async () => {
  await Promise.all([removeTree(workRoot), removeTree(wasmBuild)]);
});

function executable(directory, name) {
  return path.join(directory, process.platform === "win32" ? `${name}.exe` : name);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
    ...options,
  });
  assert.equal(result.error, undefined, `failed to start ${command}: ${result.error}`);
  assert.equal(result.status, 0, result.stderr || `${command} failed`);
  return result.stdout;
}

function runFailure(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
    ...options,
  });
  assert.equal(result.error, undefined, `failed to start ${command}: ${result.error}`);
  assert.notEqual(result.status, 0, "command unexpectedly succeeded");
  return result.stderr;
}

function compileSource(source) {
  assert.ok(nativeBin, "VKF_NATIVE_COMPILER_BIN must name the focused native build directory");
  const tokens = run(executable(nativeBin, "vkf_lexer_cursor_smoke"), [source]);
  const ast = run(executable(nativeBin, "vkf_parser_token_stream_smoke"), [], { input: tokens });
  return JSON.parse(run(executable(nativeBin, "vkf_ast_to_ir_smoke"), [], { input: ast }));
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

function connectWebSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.onopen = () => resolve(socket);
    socket.onerror = reject;
  });
}

function routeCdpMessages(socket, state) {
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

async function runBrowserBundle(bundleDirectory, profileDirectory, nativeRoot, nativePageRel) {
  const loader = await readFile(path.join(repositoryRoot, "web", "vf-ui", "vf-static-html-loader.js"));
  const page = `<!doctype html><html><body data-vf-static-html-loads="/bundle/vf-static-html-loads.json"><div id="frame" data-vf-frame-id="frame_0"><div class="vf-frame__body"><canvas></canvas></div></div><output id="result"></output>
  <script src="/vf-static-html-loader.js"></script><script>(async()=>{try{
  const body=document.querySelector('.vf-frame__body');const canvas=body.firstElementChild;
  for(let i=0;i<120&&!document.querySelector('[data-vf-static-html-root]');i++)await new Promise(r=>setTimeout(r,25));const panel=document.querySelector('.panel');
  if(!panel)throw new Error(String(globalThis.__vfStaticHtmlLoadError||'static HTML did not auto-mount'));
  for(let i=0;i<80&&getComputedStyle(panel).color!=='rgb(12, 34, 56)';i++)await new Promise(r=>setTimeout(r,25));
  document.getElementById('result').textContent=JSON.stringify({tags:Array.from(document.querySelectorAll('[data-vf-static-html-root] *'),e=>e.localName),color:getComputedStyle(panel).color,canvasRetained:body.firstElementChild===canvas});
  }catch(error){document.getElementById('result').textContent=JSON.stringify({error:String(error&&error.message||error)});}})();</script></body></html>`;
  const server = createServer(async (request, response) => {
    try {
      if (request.url === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page);
        return;
      }
      if (request.url === "/vf-static-html-loader.js") {
        response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" }).end(loader);
        return;
      }
      if (request.url.startsWith("/bundle/")) {
        const relative = decodeURIComponent(request.url.slice("/bundle/".length));
        const target = path.resolve(bundleDirectory, ...relative.split("/"));
        if (!target.startsWith(`${path.resolve(bundleDirectory)}${path.sep}`)) {
          response.writeHead(404).end();
          return;
        }
        const contentType = target.endsWith(".json") ? "application/json"
          : target.endsWith(".css") ? "text/css" : "text/html; charset=utf-8";
        response.writeHead(200, { "content-type": contentType, "cache-control": "no-store" })
          .end(await readFile(target));
        return;
      }
      if (nativeRoot && request.url.startsWith("/native/")) {
        const relative = decodeURIComponent(request.url.slice("/native/".length).split("?")[0]);
        const target = path.resolve(nativeRoot, ...relative.split("/"));
        if (!target.startsWith(`${path.resolve(nativeRoot)}${path.sep}`)) {
          response.writeHead(404).end();
          return;
        }
        const contentType = target.endsWith(".json") ? "application/json"
          : target.endsWith(".css") ? "text/css"
          : target.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8";
        response.writeHead(200, { "content-type": contentType, "cache-control": "no-store" })
          .end(await readFile(target));
        return;
      }
      response.writeHead(404).end();
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const pageUrl = nativeRoot
    ? `http://127.0.0.1:${server.address().port}/native/${nativePageRel}`
    : `http://127.0.0.1:${server.address().port}/`;
  const debugPort = await openPort();
  const edge = spawn(edgeExecutable, [
    `--user-data-dir=${profileDirectory}`, `--remote-debugging-port=${debugPort}`,
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--edge-skip-compat-layer-relaunch", pageUrl,
  ], { cwd: repositoryRoot, stdio: "ignore", windowsHide: true });
  const edgeExited = new Promise((resolve) => edge.once("exit", resolve));
  let pageSocket;
  let browserSocket;
  let browserState;
  let browserProcessId;
  try {
    let target;
    let version;
    for (let attempt = 0; attempt < 80 && (!target || !version); attempt += 1) {
      try {
        const [targets, nextVersion] = await Promise.all([
          fetch(`http://127.0.0.1:${debugPort}/json/list`).then((value) => value.json()),
          fetch(`http://127.0.0.1:${debugPort}/json/version`).then((value) => value.json()),
        ]);
        target = targets.find(({ url }) => url === pageUrl);
        version = nextVersion;
      } catch {}
      if (!target || !version) await delay(125);
    }
    assert.ok(target, "browser bundle page did not open");
    [pageSocket, browserSocket] = await Promise.all([
      connectWebSocket(target.webSocketDebuggerUrl),
      connectWebSocket(version.webSocketDebuggerUrl),
    ]);
    const pageState = { nextId: 0, pending: new Map() };
    browserState = { nextId: 0, pending: new Map() };
    routeCdpMessages(pageSocket, pageState);
    routeCdpMessages(browserSocket, browserState);
    const processInfo = await cdp(browserSocket, browserState, "SystemInfo.getProcessInfo").catch(() => undefined);
    browserProcessId = processInfo?.processInfo?.find(({ type }) => type === "browser")?.id;
    await cdp(pageSocket, pageState, "Runtime.enable");
    let text = "";
    const resultExpression = nativeRoot
      ? `(()=>{if(globalThis.__vfStaticHtmlLoadError)return JSON.stringify({error:String(globalThis.__vfStaticHtmlLoadError)});const panel=document.querySelector('.panel');if(!panel)return '';const root=panel.closest('[data-vf-static-html-root]');const body=root&&root.parentElement;return JSON.stringify({tags:Array.from(root.querySelectorAll('*'),e=>e.localName),color:getComputedStyle(panel).color,canvasRetained:body.firstElementChild.localName==='canvas'});})()`
      : "document.getElementById('result')?.textContent || ''";
    for (let attempt = 0; attempt < 120 && !text; attempt += 1) {
      const evaluated = await cdp(pageSocket, pageState, "Runtime.evaluate", {
        expression: resultExpression,
        returnByValue: true,
      });
      text = evaluated.result?.value || "";
      if (!text) await delay(50);
    }
    assert.ok(text, "browser bundle did not report a result");
    return JSON.parse(text);
  } finally {
    if (browserSocket && browserState) {
      await cdp(browserSocket, browserState, "Browser.close").catch(() => {});
    }
    await Promise.race([edgeExited, delay(2000)]);
    pageSocket?.close();
    browserSocket?.close();
    await terminateBrowserTree(browserProcessId);
    await terminateBrowserTree(edge.pid);
    edge.kill();
    await delay(250);
    await new Promise((resolve) => server.close(resolve));
  }
}

test("frame.load stages one static HTML document and relative CSS identically for native and WASM", { skip: process.platform !== "win32", timeout: 120_000 }, async () => {
  assert.ok(nativeSceneStager, "VKF_NATIVE_SCENE_STAGER must name the focused stager executable");
  await mkdir(workRoot, { recursive: true });
  const source = path.join(workRoot, `${sourceStem}.vkf`);
  const typedIrPath = path.join(workRoot, `${sourceStem}.typed.json`);
  const uiDirectory = path.join(workRoot, "ui");
  const overlayWeb = path.join(workRoot, "native-vf-ui");
  const sourceText = [
    ": .ui.display",
    "display: Display(dim:2)",
    "frame: display.add_frame(pos:[0.1, 0.2], size:[0.5, 0.6])",
    'frame.load("ui/main.html")',
  ].join("\n");
  const html = '<link rel="stylesheet" href="theme.css"><main class="panel"><button>Apply</button></main>';
  const css = ".panel { color: rgb(12, 34, 56); }\n";
  await Promise.all([
    mkdir(uiDirectory, { recursive: true }),
    cp(path.join(repositoryRoot, "web", "vf-ui"), overlayWeb, { recursive: true }),
  ]);
  const typedIr = compileSource(sourceText);
  assert.deepEqual(typedIr.ui_program.operations.map(({ kind }) => kind), ["add_frame", "load"]);
  await Promise.all([
    writeFile(source, sourceText, "utf8"),
    writeFile(typedIrPath, `${JSON.stringify(typedIr)}\n`, "utf8"),
    writeFile(path.join(uiDirectory, "main.html"), html, "utf8"),
    writeFile(path.join(uiDirectory, "theme.css"), css, "utf8"),
  ]);

  const nativeSummary = JSON.parse(run(nativeSceneStager, [
    "--source", source, "--overlay-web", overlayWeb, "--typed-ir", typedIrPath,
  ]));
  const wasmSummary = JSON.parse(run(executable(nativeBin, "vkf_wasm_artifact_smoke"), [
    "--source", source, "--typed-ir", typedIrPath,
  ]));
  const nativeBundle = path.dirname(path.join(overlayWeb, ...nativeSummary.page_rel.split("/")));
  const wasmBundle = path.dirname(wasmSummary.artifact_path);
  const [nativeMounts, wasmMounts] = await Promise.all([
    readFile(path.join(nativeBundle, "vf-static-html-loads.json"), "utf8").then(JSON.parse),
    readFile(path.join(wasmBundle, "vf-static-html-loads.json"), "utf8").then(JSON.parse),
  ]);
  assert.deepEqual(nativeMounts, wasmMounts);
  const resource = nativeMounts[0].resource.split("/");
  const nativeHtml = path.join(nativeBundle, ...resource);
  const wasmHtml = path.join(wasmBundle, ...resource);
  assert.equal(await readFile(nativeHtml, "utf8"), html);
  assert.equal(await readFile(wasmHtml, "utf8"), html);
  assert.equal(await readFile(path.join(path.dirname(nativeHtml), "theme.css"), "utf8"), css);
  assert.equal(await readFile(path.join(path.dirname(wasmHtml), "theme.css"), "utf8"), css);
  const expectedBrowser = {
    tags: ["link", "main", "button"],
    color: "rgb(12, 34, 56)",
    canvasRetained: true,
  };
  assert.deepEqual(
    await runBrowserBundle(wasmBundle, path.join(workRoot, "wasm-edge-profile")),
    expectedBrowser,
  );
  assert.deepEqual(
    await runBrowserBundle(
      nativeBundle,
      path.join(workRoot, "native-edge-profile"),
      overlayWeb,
      nativeSummary.page_rel,
    ),
    expectedBrowser,
  );
  await writeFile(wasmHtml, '<link rel="stylesheet" href="/global.css"><main class="panel"></main>', "utf8");
  assert.deepEqual(
    await runBrowserBundle(wasmBundle, path.join(workRoot, "reject-edge-profile")),
    { error: "Error: static HTML stylesheet must be source-relative" },
  );
});

test("a missing relative stylesheet rejects both targets before creating artifacts", { skip: process.platform !== "win32" }, async () => {
  assert.ok(nativeSceneStager, "VKF_NATIVE_SCENE_STAGER must name the focused stager executable");
  const missingRoot = await mkdtemp(path.join(workRoot, "missing-"));
  const overlayWeb = path.join(missingRoot, "native-vf-ui");
  const source = path.join(missingRoot, `${sourceStem}-missing.vkf`);
  const typedIrPath = path.join(missingRoot, `${sourceStem}-missing.typed.json`);
  const sourceText = [
    ": .ui.display",
    "display: Display(dim:2)",
    "frame: display.add_frame(pos:[0, 0], size:[1, 1])",
    'frame.load("ui/main.html")',
  ].join("\n");
  const typedIr = compileSource(sourceText);
  await Promise.all([
    mkdir(path.join(missingRoot, "ui"), { recursive: true }),
    cp(path.join(repositoryRoot, "web", "vf-ui"), overlayWeb, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(source, sourceText, "utf8"),
    writeFile(typedIrPath, `${JSON.stringify(typedIr)}\n`, "utf8"),
    writeFile(path.join(missingRoot, "ui", "main.html"), '<link rel="stylesheet" href="missing.css"><p>Never mounted</p>', "utf8"),
  ]);
  const nativeError = runFailure(nativeSceneStager, [
    "--source", source, "--overlay-web", overlayWeb, "--typed-ir", typedIrPath,
  ]);
  const wasmError = runFailure(executable(nativeBin, "vkf_wasm_artifact_smoke"), [
    "--source", source, "--typed-ir", typedIrPath,
  ]);
  assert.match(nativeError, /Frame\.load static resource not found/);
  assert.match(wasmError, /Frame\.load static resource not found/);
  assert.equal(await exists(path.join(overlayWeb, "sessions")), false);
  assert.equal(await exists(path.join(missingRoot, ".vkfbuild")), false);
});

test("the initial slice rejects duplicate loads and absolute entry paths atomically", { skip: process.platform !== "win32" }, async () => {
  const sourceText = [
    ": .ui.display",
    "display: Display(dim:2)",
    "frame: display.add_frame(pos:[0, 0], size:[1, 1])",
    'frame.load("ui/main.html")',
  ].join("\n");
  const baseIr = compileSource(sourceText);
  for (const variant of ["duplicate", "absolute"]) {
    const caseRoot = path.join(workRoot, variant);
    const overlayWeb = path.join(caseRoot, "native-vf-ui");
    const source = path.join(caseRoot, `${sourceStem}-${variant}.vkf`);
    const typedIrPath = path.join(caseRoot, `${sourceStem}-${variant}.typed.json`);
    const typedIr = structuredClone(baseIr);
    await Promise.all([
      mkdir(path.join(caseRoot, "ui"), { recursive: true }),
      cp(path.join(repositoryRoot, "web", "vf-ui"), overlayWeb, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(source, sourceText, "utf8"),
      writeFile(path.join(caseRoot, "ui", "main.html"), '<link rel="stylesheet" href="theme.css"><p>Static</p>', "utf8"),
      writeFile(path.join(caseRoot, "ui", "theme.css"), "p { color: green; }\n", "utf8"),
    ]);
    if (variant === "duplicate") {
      typedIr.ui_program.operations.push(structuredClone(typedIr.ui_program.operations.at(-1)));
    } else {
      typedIr.ui_program.operations.at(-1).resource = path.join(caseRoot, "ui", "main.html");
    }
    await writeFile(typedIrPath, `${JSON.stringify(typedIr)}\n`, "utf8");
    const nativeError = runFailure(nativeSceneStager, [
      "--source", source, "--overlay-web", overlayWeb, "--typed-ir", typedIrPath,
    ]);
    const wasmError = runFailure(executable(nativeBin, "vkf_wasm_artifact_smoke"), [
      "--source", source, "--typed-ir", typedIrPath,
    ]);
    const expected = variant === "duplicate" ? /one load per Frame/ : /source-relative/;
    assert.match(nativeError, expected);
    assert.match(wasmError, expected);
    assert.equal(await exists(path.join(overlayWeb, "sessions")), false);
    assert.equal(await exists(path.join(caseRoot, ".vkfbuild")), false);
  }
});
