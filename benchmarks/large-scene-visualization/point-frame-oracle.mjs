const CHANNELS = Object.freeze([
  'foreground-coverage',
  'premultiplied-r',
  'premultiplied-g',
  'premultiplied-b',
  'alpha',
]);

export function cameraOffsetForFrame(workload, frame) {
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= workload.cameraPath.frames) {
    throw new RangeError(`frame ${frame} is outside ${workload.cameraPath.frames} camera frames`);
  }
  if (workload.cameraPath.kind === 'fixed') return [0, 0];
  if (workload.cameraPath.kind !== 'sinusoidal-pan') {
    throw new Error(`unsupported camera path ${workload.cameraPath.kind}`);
  }
  const phase = 2 * Math.PI * frame / workload.cameraPath.frames;
  return [
    workload.cameraPath.xAmplitude * Math.sin(phase),
    workload.cameraPath.yAmplitude * Math.cos(phase),
  ];
}

export function projectionForFrame(workload, frame) {
  const [offsetX, offsetY] = cameraOffsetForFrame(workload, frame);
  const [width, height] = workload.viewport;
  const [xMin, xMax] = workload.cameraPath.xRange;
  const [yMin, yMax] = workload.cameraPath.yRange;
  const xScale = width / (xMax - xMin);
  const yScale = height / (yMax - yMin);
  return {
    worldOrigin: [offsetX, offsetY, 0],
    screenOrigin: [-xMin * xScale, yMax * yScale],
    xAxis: [xScale, 0],
    yAxis: [0, -yScale],
    zAxis: [0, 0],
  };
}

function assertPointInput(points, workload) {
  if (!(points instanceof Float32Array) || points.length < workload.pointCount * 2) {
    throw new TypeError('oracle points must contain the packed float32 x/y fixture');
  }
  if (workload.correctness.reference !== 'ideal-disc-source-over-v1') {
    throw new Error(`unsupported point reference ${workload.correctness.reference}`);
  }
  if (workload.correctness.subpixelsPerAxis !== 8) {
    throw new Error('ideal-disc-source-over-v1 requires an 8x8 subpixel grid');
  }
}

export function idealDiscRegionStats(points, workload, frame) {
  assertPointInput(points, workload);
  const [width, height] = workload.viewport;
  const [gridWidth, gridHeight] = workload.correctness.grid;
  const radius = workload.pointDiameterPixels / 2;
  const subpixels = workload.correctness.subpixelsPerAxis;
  const inverseSamples = 1 / (subpixels * subpixels);
  const pointAlpha = workload.pointRgba[3] / 255;
  const foreground = new Float32Array(width * height);
  const projection = projectionForFrame(workload, frame);
  const origin = projection.worldOrigin;
  const screen = projection.screenOrigin;
  const xAxis = projection.xAxis;
  const yAxis = projection.yAxis;

  for (let index = 0; index < workload.pointCount; index += 1) {
    const x = points[index * 2];
    const y = points[index * 2 + 1];
    const centerX = screen[0] + (x - origin[0]) * xAxis[0] + (y - origin[1]) * yAxis[0];
    const centerY = screen[1] + (x - origin[0]) * xAxis[1] + (y - origin[1]) * yAxis[1];
    const minX = Math.max(0, Math.floor(centerX - radius));
    const maxX = Math.min(width - 1, Math.floor(centerX + radius));
    const minY = Math.max(0, Math.floor(centerY - radius));
    const maxY = Math.min(height - 1, Math.floor(centerY + radius));
    for (let pixelY = minY; pixelY <= maxY; pixelY += 1) {
      for (let pixelX = minX; pixelX <= maxX; pixelX += 1) {
        let inside = 0;
        for (let subY = 0; subY < subpixels; subY += 1) {
          const sampleY = pixelY + (subY + 0.5) / subpixels - centerY;
          for (let subX = 0; subX < subpixels; subX += 1) {
            const sampleX = pixelX + (subX + 0.5) / subpixels - centerX;
            if (sampleX * sampleX + sampleY * sampleY <= radius * radius) inside += 1;
          }
        }
        if (inside === 0) continue;
        const sourceAlpha = inside * inverseSamples * pointAlpha;
        const pixel = pixelY * width + pixelX;
        foreground[pixel] = sourceAlpha + foreground[pixel] * (1 - sourceAlpha);
      }
    }
  }
  const result = regionStatsFromForeground(foreground, workload, width, height, gridWidth, gridHeight);
  result.frame = frame;
  return result;
}

