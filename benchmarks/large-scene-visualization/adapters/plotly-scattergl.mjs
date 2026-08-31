import {
  cameraRangesForFrame,
  createBrowserPeerAdapter,
  fixtureView,
  installLargeBufferUploadTracker,
  prepareHost,
} from './browser-common.mjs';

export const PLOTLY_SCATTERGL_VERSION = '4.0.0';

export function plotlyPlanarPositions(points, pointCount) {
  if (!(points instanceof Float32Array) || points.length < pointCount * 2) {
    throw new TypeError('Plotly positions must contain packed float32 x/y values');
  }
  const x = new Float32Array(pointCount);
  const y = new Float32Array(pointCount);
  for (let index = 0; index < pointCount; index += 1) {
    x[index] = points[index * 2];
    y[index] = points[index * 2 + 1];
  }
  return Object.freeze({ x, y });
}

export function createPlotlyScatterGlLargeSceneAdapter(host, workload, options = {}) {
  prepareHost(host, workload);
  const fixture = fixtureView(workload, options.fixtureBytes);
  const tracker = options.tracker ?? installLargeBufferUploadTracker(workload.pointCount * 4);
  const planar = plotlyPlanarPositions(fixture.points, workload.pointCount);
  let Plotly = options.Plotly ?? null;
  let plot = null;

  function axis(range) {
    return { range, visible: false, fixedrange: true, showgrid: false, zeroline: false };
  }

  return createBrowserPeerAdapter({
    version: PLOTLY_SCATTERGL_VERSION,
    host,
    workload,
    fixture,
    tracker,
    async initializeImpl() {
      Plotly ??= (await import('plotly.js-dist-min')).default;
      plot = document.createElement('div');
      Object.assign(plot.style, { width: `${workload.viewport[0]}px`, height: `${workload.viewport[1]}px` });
      host.append(plot);
      const ranges = cameraRangesForFrame(workload, 0);
      await Plotly.newPlot(plot, [{
        type: 'scattergl',
        mode: 'markers',
        x: planar.x,
        y: planar.y,
        hoverinfo: 'skip',
        marker: {
          size: workload.pointDiameterPixels,
          color: `rgba(${workload.pointRgba.join(',')})`,
          opacity: workload.pointRgba[3] / 255,
          line: { width: 0 },
        },
      }], {
        width: workload.viewport[0],
        height: workload.viewport[1],
        margin: { l: 0, r: 0, t: 0, b: 0, pad: 0 },
        xaxis: axis(ranges.x),
        yaxis: axis(ranges.y),
        paper_bgcolor: `rgb(${workload.backgroundRgba.slice(0, 3).join(',')})`,
        plot_bgcolor: `rgb(${workload.backgroundRgba.slice(0, 3).join(',')})`,
        showlegend: false,
        hovermode: false,
        dragmode: false,
      }, {
        staticPlot: true,
        responsive: false,
        displayModeBar: false,
        scrollZoom: false,
        plotGlPixelRatio: 1,
      });
    },
    async renderFrameImpl(frame) {
      const ranges = cameraRangesForFrame(workload, frame);
      await Plotly.relayout(plot, { 'xaxis.range': ranges.x, 'yaxis.range': ranges.y });
    },
    async destroyImpl() { if (plot) Plotly.purge(plot); },
  });
}
