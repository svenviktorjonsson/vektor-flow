import { registerVektorFlowPrism } from "../editor/prism-vektorflow.mjs";
import { loadPackagedBrowserCompiler } from "./vkf-browser-compiler.mjs";
import { loadPackagedBrowserSymbolicPlotter } from "./vkf-browser-symbolic-plotter.mjs";
import { LIVE_EXAMPLE_GROUPS, LIVE_EXAMPLES_BY_ID } from "./examples.mjs";

const source = document.querySelector("#source");
const highlight = document.querySelector("#highlight");
const compileButton = document.querySelector("#compile");
const playButton = document.querySelector("#play");
const example = document.querySelector("#example");
const output = document.querySelector("#output");
const visualization = document.querySelector("#visualization");
const reference = document.querySelector("#reference");
const referenceImage = document.querySelector("#reference-image");
const referenceVideo = document.querySelector("#reference-video");
const status = document.querySelector("#status");
const Prism = globalThis.Prism;

const EXAMPLES = Object.freeze({
  console: Object.freeze({
    id: "console",
    title: "Dependency chain",
    source: "base: 40\nfirst: base + 1\nsecond: first + 1\nsecond + 1",
    kind: "console",
  }),
  "console-arithmetic": Object.freeze({
    id: "console-arithmetic",
    title: "Grouped arithmetic",
    source: "value: 100\n:: (value - (20 + 4) * 2) // (3 + 1)",
    kind: "console",
  }),
  ...LIVE_EXAMPLES_BY_ID,
});

for (const group of LIVE_EXAMPLE_GROUPS) {
  const options = document.createElement("optgroup");
  options.label = group.label;
  for (const item of group.examples) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.title;
    options.append(option);
  }
  example.append(options);
}

registerVektorFlowPrism(Prism);

function renderHighlight() {
  highlight.innerHTML = Prism.highlight(
    `${source.value}\n`,
    Prism.languages.vektorflow,
    "vektorflow",
  );
}

function synchronizeScroll() {
  const pre = highlight.parentElement;
  pre.scrollTop = source.scrollTop;
  pre.scrollLeft = source.scrollLeft;
}

renderHighlight();
source.addEventListener("input", renderHighlight);
source.addEventListener("scroll", synchronizeScroll);

const compiler = await loadPackagedBrowserCompiler();
let plotterPromise;
let plotProgram;
let animationFrame;
let animationOrigin;
let catalogExample;
compileButton.disabled = false;
status.value = "Ready";

function selectedExample() {
  if (example.value === "catalog" && catalogExample) return catalogExample;
  return EXAMPLES[example.value] ?? EXAMPLES.console;
}

function selectedExampleIsTimed() {
  return selectedExample().kind.endsWith("-time");
}

function selectedExampleIsSurface() {
  return selectedExample().kind.startsWith("surface");
}

function stopAnimation() {
  if (animationFrame != null) cancelAnimationFrame(animationFrame);
  animationFrame = undefined;
  animationOrigin = undefined;
  playButton.textContent = "Play";
}

function showConsole() {
  output.hidden = false;
  visualization.hidden = true;
  reference.hidden = true;
}

function showVisualization() {
  output.hidden = true;
  visualization.hidden = false;
  reference.hidden = true;
}

function showReference(media, title) {
  output.hidden = true;
  visualization.hidden = true;
  referenceImage.hidden = true;
  referenceVideo.hidden = true;
  const element = media.type === "video" ? referenceVideo : referenceImage;
  element.src = catalogueMediaUrl(media.path);
  element.setAttribute("aria-label", `Verified native render of ${title}`);
  element.hidden = false;
  reference.hidden = false;
}

