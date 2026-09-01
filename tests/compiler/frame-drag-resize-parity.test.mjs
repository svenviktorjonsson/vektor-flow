import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const frameSource = path.join(repositoryRoot, "web", "vf-ui", "vf-frame.js");
const frameStyle = path.join(repositoryRoot, "web", "vf-ui", "vf-frame.css");
const componentSource = path.join(repositoryRoot, "web", "vf-ui", "vf-html-components.js");
const packetContractSource = path.join(repositoryRoot, "web", "vf-ui", "vf-runtime-packet-contract.js");
const edgeExecutable = process.env.VF_EDGE_PATH ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const nativeHost = process.env.VKF_OVERLAY_HOST;
const workRoot = path.join(repositoryRoot, ".work", `u09-frame-${process.pid}`);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function removeTree(target) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!["EBUSY", "EPERM"].includes(error?.code) || attempt === 39) throw error;
      await delay(100);
    }
  }
}

after(() => removeTree(workRoot));

async function openPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
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

async function runProbe(probeSource) {
  await removeTree(workRoot);
  await mkdir(workRoot, { recursive: true });
  const page = path.join(workRoot, "probe.html");
  await writeFile(page, `<!doctype html><html><head>
    <link rel="stylesheet" href="${pathToFileURL(frameStyle).href}">
    <style>html,body{margin:0}</style>
  </head><body><output id="result"></output>
    <script src="${pathToFileURL(componentSource).href}"></script>
    <script src="${pathToFileURL(packetContractSource).href}"></script>
    <script src="${pathToFileURL(frameSource).href}"></script>
    <script>Promise.resolve().then(async()=>{try{
      const value=await(async()=>{${probeSource}})();
      document.getElementById("result").textContent=JSON.stringify({value});
    }catch(error){document.getElementById("result").textContent=JSON.stringify({error:String(error&&error.stack||error)});}});</script>
  </body></html>`);

  const port = await openPort();
  const edge = spawn(edgeExecutable, [
    `--user-data-dir=${path.join(workRoot, "edge-profile")}`,
    `--remote-debugging-port=${port}`,
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--edge-skip-compat-layer-relaunch",
    "--allow-file-access-from-files",
    pathToFileURL(page).href,
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
          fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json()),
          fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json()),
        ]);
        target = targets.find(({ url }) => url === pathToFileURL(page).href);
        version = nextVersion;
      } catch {}
      if (!target || !version) await delay(100);
    }
    assert.ok(target, "Edge probe page did not open");
    [pageSocket, browserSocket] = await Promise.all([
      connectWebSocket(target.webSocketDebuggerUrl),
      connectWebSocket(version.webSocketDebuggerUrl),
    ]);
    const pageState = { nextId: 0, pending: new Map() };
    const browserState = { nextId: 0, pending: new Map() };
    routeMessages(pageSocket, pageState);
    routeMessages(browserSocket, browserState);
    browserProcessId = (await cdp(browserSocket, browserState, "SystemInfo.getProcessInfo"))
      .processInfo.find(({ type }) => type === "browser")?.id;
    await cdp(pageSocket, pageState, "Runtime.enable");
    let text = "";
    for (let attempt = 0; attempt < 120 && !text; attempt += 1) {
      const evaluated = await cdp(pageSocket, pageState, "Runtime.evaluate", {
        expression: "document.getElementById('result').textContent",
        returnByValue: true,
      });
      text = evaluated.result?.value || "";
      if (!text) await delay(50);
    }
    assert.ok(text, "Edge probe did not report a result");
    const report = JSON.parse(text);
    assert.equal(report.error, undefined, report.error);
    return report.value;
  } finally {
    pageSocket?.close();
    browserSocket?.close();
    await terminateBrowserTree(browserProcessId);
    await terminateBrowserTree(edge.pid);
    edge.kill();
    await Promise.race([exited, delay(2000)]);
    await delay(250);
    await removeTree(workRoot);
  }
}

