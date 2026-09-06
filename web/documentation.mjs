import { highlightVkf } from "./editor/vkf-highlighter.mjs";
import { createInlineExampleController } from "./inline-example-controller.mjs";
import { mountRetainedSceneResult } from "./inline-retained-scene-view.mjs";
let runtime;
let runtimePromise;
function createLazyRunner() {
  const load = () => {
    runtimePromise ??= import("./inline-runner.mjs").then((runner) => {
      runtime = runner.createInlineRunner();
    }).catch((error) => { runtimePromise = null; throw error; });
    return runtimePromise;
  };
  return {
    prewarm: load,
    async run(source) {
      await load();
      return runtime.run(source);
    },
  };
}

const readme = globalThis.document.querySelector("#readme-documentation");

function fitEditor(source) {
  source.style.height = "0";
  source.style.height = `${Math.min(420, Math.max(100, source.scrollHeight))}px`;
}

function prepareExample(example, runner) {
  const source = example.querySelector(".readme-example-source");
  source.value = source.defaultValue;
  const highlight = example.querySelector(".readme-example-highlight code");
  const play = example.querySelector(".readme-example-play");
  const terminal = example.querySelector(".readme-example-terminal");
  const output = example.querySelector(".readme-example-output");
  const renderHighlight = () => {
    highlight.innerHTML = highlightVkf(`${source.value}\n`);
    fitEditor(source);
  };
  source.addEventListener("input", renderHighlight);
  source.addEventListener("scroll", () => {
    highlight.parentElement.scrollTop = source.scrollTop;
    highlight.parentElement.scrollLeft = source.scrollLeft;
  });
  renderHighlight();

  const layout = example.querySelector(".readme-example-layout");
  let stopResultAnimation = null;
  const hideResult = () => {
    stopResultAnimation?.();
    stopResultAnimation = null;
    example.querySelector(".readme-example-result")?.remove();
    layout.classList.remove("has-result");
  };
  const controller = createInlineExampleController({
    runner,
    view: {
      start() {
        play.disabled = true;
      },
      showTerminal(value) {
        terminal.hidden = false;
        output.textContent = value;
      },
      hideResult,
      showResult(packets) {
        const result = globalThis.document.createElement("section");
        result.className = "readme-example-result";
        result.setAttribute("aria-label", "Result");
        result.dataset.packetCount = String(packets.length);
        layout.append(result);
        stopResultAnimation = mountRetainedSceneResult(result, packets);
        layout.classList.add("has-result");
      },
      finish() { play.disabled = false; },
    },
  });

  play.addEventListener("click", () => controller.run(source.value));
  source.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !play.disabled) {
      event.preventDefault();
      controller.run(source.value);
    }
  });
}

export function renderDocumentation(document, readmeElement, runner) {
  if (typeof document?.html !== "string" || !Array.isArray(document.examples)) {
    throw new TypeError("README document has an invalid shape");
  }
  readmeElement.innerHTML = document.html;
  for (const example of readmeElement.querySelectorAll(".readme-example")) {
    prepareExample(example, runner);
  }
}

// Text and links are already present in the built HTML. JavaScript only adds
// syntax highlighting and the explicitly labelled browser execution controls.
const runner = createLazyRunner();
runner.prewarm().catch(() => {});
for (const example of readme.querySelectorAll(".readme-example")) {
  prepareExample(example, runner);
}
for (const code of readme.querySelectorAll("[data-vkf-source] code")) {
  code.innerHTML = highlightVkf(code.textContent);
}