function drawPlot(plot, view) {
  const ratio = Math.max(1, globalThis.devicePixelRatio || 1);
  const width = Math.max(320, visualization.clientWidth);
  const height = Math.max(300, visualization.clientHeight);
  visualization.width = Math.round(width * ratio);
  visualization.height = Math.round(height * ratio);
  const context = visualization.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  const px = (x) => (x - view.xMin) / (view.xMax - view.xMin) * width;
  const py = (y) => height - (y - view.yMin) / (view.yMax - view.yMin) * height;

  context.strokeStyle = "#2b3851";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, py(0));
  context.lineTo(width, py(0));
  context.moveTo(px(0), 0);
  context.lineTo(px(0), height);
  context.stroke();

  context.strokeStyle = "#7de8bc";
  context.lineWidth = 2.5;
  context.lineJoin = "round";
  context.beginPath();
  let drawing = false;
  const stride = plot.stride / Float32Array.BYTES_PER_ELEMENT;
  for (let index = 0; index < plot.count; index += 1) {
    const x = plot.data[index * stride];
    const y = plot.data[index * stride + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      drawing = false;
      continue;
    }
    if (drawing) context.lineTo(px(x), py(y));
    else context.moveTo(px(x), py(y));
    drawing = true;
  }
  context.stroke();
}

function drawSurface(surface, view) {
  const ratio = Math.max(1, globalThis.devicePixelRatio || 1);
  const width = Math.max(320, visualization.clientWidth);
  const height = Math.max(300, visualization.clientHeight);
  visualization.width = Math.round(width * ratio);
  visualization.height = Math.round(height * ratio);
  const context = visualization.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.lineJoin = "round";

  const stride = surface.stride / Float32Array.BYTES_PER_ELEMENT;
  const point = (index) => {
    const offset = index * stride;
    const x = surface.data[offset];
    const y = surface.data[offset + 1];
    const z = surface.data[offset + 2];
    const nx = (x - view.xMin) / (view.xMax - view.xMin) - 0.5;
    const ny = (y - view.yMin) / (view.yMax - view.yMin) - 0.5;
    return Object.freeze({
      x: width * 0.5 + (nx - ny) * width * 0.58,
      y: height * 0.56 + (nx + ny) * height * 0.24 - z * height * 0.12,
      z,
      depth: nx + ny,
    });
  };

  const faces = [];
  for (let index = 0; index < surface.count; index += 3) {
    const points = [point(index), point(index + 1), point(index + 2)];
    if (points.some(({ x, y, z }) => ![x, y, z].every(Number.isFinite))) continue;
    faces.push({
      points,
      depth: points.reduce((sum, item) => sum + item.depth, 0) / points.length,
      z: points.reduce((sum, item) => sum + item.z, 0) / points.length,
    });
  }
  faces.sort((left, right) => left.depth - right.depth);

  for (const face of faces) {
    const normalized = Math.max(0, Math.min(1, (face.z + 2) / 4));
    context.beginPath();
    context.moveTo(face.points[0].x, face.points[0].y);
    for (let index = 1; index < face.points.length; index += 1) {
      context.lineTo(face.points[index].x, face.points[index].y);
    }
    context.closePath();
    context.fillStyle = `hsl(${160 + normalized * 105} 72% ${38 + normalized * 18}% / 0.9)`;
    context.fill();
    context.strokeStyle = "rgb(164 214 220 / 0.24)";
    context.lineWidth = 0.8;
    context.stroke();
  }
}

async function compilePlot(t = 0) {
  const started = performance.now();
  plotterPromise ??= loadPackagedBrowserSymbolicPlotter();
  const plotter = await plotterPromise;
  plotProgram = plotter.compile(source.value);
  if (selectedExampleIsSurface()) {
    drawSurface(plotter.surface(plotProgram, { t }), plotter.surfaceView);
  } else {
    drawPlot(plotter.plot(plotProgram, { t }), plotter.view);
  }
  showVisualization();
  status.value = `Compiled and rendered in ${(performance.now() - started).toFixed(1)} ms`;
}

async function compileSource() {
  stopAnimation();
  const started = performance.now();
  try {
    if (selectedExample().kind === "source") {
      status.value = "Source example";
      return;
    }
    if (selectedExample().kind !== "console") {
      await compilePlot(0);
      return;
    }
    showConsole();
    const result = compiler.run(source.value);
    output.textContent = String(result);
    status.value = `Compiled and ran in ${(performance.now() - started).toFixed(1)} ms`;
  } catch (error) {
    output.textContent = error.cause?.message ?? error.message;
    showConsole();
    status.value = "Compile or runtime error";
  }
}

