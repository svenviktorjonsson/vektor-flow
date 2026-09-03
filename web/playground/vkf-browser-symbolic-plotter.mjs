import { loadPackagedSymbolicKernel } from "../vf-ui/vf-symbolic-kernel-runtime.mjs";

const VIEW = Object.freeze({
  xMin: -2 * Math.PI,
  xMax: 2 * Math.PI,
  yMin: -1.5,
  yMax: 1.5,
  xSteps: 513,
  ySteps: 33,
  fieldXSteps: 17,
  fieldYSteps: 17,
  tMin: 0,
  tMax: 2 * Math.PI,
  tSteps: 65,
  vectorScale: 0.1,
});

const STYLE = Object.freeze({
  edgeR: 0.49,
  edgeG: 0.91,
  edgeB: 0.74,
  edgeA: 1,
  faceR: 0.49,
  faceG: 0.91,
  faceB: 0.74,
  faceA: 0.2,
  valueMin: -1.5,
  valueMax: 1.5,
});

const SURFACE_VIEW = Object.freeze({
  ...VIEW,
  xMin: -Math.PI,
  xMax: Math.PI,
  yMin: -Math.PI,
  yMax: Math.PI,
  fieldXSteps: 17,
  fieldYSteps: 13,
});

const SURFACE_STYLE = Object.freeze({
  ...STYLE,
  faceA: 1,
  valueMin: -2,
  valueMax: 2,
});

export function createBrowserSymbolicPlotter(kernel) {
  if (!kernel || typeof kernel.compile !== "function" || typeof kernel.plot !== "function") {
    throw new TypeError("browser symbolic plotter requires a VKF WASM kernel");
  }
  const workspace = kernel.createWorkspace().handle;
  let revision = 0;
  return Object.freeze({
    compile(source) {
      if (typeof source !== "string") {
        throw new TypeError("symbolic plot source must be a string");
      }
      return kernel.compile(source);
    },
    plot(program, { t = 0 } = {}) {
      if (!program?.handle) {
        throw new TypeError("symbolic plot requires a compiled VKF program");
      }
      revision += 1;
      return kernel.plot(
        program.handle,
        workspace,
        { ...VIEW, t },
        STYLE,
        revision,
      );
    },
    surface(program, { t = 0 } = {}) {
      if (!program?.handle) {
        throw new TypeError("symbolic surface requires a compiled VKF program");
      }
      revision += 1;
      const plotted = kernel.plot(
        program.handle,
        workspace,
        { ...SURFACE_VIEW, t },
        SURFACE_STYLE,
        revision,
      );
      const inputStride = plotted.stride / Float32Array.BYTES_PER_ELEMENT;
      const data = new Float32Array(plotted.count * 3);
      for (let index = 0; index < plotted.count; index += 1) {
        const input = index * inputStride;
        const output = index * 3;
        data[output] = plotted.data[input];
        data[output + 1] = plotted.data[input + 1];
        data[output + 2] = SURFACE_STYLE.valueMin
          + plotted.data[input + 5] * (SURFACE_STYLE.valueMax - SURFACE_STYLE.valueMin);
      }
      return Object.freeze({
        data,
        count: plotted.count,
        stride: 3 * Float32Array.BYTES_PER_ELEMENT,
        xSteps: SURFACE_VIEW.fieldXSteps,
        ySteps: SURFACE_VIEW.fieldYSteps,
      });
    },
    view: VIEW,
    surfaceView: SURFACE_VIEW,
  });
}

export async function loadPackagedBrowserSymbolicPlotter(options = {}) {
  return createBrowserSymbolicPlotter(
    await loadPackagedSymbolicKernel(options),
  );
}
