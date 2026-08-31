const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const { closeScene, delay, openScene, sendCdp } = require("./capture_mirror_scene.js");

const views = ["view-lighting", "view-mirror", "view-glass", "view-all"];

async function evaluate(runtime, expression, awaitPromise = false) {
  const result = await sendCdp(runtime.pageWs, runtime.pageState, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise,
  });
  return result && result.result ? result.result.value : null;
}

async function captureFrame(runtime, frameId, outputPath) {
  const value = await evaluate(runtime, `(async () => {
    window.VfDisplay.redrawVisibleGeomFrames();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return window.VfDisplay.__test.captureGeomFrameDataUrl(${JSON.stringify(frameId)});
  })()`, true);
  if (typeof value !== "string" || !value.startsWith("data:image/png;base64,")) {
    throw new Error("VKF frame capture did not return PNG data");
  }
  fs.writeFileSync(outputPath, Buffer.from(value.slice("data:image/png;base64,".length), "base64"));
  return crypto.createHash("sha256").update(fs.readFileSync(outputPath)).digest("hex");
}

async function main() {
  const scenePath = process.argv[2];
  const outputDirectory = process.argv[3];
  const port = Number(process.argv[4] || "9237") || 9237;
  const frameId = process.argv[5] || "frame_0";
  if (!scenePath || !outputDirectory) {
    throw new Error("usage: node capture_material_ui_gallery.js <scenePath> <outputDirectory> [port] [frameId]");
  }
  fs.mkdirSync(outputDirectory, { recursive: true });
  const runtime = await openScene(scenePath, port, frameId);
  const states = [];
  try {
    await delay(1200);
    for (let index = 0; index < views.length; index += 1) {
      const viewId = views[index];
      const observed = await evaluate(runtime, `(async () => {
        const button = document.getElementById(${JSON.stringify(viewId)});
        if (!button) return { ok:false, reason:"button missing" };
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 240));
        if (window.__vfRetainedEventError) {
          return { ok:false, reason:String(window.__vfRetainedEventError.message || window.__vfRetainedEventError) };
        }
        const state = window.VfDisplay.__test.debugDynamicGeomFrameState(${JSON.stringify(frameId)});
        return { ok:true, meshCount:state && state.renderer ? state.renderer.partCount : 0 };
      })()`, true);
      if (!observed || !observed.ok) {
        throw new Error(`compiled gallery event failed for ${viewId}: ${JSON.stringify(observed)}`);
      }
      const outputPath = path.join(outputDirectory, `${String(index).padStart(2, "0")}-${viewId}.png`);
      const sha256 = await captureFrame(runtime, frameId, outputPath);
      states.push({ view: viewId, file: path.basename(outputPath), meshCount: observed.meshCount, sha256 });
    }

    const slider = await evaluate(runtime, `(async () => {
      const input = document.getElementById("glass-alpha");
      if (!input) return { ok:false, reason:"slider missing" };
      input.value = "0.72";
      input.dispatchEvent(new Event("input", { bubbles:true }));
      await new Promise((resolve) => setTimeout(resolve, 240));
      return { ok:!window.__vfRetainedEventError, value:Number(input.value) };
    })()`, true);
    if (!slider || !slider.ok || slider.value !== 0.72) {
      throw new Error(`compiled gallery slider failed: ${JSON.stringify(slider)}`);
    }
    const sliderPath = path.join(outputDirectory, "04-glass-alpha-072.png");
    await captureFrame(runtime, frameId, sliderPath);
    states.push({ view: "glass-alpha-072", file: path.basename(sliderPath), value: slider.value });
    if (new Set(states.slice(0, 4).map((state) => state.sha256)).size < 3) {
      throw new Error("compiled gallery buttons did not produce distinct rendered views");
    }

    const screenshot = await sendCdp(runtime.pageWs, runtime.pageState, "Page.captureScreenshot", {
      format: "png",
      omitBackground: false,
      captureBeyondViewport: false,
      fromSurface: true,
    });
    fs.writeFileSync(path.join(outputDirectory, "material-ui-gallery.png"), Buffer.from(screenshot.data, "base64"));
    process.stdout.write(JSON.stringify({
      captureApi: "VfDisplay.__test.captureGeomFrameDataUrl",
      execution: "headless",
      frameId,
      states,
      still: "material-ui-gallery.png",
    }));
  } finally {
    await closeScene(runtime.browserWs, runtime.browserState, runtime.edge);
  }
}

main().catch((error) => {
  console.error(String(error && error.stack || error));
  process.exit(1);
});