function animate(timestamp) {
  if (animationOrigin == null) animationOrigin = timestamp;
  const t = ((timestamp - animationOrigin) / 1000) % (2 * Math.PI);
  plotterPromise.then((plotter) => {
    if (selectedExampleIsSurface()) {
      drawSurface(plotter.surface(plotProgram, { t }), plotter.surfaceView);
    } else {
      drawPlot(plotter.plot(plotProgram, { t }), plotter.view);
    }
    status.value = `Running · t=${t.toFixed(2)}`;
  });
  animationFrame = requestAnimationFrame(animate);
}

playButton.addEventListener("click", async () => {
  if (animationFrame != null) {
    stopAnimation();
    status.value = "Paused";
    return;
  }
  try {
    await compilePlot(0);
    playButton.textContent = "Pause";
    animationFrame = requestAnimationFrame(animate);
  } catch (error) {
    output.textContent = error.cause?.message ?? error.message;
    showConsole();
    status.value = "Compile or runtime error";
  }
});

example.addEventListener("change", () => {
  stopAnimation();
  const chosen = selectedExample();
  source.value = chosen.source;
  compileButton.disabled = chosen.kind === "source";
  playButton.hidden = !selectedExampleIsTimed();
  history.replaceState(null, "", `?example=${encodeURIComponent(example.value)}`);
  renderHighlight();
  compileSource();
});

compileButton.addEventListener("click", compileSource);
source.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    compileSource();
  }
});

function catalogueSourceUrl(path) {
  if (!/^examples\/[a-zA-Z0-9_./-]+\.vkf$/u.test(path) || path.split("/").includes("..")) {
    throw new TypeError("Invalid catalogue source path");
  }
  return `./generated/sources/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function catalogueMediaUrl(path) {
  if (!/^media\/docs\/public\/[a-zA-Z0-9_./-]+\.(?:png|webp|gif|mp4)$/u.test(path)
      || path.split("/").includes("..")) {
    throw new TypeError("Invalid catalogue media path");
  }
  return `./generated/${path.split("/").map(encodeURIComponent).join("/")}`;
}

async function loadInitialExample() {
  const parameters = new URLSearchParams(location.search);
  const requestedSource = parameters.get("source");
  if (requestedSource) {
    const response = await fetch(catalogueSourceUrl(requestedSource));
    if (!response.ok) throw new Error(`Source request failed (${response.status})`);
    const title = parameters.get("title") || requestedSource.split("/").at(-1);
    const mediaPath = parameters.get("media");
    const media = mediaPath ? Object.freeze({
      path: mediaPath,
      type: parameters.get("mediaType") === "video" ? "video" : "image",
    }) : null;
    catalogExample = Object.freeze({ source: await response.text(), kind: "source", media });
    const option = document.createElement("option");
    option.value = "catalog";
    option.textContent = `README · ${title}`;
    example.append(option);
    example.value = "catalog";
    source.value = catalogExample.source;
    playButton.hidden = true;
    compileButton.disabled = true;
    if (media) showReference(media, title);
    else showConsole();
    output.textContent = "Browser execution is not yet available for this full program. The source is editable; runnable coverage is added only after the VKF/WASM compiler passes it.";
    status.value = media ? "Verified native render" : "Source example";
    renderHighlight();
    return;
  }

  const requestedExample = parameters.get("example");
  if (requestedExample && EXAMPLES[requestedExample]) {
    example.value = requestedExample;
    source.value = EXAMPLES[requestedExample].source;
  }
  playButton.hidden = !selectedExampleIsTimed();
  renderHighlight();
  await compileSource();
}

try {
  await loadInitialExample();
} catch (error) {
  output.textContent = error.cause?.message ?? error.message;
  showConsole();
  status.value = "Source load error";
}
