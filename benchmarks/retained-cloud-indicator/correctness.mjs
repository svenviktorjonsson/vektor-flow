async function sha256(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export async function assessCloudCapture(rgba, width, height, options = {}) {
  if (!(rgba instanceof Uint8Array) || rgba.length !== width * height * 4) {
    throw new TypeError('cloud capture must be an exact RGBA8 viewport');
  }
  const minimumChangedPixels = options.minimumChangedPixels ?? 1_000;
  let changedPixels = 0;
  const quadrantChangedPixels = [0, 0, 0, 0];
  const maximumRgb = [0, 0, 0];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const red = rgba[offset];
      const green = rgba[offset + 1];
      const blue = rgba[offset + 2];
      maximumRgb[0] = Math.max(maximumRgb[0], red);
      maximumRgb[1] = Math.max(maximumRgb[1], green);
      maximumRgb[2] = Math.max(maximumRgb[2], blue);
      if (Math.max(red, green, blue) <= 8) continue;
      changedPixels += 1;
      quadrantChangedPixels[(y >= height / 2 ? 2 : 0) + (x >= width / 2 ? 1 : 0)] += 1;
    }
  }
  const minimumPerQuadrant = Math.max(1, Math.floor(minimumChangedPixels / 16));
  const passed = changedPixels >= minimumChangedPixels
    && quadrantChangedPixels.every((count) => count >= minimumPerQuadrant)
    && maximumRgb.every((value) => value >= 32);
  return Object.freeze({
    passed,
    changedPixels,
    quadrantChangedPixels,
    maximumRgb,
    artifactSha256: await sha256(rgba),
  });
}

export async function captureCanvas(canvas, options = {}) {
  const captured = captureCanvasRgba(canvas);
  return await assessCloudCapture(captured.rgba, captured.width, captured.height, options);
}

export function captureCanvasRgba(canvas) {
  const width = Number(canvas?.width) || 0;
  const height = Number(canvas?.height) || 0;
  if (width < 1 || height < 1) throw new TypeError('capture canvas must have a viewport');
  const copy = document.createElement('canvas');
  copy.width = width;
  copy.height = height;
  const context = copy.getContext('2d', { willReadFrequently: true });
  context.drawImage(canvas, 0, 0);
  const rgba = new Uint8Array(context.getImageData(0, 0, width, height).data);
  return { width, height, rgba };
}

function emptyRegions(grid) {
  return Array.from({ length: grid[0] * grid[1] }, () => [0, 0, 0, 0]);
}

function finishRegions(regions, counts) {
  return regions.map((values, index) => values.map((value) => value / counts[index]));
}

export function cloudReferenceRegionStats(fixture, frame, viewport, pointSizePx, grid = [16, 9]) {
  if (!(fixture?.positions instanceof Float32Array) || !(fixture?.colors instanceof Uint8Array)) {
    throw new TypeError('cloud reference requires the canonical fixture');
  }
  if (!Number.isSafeInteger(frame) || frame < 0 || frame > 100) {
    throw new RangeError('cloud reference frame must be in the closed orbit [0,100]');
  }
  const [width, height] = viewport;
  const depth = new Float32Array(width * height);
  depth.fill(-Infinity);
  const owner = new Int32Array(width * height);
  owner.fill(-1);
  const angle = 2 * Math.PI * frame / 100;
  const sine = Math.sin(angle);
  const cosine = Math.cos(angle);
  const scale = height / 2.2;
  const radius = pointSizePx / 2;
  for (let index = 0; index < fixture.pointCount; index += 1) {
    const offset = index * 3;
    const x = fixture.positions[offset];
    const y = fixture.positions[offset + 1];
    const z = fixture.positions[offset + 2];
    const centerX = width / 2 + scale * (cosine * x - sine * z);
    const centerY = height / 2 - scale * y;
    const pointDepth = sine * x + cosine * z;
    if (pointSizePx <= 1) {
      const pixelX = Math.floor(centerX);
      const pixelY = Math.floor(centerY);
      if (pixelX < 0 || pixelX >= width || pixelY < 0 || pixelY >= height) continue;
      const pixel = pixelY * width + pixelX;
      if (pointDepth > depth[pixel]) { depth[pixel] = pointDepth; owner[pixel] = index; }
      continue;
    }
    const minX = Math.max(0, Math.floor(centerX - radius));
    const maxX = Math.min(width - 1, Math.floor(centerX + radius));
    const minY = Math.max(0, Math.floor(centerY - radius));
    const maxY = Math.min(height - 1, Math.floor(centerY + radius));
    for (let pixelY = minY; pixelY <= maxY; pixelY += 1) {
      for (let pixelX = minX; pixelX <= maxX; pixelX += 1) {
        const dx = pixelX + 0.5 - centerX;
        const dy = pixelY + 0.5 - centerY;
        if (dx * dx + dy * dy > radius * radius) continue;
        const pixel = pixelY * width + pixelX;
        if (pointDepth > depth[pixel]) { depth[pixel] = pointDepth; owner[pixel] = index; }
      }
    }
  }
  const regions = emptyRegions(grid);
  const counts = new Uint32Array(regions.length);
  for (let y = 0; y < height; y += 1) {
    const regionY = Math.min(grid[1] - 1, Math.floor(y * grid[1] / height));
    for (let x = 0; x < width; x += 1) {
      const regionX = Math.min(grid[0] - 1, Math.floor(x * grid[0] / width));
      const region = regionY * grid[0] + regionX;
      const point = owner[y * width + x];
      if (point >= 0) {
        const color = point * 4;
        regions[region][0] += 1;
        regions[region][1] += fixture.colors[color] / 255;
        regions[region][2] += fixture.colors[color + 1] / 255;
        regions[region][3] += fixture.colors[color + 2] / 255;
      }
      counts[region] += 1;
    }
  }
  return { frame, grid: [...grid], channels: ['coverage', 'r', 'g', 'b'], regions: finishRegions(regions, counts) };
}

