import assert from "node:assert/strict";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test, { after } from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const require = createRequire(import.meta.url);
const runtimeBridge = require("../../web/vf-ui/vf-compiled-runtime-bridge.js");
const nativeBin = process.env.VKF_NATIVE_COMPILER_BIN;
const nativeSceneStager = process.env.VKF_NATIVE_SCENE_STAGER;
const workRoot = path.join(repositoryRoot, ".work", `040-u03-${process.pid}`);

after(async () => {
  await rm(workRoot, { recursive: true, force: true });
});

function executable(directory, name) {
  return path.join(directory, process.platform === "win32" ? `${name}.exe` : name);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
    ...options,
  });
  assert.equal(result.status, 0, result.stderr || `${command} failed without diagnostics`);
  return result.stdout;
}

function compileSource(source) {
  assert.ok(nativeBin, "VKF_NATIVE_COMPILER_BIN must name the focused native build directory");
  const tokens = run(executable(nativeBin, "vkf_lexer_cursor_smoke"), [source]);
  const ast = run(executable(nativeBin, "vkf_parser_token_stream_smoke"), [], { input: tokens });
  return JSON.parse(run(executable(nativeBin, "vkf_ast_to_ir_smoke"), [], { input: ast }));
}

class FakeClassList {
  constructor() {
    this.names = new Set();
  }
  add(...names) {
    names.forEach((name) => this.names.add(String(name)));
  }
  contains(name) {
    return this.names.has(String(name));
  }
}

