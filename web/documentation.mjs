import { highlightVkf } from "./editor/vkf-highlighter.mjs";
import { createInlineExampleController } from "./inline-example-controller.mjs";
import { createInlineRunner } from "./inline-runner.mjs";
import { renderInlineResult } from "./inline-result-renderer.mjs";

const readme = globalThis.document.querySelector("#readme-documentation");

function fitEditor(source) {
  source.style.height = "0";
  source.style.height = `${Math.max(140, source.scrollHeight)}px`;
}

function prepareExample(example, runner) {
  const source = example.querySelector(".readme-example-source");
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
  const hideResult = () => {
    example.querySelector(".readme-example-result")?.remove();
    layout.classList.remove("has-result");
  };
  const controller = createInlineExampleController({
    runner,
    view: {
      start() {
        play.disabled = true;
        terminal.hidden = false;
        output.textContent = "Running…";
        hideResult();
      },
      showTerminal(value) { output.textContent = value; },
      hideResult,
      showResult(packets) {
        const result = globalThis.document.createElement("section");
        result.className = "readme-example-result";
        result.setAttribute("aria-label", "Result");
        result.dataset.packetCount = String(packets.length);
        const canvas = globalThis.document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        canvas.setAttribute("aria-label", "VKF visual output");
        result.append(canvas);
        renderInlineResult(canvas, packets);
        layout.append(result);
        layout.classList.add("has-result");
      },
      finish() { play.disabled = false; },
    },
  });

  play.addEventListener("click", () => controller.run(source.value));
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

try {
  const response = await fetch("./generated/readme.json");
  if (!response.ok) throw new Error(`README request failed (${response.status})`);
  renderDocumentation(await response.json(), readme, createInlineRunner());
} catch (error) {
  readme.textContent = `README unavailable: ${error.message}`;
}
