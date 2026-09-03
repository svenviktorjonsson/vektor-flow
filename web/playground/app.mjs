import { registerVektorFlowPrism } from "../editor/prism-vektorflow.mjs";
import { loadPackagedBrowserCompiler } from "./vkf-browser-compiler.mjs";

const source = document.querySelector("#source");
const highlight = document.querySelector("#highlight");
const compileButton = document.querySelector("#compile");
const output = document.querySelector("#output");
const status = document.querySelector("#status");
const Prism = globalThis.Prism;

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
compileButton.disabled = false;
status.value = "Ready";

function compileSource() {
  const started = performance.now();
  try {
    const result = compiler.compile(source.value);
    output.textContent = JSON.stringify(result, null, 2);
    status.value = `Compiled in ${(performance.now() - started).toFixed(1)} ms`;
  } catch (error) {
    output.textContent = error.cause?.message ?? error.message;
    status.value = "Compile error";
  }
}

compileButton.addEventListener("click", compileSource);
source.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    compileSource();
  }
});

compileSource();
