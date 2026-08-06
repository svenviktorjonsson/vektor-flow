import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

test("package root resolves to the deterministic browser module manifest", () => {
  const packageRoot = require("vektor-flow");

  assert.deepEqual(packageRoot.browserModules, {
    axis2dTicks: "vektor-flow/axis2d-ticks",
    colorScale: "vektor-flow/color-scale",
    colorField: "vektor-flow/color-field",
    colorbar: "vektor-flow/colorbar",
    interpolation: "vektor-flow/interpolation",
    interpolationEditor: "vektor-flow/interpolation-editor",
    propertyProgram: "vektor-flow/property-program",
    screenSimplexRenderer: "vektor-flow/screen-simplex-renderer",
    symbolicKernel: "vektor-flow/symbolic-kernel",
    symbolicKernelManifest: "vektor-flow/symbolic-kernel-manifest",
    symbolicKernelWasm: "vektor-flow/symbolic-kernel-wasm",
    symbolicPlotRenderer: "vektor-flow/symbolic-plot-renderer",
    symbolicPlotController: "vektor-flow/symbolic-plot-controller",
    symbolicTextChannel: "vektor-flow/symbolic-text-channel",
    uiMath: "vektor-flow/ui-math",
  });
  assert.ok(Object.isFrozen(packageRoot));
  assert.ok(Object.isFrozen(packageRoot.browserModules));
});

test("named browser exports resolve to their implemented modules", async () => {
  const axis2d = await import("vektor-flow/axis2d-ticks");
  const colorScale = await import("vektor-flow/color-scale");
  const colorField = await import("vektor-flow/color-field");
  const colorbar = await import("vektor-flow/colorbar");
  const interpolation = await import("vektor-flow/interpolation");
  const propertyProgram = await import("vektor-flow/property-program");
  const renderer = await import("vektor-flow/screen-simplex-renderer");
  const symbolicKernel = await import("vektor-flow/symbolic-kernel");
  const symbolicPlot = await import("vektor-flow/symbolic-plot-renderer");
  const symbolicPlotController = await import("vektor-flow/symbolic-plot-controller");
  const symbolicText = await import("vektor-flow/symbolic-text-channel");
  const uiMath = await import("vektor-flow/ui-math");

  assert.equal(typeof axis2d.default, "object");
  assert.equal(typeof colorScale.normalizeColorScale, "function");
  assert.equal(typeof colorField.rasterizeColorField, "function");
  assert.equal(typeof renderer.createScreenSpaceSimplexRenderer, "function");
  assert.equal(typeof colorbar.createColorbarView, "function");
  assert.equal(typeof colorbar.createColorbarGestureController, "function");
  assert.equal(typeof interpolation.interpolateDirectedPath, "function");
  assert.equal(typeof propertyProgram.parsePropertyProgram, "function");
  assert.equal(typeof symbolicKernel.createSymbolicKernel, "function");
  assert.equal(typeof symbolicKernel.loadSymbolicKernel, "function");
  assert.equal(typeof symbolicKernel.loadPackagedSymbolicKernel, "function");
  assert.equal(typeof symbolicPlot.createSymbolicPlotRenderer, "function");
  assert.equal(typeof symbolicPlotController.createSymbolicPlotController, "function");
  assert.equal(typeof symbolicPlotController.createSymbolicCompiler, "function");
  assert.equal(typeof symbolicText.createSymbolicWasmTextChannel, "function");
  assert.equal(typeof symbolicText.loadSymbolicWasmTextChannel, "function");
  assert.equal(typeof uiMath.default, "object");
});

test("existing web module paths remain resolvable", async () => {
  const axis2d = await import(
    "vektor-flow/web/vf-ui/vf-axis2d-ticks.js"
  );
  const renderer = await import(
    "vektor-flow/web/vf-ui/geom/vf-screen-simplex-renderer.mjs"
  );

  assert.equal(typeof axis2d.default, "object");
  assert.equal(typeof renderer.createScreenSpaceSimplexRenderer, "function");
});