export function framebufferCloudRegionStats(rgba, width, height, frame, grid = [16, 9]) {
  if (!(rgba instanceof Uint8Array) || rgba.length !== width * height * 4) {
    throw new TypeError('cloud framebuffer must be exact RGBA8');
  }
  const regions = emptyRegions(grid);
  const counts = new Uint32Array(regions.length);
  for (let y = 0; y < height; y += 1) {
    const regionY = Math.min(grid[1] - 1, Math.floor(y * grid[1] / height));
    for (let x = 0; x < width; x += 1) {
      const regionX = Math.min(grid[0] - 1, Math.floor(x * grid[0] / width));
      const region = regionY * grid[0] + regionX;
      const offset = (y * width + x) * 4;
      const visible = Math.max(rgba[offset], rgba[offset + 1], rgba[offset + 2]) > 8 ? 1 : 0;
      regions[region][0] += visible;
      regions[region][1] += rgba[offset] / 255;
      regions[region][2] += rgba[offset + 1] / 255;
      regions[region][3] += rgba[offset + 2] / 255;
      counts[region] += 1;
    }
  }
  return { frame, grid: [...grid], channels: ['coverage', 'r', 'g', 'b'], regions: finishRegions(regions, counts) };
}

export function compareCloudRegionStats(expected, observed, maximumError) {
  if (JSON.stringify(expected.grid) !== JSON.stringify(observed.grid)
    || JSON.stringify(expected.channels) !== JSON.stringify(observed.channels)
    || expected.regions.length !== observed.regions.length) {
    throw new Error('cloud region contracts differ');
  }
  let maxRegionError = 0;
  for (let region = 0; region < expected.regions.length; region += 1) {
    for (let channel = 0; channel < expected.regions[region].length; channel += 1) {
      maxRegionError = Math.max(
        maxRegionError,
        Math.abs(expected.regions[region][channel] - observed.regions[region][channel]),
      );
    }
  }
  return { passed: maxRegionError <= maximumError, maxRegionError };
}

export async function verifyCloudCapture(capture, fixture, frame, pointSizePx, options = {}) {
  const smoke = await assessCloudCapture(capture.rgba, capture.width, capture.height, options);
  const reference = cloudReferenceRegionStats(
    fixture, frame, [capture.width, capture.height], pointSizePx,
  );
  const observed = framebufferCloudRegionStats(
    capture.rgba, capture.width, capture.height, frame,
  );
  const comparison = compareCloudRegionStats(reference, observed, options.maxRegionError ?? 0.15);
  return {
    passed: smoke.passed && comparison.passed,
    frame,
    artifactSha256: smoke.artifactSha256,
    changedPixels: smoke.changedPixels,
    quadrantChangedPixels: smoke.quadrantChangedPixels,
    maxRegionError: comparison.maxRegionError,
    reference,
    observed,
  };
}