test("Frame pointer drag and resize preserve retained content and parent bounds on browser/native surfaces", async () => {
  assert.ok(nativeHost, "VKF_OVERLAY_HOST must name the exact native host executable");
  const [frameBytes, nativeBytes] = await Promise.all([readFile(frameSource), readFile(nativeHost)]);
  assert.notEqual(nativeBytes.indexOf(frameBytes), -1, "native host does not embed exact Frame runtime bytes");

  const observed = await runProbe(`
    globalThis.fetch=()=>Promise.resolve(new Response("",{status:200}));
    function pointer(target,type,x,y,pointerId,button=0){target.dispatchEvent(new PointerEvent(type,{
      bubbles:true,cancelable:true,pointerId,pointerType:"mouse",isPrimary:true,button,
      buttons:type==="pointerup"?0:button===0?1:2,clientX:x,clientY:y,
    }));}
    function geometry(root){return [root.style.left,root.style.top,root.style.width,root.style.height];}
    function exercise(name,webViewLike){
      const nativeMessages=[];
      if(webViewLike){globalThis.chrome={webview:{postMessage:(message)=>nativeMessages.push(structuredClone(message))}};}
      else{delete globalThis.chrome;}
      const layer=document.createElement("div");
      layer.style.cssText="position:relative;width:500px;height:400px;padding:0";
      document.body.appendChild(layer);
      const panel=VfFrame.mount(layer,{id:name,inLayerDrag:true,draggable:true,resizable:true,dockable:false,closable:false});
      panel.root.style.left="100px";panel.root.style.top="80px";
      panel.root.style.width="300px";panel.root.style.height="200px";
      const canvas=panel.body.firstElementChild;
      VfHtmlComponents.__internal.mountTree(panel.body,["Button"]);
      const button=panel.body.children[1];
      const queues=VfRuntimePacketContract.createInternalButtonClickedOwnerQueues({
        buttonId:"button-0",frameId:name,displayId:"display-0",
      });
      queues.consumeRuntimePacket({seq:1,kind:"input.event",payload:{event:{
        event:"ButtonClicked",widget_id:"button-0",frame_id:name,
      }}});
      const grip=panel.root.querySelector(".vf-frame__resize-grip");
      panel.header.setPointerCapture=()=>{};panel.header.releasePointerCapture=()=>{};
      grip.setPointerCapture=()=>{};grip.releasePointerCapture=()=>{};
      const initial=geometry(panel.root);

      pointer(panel.header,"pointerdown",120,100,70,1);
      pointer(panel.header,"pointermove",900,900,70,1);
      const malformedDrag=geometry(panel.root);
      pointer(panel.header,"pointerdown",120,100,71);
      pointer(panel.header,"pointermove",900,900,99);
      const wrongDragSequence=geometry(panel.root);
      pointer(panel.header,"pointermove",170,140,71);
      pointer(panel.header,"pointerup",170,140,71);
      const dragged=geometry(panel.root);
      pointer(panel.header,"pointermove",490,390,71);
      const staleDrag=geometry(panel.root);

      pointer(grip,"pointerdown",450,320,72);
      pointer(grip,"pointermove",900,900,99);
      const wrongResizeSequence=geometry(panel.root);
      pointer(grip,"pointermove",950,820,72);
      pointer(grip,"pointerup",950,820,72);
      const resized=geometry(panel.root);
      pointer(grip,"pointermove",100,100,72);
      const staleResize=geometry(panel.root);
      const events=[queues.button.events.get(),queues.frame.events.get(),queues.display.events.get()];
      const result={initial,malformedDrag,wrongDragSequence,dragged,staleDrag,wrongResizeSequence,resized,
        staleResize,canvasRetained:panel.body.firstElementChild===canvas,
        buttonRetained:panel.body.children[1]===button,eventNames:events.map((event)=>event.event),
        queuesEmpty:[queues.button.events.get(),queues.frame.events.get(),queues.display.events.get()],
        nativeDragActive:nativeMessages.some((message)=>message&&message.type==="layout"&&message.dragActive===true),
        nativeResizeActive:nativeMessages.some((message)=>message&&message.type==="layout"&&message.resizeActive===true)};
      panel.destroy();layer.remove();return result;
    }
    return {browser:exercise("browser-frame",false),native:exercise("native-frame",true)};
  `);

  for (const result of [observed.browser, observed.native]) {
    assert.deepEqual(result.initial, ["100px", "80px", "300px", "200px"]);
    assert.deepEqual(result.malformedDrag, result.initial);
    assert.deepEqual(result.wrongDragSequence, result.initial);
    assert.deepEqual(result.dragged, ["150px", "120px", "300px", "200px"]);
    assert.deepEqual(result.staleDrag, result.dragged);
    assert.deepEqual(result.wrongResizeSequence, result.dragged);
    assert.deepEqual(result.resized, ["150px", "120px", "350px", "280px"]);
    assert.deepEqual(result.staleResize, result.resized);
    assert.equal(result.canvasRetained, true);
    assert.equal(result.buttonRetained, true);
    assert.deepEqual(result.eventNames, ["ButtonClicked", "ButtonClicked", "ButtonClicked"]);
    assert.deepEqual(result.queuesEmpty, [null, null, null]);
  }
  assert.equal(observed.browser.nativeDragActive, false);
  assert.equal(observed.browser.nativeResizeActive, false);
  assert.equal(observed.native.nativeDragActive, true);
  assert.equal(observed.native.nativeResizeActive, true);
  assert.deepEqual(
    { ...observed.native, nativeDragActive: false, nativeResizeActive: false },
    observed.browser,
  );
});