class FakeFragment {
  constructor() {
    this.nodeType = 11;
    this.children = [];
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  get firstChild() {
    return this.children[0] || null;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    return child;
  }
}

class FakeElement {
  constructor(tag) {
    this.nodeType = 1;
    this.localName = String(tag).toLowerCase();
    this.tagName = this.localName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.style = {};
    this.classList = new FakeClassList();
    this.clientWidth = 1000;
    this.clientHeight = 800;
  }
  appendChild(child) {
    if (child && child.nodeType === 11) {
      while (child.firstChild) this.appendChild(child.removeChild(child.firstChild));
      return child;
    }
    if (child.parentNode && typeof child.parentNode.removeChild === "function") {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  contains(candidate) {
    return candidate === this || this.children.some((child) =>
      child === candidate || (typeof child.contains === "function" && child.contains(candidate)));
  }
  querySelector() {
    return null;
  }
  get firstChild() {
    return this.children[0] || null;
  }
  get firstElementChild() {
    return this.children.find((child) => child.nodeType === 1) || null;
  }
  get nextSibling() {
    if (!this.parentNode) return null;
    const index = this.parentNode.children.indexOf(this);
    return this.parentNode.children[index + 1] || null;
  }
  get parentElement() {
    return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
  }
  get offsetParent() {
    return this.parentElement;
  }
}

function mountRetainedTree(commands) {
  const document = {
    createElement: (tag) => new FakeElement(tag),
    createDocumentFragment: () => new FakeFragment(),
  };
  const sandbox = {
    document,
    Element: FakeElement,
    Object,
    WeakMap,
    console,
    getComputedStyle: () => ({
      paddingLeft: "0",
      paddingRight: "0",
      paddingTop: "0",
      paddingBottom: "0",
    }),
    requestAnimationFrame(callback) {
      callback();
    },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(
    require("node:fs").readFileSync(
      path.join(repositoryRoot, "web", "vf-ui", "vf-html-components.js"),
      "utf8",
    ),
    sandbox,
  );
  vm.runInNewContext(
    require("node:fs").readFileSync(
      path.join(repositoryRoot, "web", "vf-ui", "vf-runtime-scene.js"),
      "utf8",
    ),
    sandbox,
  );

  const layer = new FakeElement("div");
  let mountedBody = null;
  const frame = {
    _coerceAlpha: (_value, fallback) => fallback,
    normalizeDockLocationKey: () => "tl",
    mount(owner, options) {
      const root = new FakeElement("div");
      root.classList.add("vf-frame");
      root.dataset.vfFrameId = options.id;
      const body = new FakeElement("div");
      const canvas = new FakeElement("canvas");
      canvas.classList.add("vf-frame__draw-canvas");
      body.appendChild(canvas);
      root.appendChild(body);
      owner.appendChild(root);
      mountedBody = body;
      return {
        root,
        body,
        setTitle() {},
        setAlpha() {},
        syncPointerPassThrough() {},
        renderTitle() {},
      };
    },
  };
  const adapter = sandbox.VfRuntimeScene.createAdapter({
    createRuntimeDependencies: () => ({
      frame,
      widgets: { clearFrame() {}, refreshButtonGroups() {} },
    }),
    getLayer: () => layer,
  });
  adapter.applySceneCommands(commands);
  return mountedBody.children.map(({ localName }) => localName);
}

test("compiled Div and Button attach as one retained tree on native and WASM surfaces", async () => {
  assert.ok(nativeSceneStager, "VKF_NATIVE_SCENE_STAGER must name the focused stager executable");
  await mkdir(workRoot, { recursive: true });
  const sourceText = [
    ": .ui.display",
    "layout: Div()",
    "action: Button()",
  ].join("\n");
  const typedIr = compileSource(sourceText);
  const identities = typedIr.body
    .filter(({ kind, name }) => kind === "store_binding" && ["layout", "action"].includes(name))
    .map(({ value }) => value.value);
  assert.deepEqual(identities, ["Div", "Button"]);
  const numericList = (values) => ({
    kind: "list",
    items: values.map((value) => ({ kind: "const", type: "num", value })),
    element_type: "num",
    type: `[num:${values.length}]`,
  });
  typedIr.ui_program = {
    schema: "vektor-flow/ui-program",
    version: 1,
    displays: [{ id: 0, dimension: 2, transparent: true }],
    operations: [
      {
        kind: "add_frame",
        parent_kind: "display",
        frame_id: 0,
        pos: numericList([0.1, 0.2]),
        size: numericList([0.5, 0.6]),
      },
      {
        kind: "__vf_internal_attach_html_tree",
        target: { kind: "frame", id: 0 },
        identities,
      },
    ],
  };

  const source = path.join(workRoot, "retained-tree.vkf");
  const typedIrPath = path.join(workRoot, "retained-tree.typed-ir.json");
  await Promise.all([
    writeFile(source, `${sourceText}\n`, "utf8"),
    writeFile(typedIrPath, `${JSON.stringify(typedIr)}\n`, "utf8"),
  ]);

  const overlayWeb = path.join(workRoot, "vf-ui");
  await cp(path.join(repositoryRoot, "web", "vf-ui"), overlayWeb, { recursive: true });
  const staged = JSON.parse(run(nativeSceneStager, [
    "--source", source,
    "--overlay-web", overlayWeb,
    "--typed-ir", typedIrPath,
  ]));
  const sessionDirectory = path.dirname(path.join(
    overlayWeb,
    ...staged.page_rel.split("/"),
  ));
  const nativePackets = JSON.parse(await readFile(
    path.join(sessionDirectory, "vf-runtime-packets.json"),
    "utf8",
  ));

  const wasmSummary = JSON.parse(run(executable(nativeBin, "vkf_wasm_artifact_smoke"), [
    "--source", source,
    "--typed-ir", typedIrPath,
  ]));
  const [wasmBytes, wasmManifest] = await Promise.all([
    readFile(wasmSummary.artifact_path),
    readFile(wasmSummary.manifest_path, "utf8").then(JSON.parse),
  ]);
  const wasmRuntime = runtimeBridge.instantiateWasmRuntime({
    bytes: wasmBytes,
    manifest: wasmManifest,
  });
  const wasmPackets = JSON.parse(wasmRuntime.readBinding("$ui$compiled$packets"));

  assert.deepEqual(wasmPackets, nativePackets);
  const commands = nativePackets[0].payload.commands;
  assert.deepEqual(commands[0].payload.spec.__vf_internal_html_components, identities);
  assert.deepEqual(mountRetainedTree(commands), ["canvas", "div", "button"]);
});
