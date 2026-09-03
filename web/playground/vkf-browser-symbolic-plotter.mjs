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
    view: VIEW,
  });
}

export async function loadPackagedBrowserSymbolicPlotter(options = {}) {
  return createBrowserSymbolicPlotter(
    await loadPackagedSymbolicKernel(options),
  );
}
