import { registerVektorFlowPrism } from "../editor/prism-vektorflow.mjs";
import { loadPackagedBrowserCompiler } from "./vkf-browser-compiler.mjs";
import { loadPackagedBrowserSymbolicPlotter } from "./vkf-browser-symbolic-plotter.mjs";

const source = document.querySelector("#source");
const highlight = document.querySelector("#highlight");
const compileButton = document.querySelector("#compile");
const playButton = document.querySelector("#play");
const example = document.querySelector("#example");
const output = document.querySelector("#output");
const visualization = document.querySelector("#visualization");
const status = document.querySelector("#status");
const Prism = globalThis.Prism;

const EXAMPLES = Object.freeze({
  console: Object.freeze({
    source: "base: 40\nfirst: base + 1\nsecond: first + 1\nsecond + 1",
    kind: "console",
  }),
  "curve-static": Object.freeze({ source: "sin(x)", kind: "plot" }),
  "curve-time": Object.freeze({ source: "sin(x-t)", kind: "plot-time" }),
});

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
compileButton.disabled = false;
status.value = "Ready";

function selectedExample() {
  return EXAMPLES[example.value] ?? EXAMPLES.console;
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
}

function showVisualization() {
  output.hidden = true;
  visualization.hidden = false;
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

async function compilePlot(t = 0) {
  const started = performance.now();
  plotterPromise ??= loadPackagedBrowserSymbolicPlotter();
  const plotter = await plotterPromise;
  plotProgram = plotter.compile(source.value);
  drawPlot(plotter.plot(plotProgram, { t }), plotter.view);
  showVisualization();
  status.value = `Compiled and plotted in ${(performance.now() - started).toFixed(1)} ms`;
}

async function compileSource() {
  stopAnimation();
  const started = performance.now();
  try {
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
    status.value = "Compile or runtime error";
  }
}

function animate(timestamp) {
  if (animationOrigin == null) animationOrigin = timestamp;
  const t = (timestamp - animationOrigin) / 1000;
  plotterPromise.then((plotter) => {
    drawPlot(plotter.plot(plotProgram, { t }), plotter.view);
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
  playButton.hidden = chosen.kind !== "plot-time";
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

const requestedExample = new URLSearchParams(location.search).get("example");
if (requestedExample && EXAMPLES[requestedExample]) {
  example.value = requestedExample;
  source.value = EXAMPLES[requestedExample].source;
}
playButton.hidden = selectedExample().kind !== "plot-time";
renderHighlight();
compileSource();