function regionStatsFromForeground(foreground, workload, width, height, gridWidth, gridHeight) {
  const regions = Array.from({ length: gridWidth * gridHeight }, () => Array(5).fill(0));
  const counts = new Uint32Array(regions.length);
  const point = workload.pointRgba.map((value) => value / 255);
  const background = workload.backgroundRgba.map((value) => value / 255);
  for (let y = 0; y < height; y += 1) {
    const regionY = Math.min(gridHeight - 1, Math.floor(y * gridHeight / height));
    for (let x = 0; x < width; x += 1) {
      const regionX = Math.min(gridWidth - 1, Math.floor(x * gridWidth / width));
      const regionIndex = regionY * gridWidth + regionX;
      const coverage = foreground[y * width + x];
      const outputAlpha = coverage + background[3] * (1 - coverage);
      regions[regionIndex][0] += coverage;
      for (let channel = 0; channel < 3; channel += 1) {
        const output = point[channel] * coverage + background[channel] * (1 - coverage);
        regions[regionIndex][channel + 1] += output * outputAlpha;
      }
      regions[regionIndex][4] += outputAlpha;
      counts[regionIndex] += 1;
    }
  }
  for (let index = 0; index < regions.length; index += 1) {
    regions[index] = regions[index].map((value) => value / counts[index]);
  }
  return {
    oracle: workload.correctness.oracle,
    reference: workload.correctness.reference,
    frame: null,
    grid: [gridWidth, gridHeight],
    channels: [...CHANNELS],
    regions,
  };
}

export function framebufferRegionStats(rgba, workload, frame, options = {}) {
  const [width, height] = workload.viewport;
  if (!(rgba instanceof Uint8Array) || rgba.length !== width * height * 4) {
    throw new TypeError('framebuffer must be an exact RGBA8 viewport readback');
  }
  const [gridWidth, gridHeight] = workload.correctness.grid;
  const regions = Array.from({ length: gridWidth * gridHeight }, () => Array(5).fill(0));
  const counts = new Uint32Array(regions.length);
  const background = workload.backgroundRgba.map((value) => value / 255);
  const bottomUp = options.origin === 'bottom-left';
  for (let y = 0; y < height; y += 1) {
    const sourceY = bottomUp ? height - 1 - y : y;
    const regionY = Math.min(gridHeight - 1, Math.floor(y * gridHeight / height));
    for (let x = 0; x < width; x += 1) {
      const regionX = Math.min(gridWidth - 1, Math.floor(x * gridWidth / width));
      const regionIndex = regionY * gridWidth + regionX;
      const source = (sourceY * width + x) * 4;
      const coverage = rgba[source + 3] / 255;
      const outputAlpha = coverage + background[3] * (1 - coverage);
      regions[regionIndex][0] += coverage;
      for (let channel = 0; channel < 3; channel += 1) {
        const framebufferColor = rgba[source + channel] / 255;
        const output = Math.min(1, framebufferColor + background[channel] * (1 - coverage));
        regions[regionIndex][channel + 1] += output * outputAlpha;
      }
      regions[regionIndex][4] += outputAlpha;
      counts[regionIndex] += 1;
    }
  }
  for (let index = 0; index < regions.length; index += 1) {
    regions[index] = regions[index].map((value) => value / counts[index]);
  }
  return {
    oracle: workload.correctness.oracle,
    reference: workload.correctness.reference,
    frame,
    grid: [gridWidth, gridHeight],
    channels: [...CHANNELS],
    regions,
  };
}

export function compareRegionStats(expected, observed, maximum) {
  if (expected.oracle !== observed.oracle
    || expected.reference !== observed.reference
    || JSON.stringify(expected.grid) !== JSON.stringify(observed.grid)
    || JSON.stringify(expected.channels) !== JSON.stringify(observed.channels)
    || expected.regions.length !== observed.regions.length) {
    throw new Error('region-stat contracts differ');
  }
  let maxRegionError = 0;
  for (let region = 0; region < expected.regions.length; region += 1) {
    if (expected.regions[region].length !== observed.regions[region].length) {
      throw new Error('region-stat channel counts differ');
    }
    for (let channel = 0; channel < expected.regions[region].length; channel += 1) {
      maxRegionError = Math.max(
        maxRegionError,
        Math.abs(expected.regions[region][channel] - observed.regions[region][channel]),
      );
    }
  }
  return { passed: maxRegionError <= maximum, maxRegionError };
}
